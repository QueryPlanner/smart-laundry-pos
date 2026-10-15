import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LockKeyhole, LogOut, Printer, ShieldCheck, UserRound, WashingMachine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createCounterStaff, dispatchPrintJobs, enumeratePrinters, getCounterBootstrap,
  getCounterCatalogue, getOrderPieces,
  listPrintJobs, lockCounter, loginCounter, matchOrderPieces, quoteCounterOrder,
  resetCounterStaffPin, retryPrintJob, saveCounterOrder, searchCounterCustomers, setCounterRate,
  reprintCounterOutput,
  setCounterStaffActive, setPrinterProfiles, setupCounterAdmin,
  type CounterAccount, type CounterBootstrap, type CounterCatalogue, type CounterPiece,
  type CounterPrintJob, type CounterQuote, type NativePrinter,
} from '@/lib/localFirst/counter';
import { GarmentGrid } from './GarmentGrid';
import { OrderSummary } from './OrderSummary';
import { CounterAdmin } from './CounterAdmin';

const problem = (e: unknown) => e instanceof Error ? e.message : String(e || 'Something went wrong.');

export const CounterApp = ({ onAdminWorkspace }: { onAdminWorkspace: () => void }) => {
  const [bootstrap, setBootstrap] = useState<CounterBootstrap | null>(null);
  const [account, setAccount] = useState<CounterAccount | null>(null);
  const [catalogue, setCatalogue] = useState<CounterCatalogue | null>(null);
  const [page, setPage] = useState<'order' | 'admin' | 'pieces' | 'prints'>('order');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<{ name: string; phone: string; customerId?: string }>({ name: '', phone: '' });
  const [quote, setQuote] = useState<CounterQuote | null>(null);
  const [payment, setPayment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'card' | 'bank_transfer' | 'other'>('cash');
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof saveCounterOrder>> | null>(null);
  const [jobs, setJobs] = useState<CounterPrintJob[]>([]);
  const [pieces, setPieces] = useState<CounterPiece[]>([]);
  const [pieceChecks, setPieceChecks] = useState<string[]>([]);
  const [printers, setPrinters] = useState<NativePrinter[]>([]);
  const idempotencyKey = useRef(crypto.randomUUID());
  const reprintRequestKeys = useRef<Record<string, string>>({});
  const [reprintBusy, setReprintBusy] = useState(false);
  const [selectedReprintPieces, setSelectedReprintPieces] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const b = await getCounterBootstrap(); setBootstrap(b); setAccount(b.account);
    if (b.authenticated) setCatalogue(await getCounterCatalogue());
  }, []);
  useEffect(() => { void refresh().catch(e => setError(problem(e))); }, [refresh]);
  useEffect(() => {
    if (!catalogue || !catalogue.services.length) return;
    setServiceId(current => current || catalogue.services.find(s => s.key === 'wash_iron')?.id || catalogue.services[0].id);
  }, [catalogue]);
  const service = catalogue?.services.find(s => s.id === serviceId);
  const orderItems = useMemo(() => Object.entries(lines).filter(([, q]) => q > 0).map(([key, quantity]) => {
    const [garmentId, treatmentId] = key.split('|'); return { garmentId, serviceId: treatmentId, quantity };
  }), [lines]);
  useEffect(() => {
    if (!account || !customer.name.trim() || orderItems.length === 0) { setQuote(null); return; }
    let active = true;
    const timer = setTimeout(() => void quoteCounterOrder({ customer, items: orderItems }).then(q => { if (active) setQuote(q); }).catch(e => { if (active) { setQuote(null); setError(problem(e)); } }), 140);
    return () => { active = false; clearTimeout(timer); };
  }, [account, customer, orderItems]);

  const adjust = (garmentId: string, delta: number, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const quantity = Math.max(0, (current[key] || 0) + delta);
    const next = { ...current }; if (quantity) next[key] = quantity; else delete next[key]; return next;
  });
  const setQuantity = (garmentId: string, quantity: number, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const next = { ...current }; if (quantity > 0 && Number.isInteger(quantity)) next[key] = quantity; else delete next[key]; return next;
  });
  const signIn = async (id: string, pin: string) => { setBusy(true); setError(''); try { const a = await loginCounter(id, pin); setAccount(a); setCatalogue(await getCounterCatalogue()); setPage('order'); } catch (e) { setError(problem(e)); } finally { setBusy(false); } };
  const save = async () => {
    if (!account || !quote || !customer.name.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveCounterOrder({ customer, items: orderItems, idempotencyKey: idempotencyKey.current, ...(Number(payment) > 0 ? { payment: { amountMinor: Math.round(Number(payment) * 100), method: paymentMethod } } : {}) });
      setSaved(result); setLines({}); setPayment(''); idempotencyKey.current = crypto.randomUUID(); setPage('prints');
      try {
        const dispatched = await dispatchPrintJobs(result.orderId);
        setJobs(dispatched);
        setNotice(`Order ${result.orderNumber} saved. Current bill and tag queue states are shown below.`);
      } catch (dispatchError) {
        setJobs(result.printJobs);
        setError(`Order ${result.orderNumber} is saved, but print dispatch failed: ${problem(dispatchError)}. Use the print queue to review or retry each output.`);
      }
    } catch (e) { setError(`Order save did not complete: ${problem(e)}. The same request key will be retained if you retry.`); }
    finally { setBusy(false); }
  };
  const loadPieces = async (orderId: string) => { const p = await getOrderPieces(orderId); setPieces(p); setPieceChecks(p.filter(x => x.matched).map(x => x.id)); setPage('pieces'); };
  const submitMatches = async () => { if (!saved) return; try { const res = await matchOrderPieces(saved.orderId, pieceChecks); setNotice(res.complete ? 'Every garment is matched.' : `${res.matchedCount} of ${res.expectedCount} pieces matched. Missing pieces must be checked.`); await loadPieces(saved.orderId); } catch (e) { setError(problem(e)); } };
  const refreshJobs = async (orderId?: string) => setJobs(await listPrintJobs(orderId));
  const doRetry = async (job: CounterPrintJob) => { try { await retryPrintJob(job.id, job.state === 'uncertain'); await refreshJobs(saved?.orderId); } catch (e) { setError(problem(e)); } };
  const reprint = async (kind: 'bill' | 'tags', pieceIds: string[] = []) => {
    if (!saved) return;
    const selected = kind === 'tags' ? [...new Set(pieceIds)].sort() : [];
    if (kind === 'tags' && selected.length === 0) return;
    const requestKey = `${kind}:${selected.join(',')}`;
    const requestId = reprintRequestKeys.current[requestKey] ||= crypto.randomUUID();
    setReprintBusy(true); setError('');
    try {
      await reprintCounterOutput(saved.orderId, kind, selected, requestId);
      await dispatchPrintJobs(saved.orderId);
      await refreshJobs(saved.orderId);
      delete reprintRequestKeys.current[requestKey];
      setSelectedReprintPieces([]);
      setNotice(kind === 'bill' ? 'A bill reprint was added to the Canon queue.' : `${selected.length} selected garment tag(s) were added to the TSC queue.`);
    } catch (e) {
      setError(`The ${kind} reprint request may already be saved. Retry this same selection to safely resume: ${problem(e)}`);
    } finally { setReprintBusy(false); }
  };
  const openPrinterSettings = async () => { setPrinters(await enumeratePrinters()); setPage('admin'); };
  const logout = async () => { await lockCounter(); setAccount(null); setCatalogue(null); setBootstrap(await getCounterBootstrap()); setPage('order'); };

  if (!bootstrap) return <div className="counter-auth"><p>Opening local counter…</p></div>;
  if (bootstrap.setupRequired) return <Setup onDone={async name => { try { const a = await setupCounterAdmin({ fullName: name.fullName, pin: name.pin }); setAccount(a); setCatalogue(await getCounterCatalogue()); setBootstrap(await getCounterBootstrap()); } catch (e) { setError(problem(e)); } }} error={error} />;
  if (!account) return <Login accounts={bootstrap.accounts || []} busy={busy} error={error} onLogin={signIn} onRefresh={() => void refresh()} />;
  const admin = account.role === 'admin';

  return <div className="counter-shell">
    <header className="counter-topbar"><div className="counter-brand"><span className="counter-brand-mark"><WashingMachine /></span><span><strong>Smart Laundry</strong><small>Counter · Offline</small></span></div><div className="counter-session"><Badge variant="outline">{admin ? 'Admin' : 'Staff'} · {account.fullName}</Badge><Button variant="outline" size="sm" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" />Lock</Button></div></header>
    <nav className="counter-nav" aria-label="Counter sections"><button className={page === 'order' ? 'active' : ''} onClick={() => setPage('order')}>New order</button>{saved && <><button className={page === 'prints' ? 'active' : ''} onClick={() => { void refreshJobs(saved.orderId); setPage('prints'); }}>Print progress</button><button className={page === 'pieces' ? 'active' : ''} onClick={() => void loadPieces(saved.orderId)}>Packing / pickup</button></>}{admin && <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}><ShieldCheck className="h-4 w-4" />Admin</button>}</nav>
    {notice && <p className="counter-notice" role="status">{notice}</p>}{error && <p className="counter-error" role="alert">{error}</p>}
    {page === 'order' && <div className="counter-layout"><main className="counter-main"><CustomerEntry customer={customer} onChange={setCustomer} search={searchCounterCustomers} /><section className="counter-panel"><div className="counter-services" role="tablist" aria-label="Service"><span className="counter-section-label">Choose service</span>{catalogue?.services.filter(x => x.active).map(s => <button key={s.id} role="tab" aria-selected={s.id === serviceId} className={s.id === serviceId ? 'selected' : ''} onClick={() => setServiceId(s.id)}>{s.name}</button>)}</div><GarmentGrid catalogue={catalogue} serviceId={serviceId} lines={lines} onAdd={id => adjust(id, 1)} onQuantity={setQuantity} /></section></main><aside className="counter-aside"><OrderSummary catalogue={catalogue} lines={lines} quote={quote} customer={customer} payment={payment} onPayment={setPayment} paymentMethod={paymentMethod} onPaymentMethod={setPaymentMethod} onRemove={(id, sid) => adjust(id, -1, sid)} onQuantity={setQuantity} onSave={() => void save()} busy={busy} /></aside></div>}
    {page === 'admin' && admin && <CounterAdmin catalogue={catalogue} onCatalogue={setCatalogue} printers={printers} onReloadPrinters={openPrinterSettings} onOldAdmin={onAdminWorkspace} onError={e => setError(problem(e))} onNotice={setNotice} />}
    {page === 'prints' && saved && <PrintProgress orderNumber={saved.orderNumber} promisedAt={saved.promisedAt} jobs={jobs.length ? jobs : saved.printJobs} pieces={saved.pieces} selected={selectedReprintPieces} onSelected={setSelectedReprintPieces} reprintBusy={reprintBusy} onReprintBill={() => void reprint('bill')} onReprintTags={() => void reprint('tags', selectedReprintPieces)} onRetry={doRetry} />}
    {page === 'pieces' && saved && <PieceMatching orderNumber={saved.orderNumber} pieces={pieces} selected={pieceChecks} onSelected={setPieceChecks} onSubmit={() => void submitMatches()} />}
  </div>;
};

const Setup = ({ onDone, error }: { onDone: (x: { fullName: string; pin: string }) => void; error: string }) => { const [fullName,setName]=useState(''); const [pin,setPin]=useState(''); const [confirm,setConfirm]=useState(''); const [localError,setError]=useState(''); return <div className="counter-auth"><form onSubmit={e=>{e.preventDefault(); if(pin!==confirm){setError('PINs do not match.');return;} onDone({fullName,pin});}} className="counter-auth-card"><WashingMachine /><h1>Set up Smart Laundry</h1><p>Create the first named administrator account.</p><Label>Admin name<Input value={fullName} onChange={e=>setName(e.target.value)} required /></Label><Label>PIN<Input value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label><Label>Confirm PIN<Input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" inputMode="numeric" required /></Label>{(error||localError)&&<p role="alert">{error||localError}</p>}<Button type="submit">Create admin account</Button></form></div>; };
const Login = ({ accounts, busy, error, onLogin, onRefresh }: { accounts: CounterAccount[]; busy:boolean; error:string; onLogin:(id:string,pin:string)=>void; onRefresh:()=>void }) => { const [id,setId]=useState(''); const [pin,setPin]=useState(''); const [admin,setAdmin]=useState(false); const shown=accounts.filter(a=>a.role===(admin?'admin':'staff')&&a.active); return <div className="counter-auth"><form className="counter-auth-card" onSubmit={e=>{e.preventDefault();if(id)onLogin(id,pin);}}><WashingMachine/><h1>Smart Laundry</h1><p>Choose your name and enter your PIN.</p><div className="counter-role-toggle"><button type="button" className={!admin?'selected':''} onClick={()=>{setAdmin(false);setId('');}}>Staff login</button><button type="button" className={admin?'selected':''} onClick={()=>{setAdmin(true);setId('');}}>Admin</button></div><Label>Name<select value={id} onChange={e=>setId(e.target.value)} required><option value="">Choose {admin?'administrator':'staff member'}</option>{shown.map(a=><option key={a.id} value={a.id}>{a.fullName}</option>)}</select></Label><Label>PIN<Input autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label>{error&&<p role="alert">{error}</p>}<Button disabled={busy||!id} type="submit"><LockKeyhole className="mr-2 h-4 w-4"/>{busy?'Signing in…':'Sign in'}</Button><button className="counter-link" type="button" onClick={onRefresh}>Refresh account list</button></form></div>; };

const CustomerEntry = ({customer,onChange,search}:{customer:{name:string;phone:string;customerId?:string};onChange:(c:{name:string;phone:string;customerId?:string})=>void;search:(phone:string)=>Promise<Array<{id:string;name:string;phone:string}>>}) => {const[hits,setHits]=useState<Array<{id:string;name:string;phone:string}>>([]);const[searchError,setSearchError]=useState('');useEffect(()=>{if(customer.phone.trim().length<3){setHits([]);return;}let live=true;const t=setTimeout(()=>void search(customer.phone).then(x=>{if(live){setHits(x);setSearchError('')}}).catch(e=>live&&setSearchError(problem(e))),250);return()=>{live=false;clearTimeout(t)}},[customer.phone,search]);return <section className="counter-customer counter-panel"><div><span className="counter-section-label">Customer</span><p>Look up by mobile or add a new customer</p></div><Label>Mobile number<Input value={customer.phone} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" onChange={e=>onChange({...customer,phone:e.target.value,customerId:undefined})}/></Label><Label>Name<Input value={customer.name} autoComplete="name" placeholder="Customer name" onChange={e=>onChange({...customer,name:e.target.value,customerId:undefined})}/></Label>{hits.length>0&&<div className="counter-customer-matches" role="listbox" aria-label="Matching customers">{hits.map(c=><button type="button" role="option" aria-selected={customer.customerId===c.id} key={c.id} onClick={()=>{onChange({name:c.name,phone:c.phone,customerId:c.id});setHits([])}}><strong>{c.name}</strong><span>{c.phone}</span></button>)}</div>}{searchError&&<p role="status">Customer lookup unavailable; enter details manually.</p>}</section>};

const PrintProgress = ({orderNumber,promisedAt,jobs,pieces,selected,onSelected,reprintBusy,onReprintBill,onReprintTags,onRetry}:{orderNumber:string;promisedAt:string;jobs:CounterPrintJob[];pieces:CounterPiece[];selected:string[];onSelected:(ids:string[])=>void;reprintBusy:boolean;onReprintBill:()=>void;onReprintTags:()=>void;onRetry:(j:CounterPrintJob)=>void}) => {const[confirming,setConfirming]=useState<string|null>(null);return <section className="counter-panel counter-status-page"><h1>{orderNumber} · Print progress</h1><p>Ready by {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(promisedAt))} IST</p>{jobs.map(j=><div key={j.id} className="counter-job"><Printer/><strong>{j.kind==='bill'?'Canon customer bill':'TSC garment tags'}</strong><Badge>{j.state}</Badge>{j.lastError&&<p>{j.lastError}</p>}{j.state==='failed'&&<Button onClick={()=>onRetry(j)}>Retry {j.kind==='bill'?'bill':'tags'}</Button>}{j.state==='uncertain'&&(confirming===j.id?<div className="counter-uncertain-confirm" role="alert"><p>This job may already have printed. Check the printer output first; reprinting can create a duplicate.</p><Button onClick={()=>{setConfirming(null);onRetry(j)}}>Confirm reprint of {j.kind}</Button><Button variant="outline" onClick={()=>setConfirming(null)}>Cancel</Button></div>:<Button variant="outline" onClick={()=>setConfirming(j.id)}>Review uncertain {j.kind} job</Button>)}</div>)}<div className="counter-targeted-reprint"><h2>Reprint saved output</h2><Button variant="outline" disabled={reprintBusy} onClick={onReprintBill}>Reprint customer bill</Button><p>Select only the physical pieces that need replacement tags. IDs and saved garment/service details are reused.</p><div className="counter-piece-list">{pieces.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.shortId)} onChange={e=>onSelected(e.target.checked?[...selected,p.shortId]:selected.filter(id=>id!==p.shortId))}/><span><strong>{p.shortId}</strong> · {p.garment} / {p.service}</span><small>{p.position}/{p.total}</small></label>)}</div><Button disabled={reprintBusy||selected.length===0} onClick={onReprintTags}>Reprint selected tags ({selected.length})</Button></div></section>};
const PieceMatching = ({orderNumber,pieces,selected,onSelected,onSubmit}:{orderNumber:string;pieces:CounterPiece[];selected:string[];onSelected:(p:string[])=>void;onSubmit:()=>void}) => <section className="counter-panel counter-status-page"><h1>{orderNumber} · Packing / pickup</h1><p>Match every physical item by its printed piece ID. {selected.length} of {pieces.length} checked.</p><div className="counter-piece-list">{pieces.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>onSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><span><strong>{p.shortId}</strong> · {p.garment} / {p.service}</span><small>{p.position}/{p.total}</small></label>)}</div><Button onClick={onSubmit}>Confirm matched pieces</Button></section>;
