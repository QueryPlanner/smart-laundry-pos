import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LockKeyhole, LogOut, Printer, Search, ShieldCheck, WashingMachine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  collectCounterOrder, createCounterStaff, dispatchPrintJob, dispatchPrintJobs, enumeratePrinters, getCounterBootstrap,
  getCounterCatalogue, getCounterOrder, getOrderPieces,
  listPrintJobs, lockCounter, loginCounter, matchOrderPieces, quoteCounterOrder, recordCounterPayment,
  resetCounterStaffPin, retryPrintJob, saveCounterOrder, searchCounterCustomers, searchCounterOrders, setCounterRate,
  reprintCounterOutput,
  setCounterStaffActive, setPrinterProfiles, setupCounterAdmin, updateCounterOrderStatus,
  type CounterAccount, type CounterBootstrap, type CounterCatalogue, type CounterOrderSummary, type CounterPiece,
  type CounterPrintJob, type CounterQuote, type NativePrinter,
} from '@/lib/localFirst/counter';
import { GarmentGrid } from './GarmentGrid';
import { OrderSummary } from './OrderSummary';
import { parsePaymentAmountMinor } from '@/lib/localFirst/payment';
import { CounterAdmin } from './CounterAdmin';

const problem = (e: unknown) => e instanceof Error ? e.message : String(e || 'Something went wrong.');

export const CounterApp = ({ onAdminWorkspace }: { onAdminWorkspace: (account: CounterAccount) => void }) => {
  const [bootstrap, setBootstrap] = useState<CounterBootstrap | null>(null);
  const [account, setAccount] = useState<CounterAccount | null>(null);
  const [catalogue, setCatalogue] = useState<CounterCatalogue | null>(null);
  const [page, setPage] = useState<'order' | 'admin' | 'pieces' | 'prints' | 'orders' | 'detail' | 'queue'>('order');
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
  const [startupWarning, setStartupWarning] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderResults, setOrderResults] = useState<CounterOrderSummary[]>([]);
  const [orderOffset, setOrderOffset] = useState(0);
  const [orderHasMore, setOrderHasMore] = useState(false);
  const [orderSearchBusy, setOrderSearchBusy] = useState(false);
  const [pieceStage, setPieceStage] = useState<'packing' | 'collection'>('packing');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethodExisting, setPaymentMethodExisting] = useState<'cash' | 'upi' | 'card' | 'bank_transfer' | 'other'>('cash');
  const paymentRequestId = useRef(crypto.randomUUID());
  const collectionRequestId = useRef(crypto.randomUUID());
  const [collectionComplete, setCollectionComplete] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const reviewedQuote = useRef<CounterQuote | null>(null);
  const quoteFingerprint = useRef('');

  const refresh = useCallback(async () => {
    const b = await getCounterBootstrap(); setBootstrap(b); setAccount(b.account); setStartupWarning(b.warning || '');
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
  const currentFingerprint = useMemo(() => JSON.stringify({ customer, items: orderItems }), [customer, orderItems]);
  useEffect(() => {
    if (!account || page !== 'orders') return;
    let active = true;
    const timer = setTimeout(() => {
      setOrderSearchBusy(true);
      void searchCounterOrders(orderSearch.trim(), 0, 50).then(results => {
        if (active) { setOrderResults(results); setOrderOffset(results.length); setOrderHasMore(results.length === 50); }
      }).catch(e => { if (active) setError(problem(e)); }).finally(() => { if (active) setOrderSearchBusy(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [account, orderSearch, page]);
  useEffect(() => {
    if (!account) return;
    void listPrintJobs().then(setJobs).catch(e => setError(problem(e)));
  }, [account]);
  useEffect(() => {
    reviewedQuote.current = null;
    quoteFingerprint.current = '';
    setQuote(null);
    if (!account || !customer.name.trim() || orderItems.length === 0) return;
    let active = true;
    const timer = setTimeout(() => void quoteCounterOrder({ customer, items: orderItems }).then(q => { if (active) { reviewedQuote.current = q; quoteFingerprint.current = currentFingerprint; setQuote(q); setError(''); } }).catch(e => { if (active) { setQuote(null); setError(problem(e)); } }), 140);
    return () => { active = false; clearTimeout(timer); };
  }, [account, customer, orderItems, currentFingerprint]);

  const adjust = (garmentId: string, delta: number, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const quantity = Math.max(0, (current[key] || 0) + delta);
    const next = { ...current }; if (quantity) next[key] = quantity; else delete next[key]; return next;
  });
  const setQuantity = (garmentId: string, quantity: number, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const next = { ...current }; if (quantity > 0 && Number.isInteger(quantity)) next[key] = quantity; else delete next[key]; return next;
  });
  const signIn = async (id: string, pin: string) => { setBusy(true); setError(''); try { const a = await loginCounter(id, pin); setAccount(a); setCatalogue(await getCounterCatalogue()); setPage('order'); clearDraft(); } catch (e) { setError(problem(e)); } finally { setBusy(false); } };
  const clearDraft = () => { setCustomer({name:'',phone:''}); setLines({}); setPayment(''); setPaymentMethod('cash'); setServiceId(catalogue?.services.find(s => s.key === 'wash_iron')?.id || catalogue?.services[0]?.id || ''); setQuote(null); reviewedQuote.current=null; quoteFingerprint.current=''; setSelectedReprintPieces([]); reprintRequestKeys.current={}; setReprintBusy(false); setPieceChecks([]); setCollectionComplete(false); setPaymentReference(''); setPaymentError(''); idempotencyKey.current=crypto.randomUUID(); paymentRequestId.current=crypto.randomUUID(); collectionRequestId.current=crypto.randomUUID(); setError(''); setNotice(''); };
  const save = async () => {
    const quoteToSave=reviewedQuote.current;
    if (!account || !quoteToSave || quoteFingerprint.current!==currentFingerprint || !customer.name.trim()) return;
    const paymentMinor=parsePaymentAmountMinor(payment);
    if(paymentMinor===null){setPaymentError('Enter a finite nonnegative payment amount with at most two decimal places.');return;}
    if(paymentMinor>(quoteToSave.totalMinor)){setPaymentError('Payment cannot exceed the order total.');return;}
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveCounterOrder({ customer, items: orderItems, reviewedQuote: quoteToSave, idempotencyKey: idempotencyKey.current, ...(paymentMinor > 0 ? { payment: { amountMinor: paymentMinor, method: paymentMethod } } : {}) });
      setSaved(result); clearDraft(); setPage('prints');
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
  const loadPieces = async (orderId: string, target: 'packing'|'collection'='packing') => { const p = await getOrderPieces(orderId); setPieces(p); setPieceStage(target); setPieceChecks(p.filter(x => target==='packing'?x.packingMatched:x.collectionMatched).map(x => x.id)); setCollectionComplete(false); setPage('pieces'); };
  const submitMatches = async () => { if (!saved) return; try { const result=await matchOrderPieces(saved.orderId,pieceStage,pieceChecks); const p=await getOrderPieces(saved.orderId); setPieces(p); setPieceChecks(p.filter(x=>pieceStage==='packing'?x.packingMatched:x.collectionMatched).map(x=>x.id)); if(pieceStage==='collection'&&result.complete){const updated=await collectCounterOrder(saved.orderId,pieceChecks,collectionRequestId.current);setSaved(updated);setPieces(updated.pieces);setCollectionComplete(true);setNotice('Every garment has been verified and this order is collected.');collectionRequestId.current=crypto.randomUUID();}else{setCollectionComplete(false);setNotice(result.complete?`Every garment is checked for ${pieceStage}.`:`${result.matchedCount} of ${result.expectedCount} pieces checked for ${pieceStage}. Missing pieces must be checked.`);} } catch (e) { setError(problem(e)); } };
  const refreshJobs = async (orderId?: string) => setJobs(await listPrintJobs(orderId));
  const doRetry = async (job: CounterPrintJob) => { try { await retryPrintJob(job.id, job.state === 'uncertain'); await refreshJobs(); } catch (e) { setError(problem(e)); } };
  const resumePendingJob = async (job: CounterPrintJob) => { try { await dispatchPrintJob(job.id); await refreshJobs(); } catch (e) { setError(problem(e)); } };
  const openOrder = async (orderId: string) => { setBusy(true); setError(''); try { const result = await getCounterOrder(orderId); if (!result) throw new Error('This order is no longer available.'); setSaved(result); setPieces(result.pieces); setJobs(result.printJobs); setPieceChecks([]); setCollectionComplete(false); setPage('detail'); } catch (e) { setError(problem(e)); } finally { setBusy(false); } };
  const updateStatus = async (status: 'washing'|'drying'|'ironing'|'quality_check'|'packing'|'ready') => { if (!saved) return; setBusy(true); try { const result = await updateCounterOrderStatus(saved.orderId,status); setSaved(result); setNotice(`Order ${result.orderNumber} moved to ${status.replace('_',' ')}.`); void searchCounterOrders(orderSearch.trim(),0,50).then(setOrderResults); } catch(e) { setError(problem(e)); } finally { setBusy(false); } };
  const addPayment = async () => { if (!saved) return; const amountMinor = parsePaymentAmountMinor(payment); if (amountMinor === null || amountMinor <= 0) { setPaymentError('Enter a payment greater than zero with at most two decimal places.'); return; } if (amountMinor > saved.balanceMinor) { setPaymentError('Payment cannot exceed the remaining balance.'); return; } setBusy(true); setPaymentError(''); try { const result=await recordCounterPayment(saved.orderId,{amountMinor,method:paymentMethodExisting,reference:paymentReference.trim()||undefined,idempotencyKey:paymentRequestId.current}); setSaved(result); setPayment(''); setPaymentReference(''); paymentRequestId.current=crypto.randomUUID(); setNotice('Payment saved to this order.'); } catch(e) { setPaymentError(problem(e)); } finally { setBusy(false); } };
  const reprint = async (kind: 'bill' | 'tags', pieceIds: string[] = []) => {
    if (!saved) return;
    const selected = kind === 'tags' ? [...new Set(pieceIds)].sort() : [];
    if (kind === 'tags' && selected.length === 0) return;
    const requestKey = `${kind}:${selected.join(',')}`;
    const requestId = reprintRequestKeys.current[requestKey] ||= crypto.randomUUID();
    setReprintBusy(true); setError('');
    try {
      const job=await reprintCounterOutput(saved.orderId, kind, selected, requestId);
      await dispatchPrintJob(job.id);
      await refreshJobs();
      delete reprintRequestKeys.current[requestKey];
      setSelectedReprintPieces([]);
      setNotice(kind === 'bill' ? 'A bill reprint was added to the Canon queue.' : `${selected.length} selected garment tag(s) were added to the TSC queue.`);
    } catch (e) {
      setError(`The ${kind} reprint request may already be saved. Retry this same selection to safely resume: ${problem(e)}`);
    } finally { setReprintBusy(false); }
  };
  const openPrinterSettings = async () => { setPrinters(await enumeratePrinters()); setPage('admin'); };
  const logout = async () => { await lockCounter(); clearDraft(); setSaved(null); setJobs([]); setPieces([]); setOrderResults([]); setOrderSearch(''); setOrderOffset(0); setPieceChecks([]); setSelectedReprintPieces([]); setAccount(null); setCatalogue(null); setPage('order'); setBootstrap(await getCounterBootstrap()); };

  if (!bootstrap) return <div className="counter-auth"><p>Opening local counter…</p></div>;
  if (bootstrap.setupRequired) return <Setup onDone={async name => { try { const a = await setupCounterAdmin({ fullName: name.fullName, pin: name.pin }); setAccount(a); setCatalogue(await getCounterCatalogue()); const next=await getCounterBootstrap(); setBootstrap(next); setStartupWarning(next.warning||''); } catch (e) { setError(problem(e)); } }} error={error} />;
  if (!account) return <Login accounts={bootstrap.accounts || []} busy={busy} error={error} onLogin={signIn} onRefresh={() => void refresh()} />;
  const admin = account.role === 'admin';

  return <div className="counter-shell">
    <header className="counter-topbar"><div className="counter-brand"><span className="counter-brand-mark"><WashingMachine /></span><span><strong>Smart Laundry</strong><small>Counter · Offline</small></span></div><div className="counter-session"><Badge variant="outline">{admin ? 'Admin' : 'Staff'} · {account.fullName}</Badge><Button variant="outline" size="sm" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" />Lock</Button></div></header>
    <nav className="counter-nav" aria-label="Counter sections"><button className={page === 'order' ? 'active' : ''} onClick={() => { clearDraft(); setSaved(null); setPage('order'); }}>New order</button><button className={page === 'orders' || page === 'detail' ? 'active' : ''} onClick={() => setPage('orders')}>Orders / Pickup</button><button className={page === 'queue' ? 'active' : ''} onClick={() => { void refreshJobs(); setPage('queue'); }}>Print queue</button>{saved && <><button className={page === 'prints' ? 'active' : ''} onClick={() => { void refreshJobs(saved.orderId); setPage('prints'); }}>Print progress</button><button className={page === 'pieces' ? 'active' : ''} onClick={() => void loadPieces(saved.orderId)}>Packing / pickup</button></>}{admin && <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}><ShieldCheck className="h-4 w-4" />Admin</button>}</nav>
    {notice && <p className="counter-notice" role="status">{notice}</p>}{error && <p className="counter-error" role="alert">{error}</p>}
    {startupWarning && <p className="counter-error" role="status">{startupWarning}</p>}
    {page === 'order' && <div className="counter-layout"><main className="counter-main"><CustomerEntry customer={customer} onChange={setCustomer} search={searchCounterCustomers} /><section className="counter-panel"><div className="counter-services" role="tablist" aria-label="Service"><span className="counter-section-label">Choose service</span>{catalogue?.services.filter(x => x.active).map(s => <button key={s.id} role="tab" aria-selected={s.id === serviceId} className={s.id === serviceId ? 'selected' : ''} onClick={() => setServiceId(s.id)}>{s.name}</button>)}</div><GarmentGrid catalogue={catalogue} serviceId={serviceId} lines={lines} onAdd={id => adjust(id, 1)} onQuantity={setQuantity} /></section></main><aside className="counter-aside"><OrderSummary catalogue={catalogue} lines={lines} quote={quote} customer={customer} payment={payment} onPayment={value => { setPayment(value); setPaymentError(''); }} paymentError={paymentError} onPaymentError={setPaymentError} paymentMethod={paymentMethod} onPaymentMethod={setPaymentMethod} onRemove={(id, sid) => adjust(id, -1, sid)} onQuantity={setQuantity} onSave={() => void save()} busy={busy} /></aside></div>}
    {page === 'orders' && <section className="counter-panel counter-status-page"><h1>Orders / Pickup</h1><Label htmlFor="counter-order-search">Search bill number or customer mobile<Input id="counter-order-search" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} placeholder="Bill number or mobile" /></Label>{orderSearchBusy&&<p role="status">Searching saved orders…</p>}{orderResults.length===0&&!orderSearchBusy&&<p>No matching saved orders.</p>}<div className="counter-order-results">{orderResults.map(item=><article key={item.id}><div><strong>{item.orderNumber}</strong><span>{item.customerName} · {item.customerPhone}</span></div><div><Badge>{item.status.replace('_',' ')}</Badge><span>Balance ₹{(item.balanceMinor/100).toFixed(2)} · {item.pieceCount} pieces</span></div><Button variant="outline" disabled={busy} onClick={()=>void openOrder(item.id)}>Open order</Button></article>)}</div>{orderHasMore&&<Button variant="outline" onClick={()=>{setOrderSearchBusy(true);void searchCounterOrders(orderSearch.trim(),orderOffset,50).then(next=>{setOrderResults(current=>[...current,...next]);setOrderOffset(orderOffset+next.length);setOrderHasMore(next.length===50)}).catch(e=>setError(problem(e))).finally(()=>setOrderSearchBusy(false));}}>Load more</Button>}</section>}
    {page === 'detail' && saved && <section className="counter-panel counter-status-page"><h1>{saved.orderNumber} · Order details</h1><p>Received {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(saved.receivedAt))} · Ready by {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(saved.promisedAt))}</p><div className="counter-order-totals"><span>Total ₹{(saved.totalMinor/100).toFixed(2)}</span><span>Paid ₹{(saved.paidMinor/100).toFixed(2)}</span><strong>Balance ₹{(saved.balanceMinor/100).toFixed(2)}</strong></div><Label>Processing status<select value={saved.status} disabled={busy||saved.status==='collected'} onChange={event=>void updateStatus(event.target.value as 'washing'|'drying'|'ironing'|'quality_check'|'packing'|'ready')}><option value="received">Received</option><option value="washing">Washing</option><option value="drying">Drying</option><option value="ironing">Ironing</option><option value="quality_check">Quality check</option><option value="packing">Packing</option><option value="ready">Ready for pickup</option><option value="collected">Collected</option></select></Label>{saved.balanceMinor>0&&<div className="counter-payment"><h2>Record later payment</h2><Label htmlFor="later-payment">Amount received<Input id="later-payment" type="number" min="0" step="0.01" value={payment} onChange={event=>{setPayment(event.target.value);setPaymentError('')}} /></Label><Label htmlFor="later-payment-method">Method<select id="later-payment-method" value={paymentMethodExisting} onChange={event=>setPaymentMethodExisting(event.target.value as typeof paymentMethodExisting)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></Label><Label htmlFor="payment-reference">Reference (optional)<Input id="payment-reference" value={paymentReference} onChange={event=>setPaymentReference(event.target.value)} /></Label>{paymentError&&<p role="alert">{paymentError}</p>}<Button disabled={busy} onClick={()=>void addPayment()}>Save payment</Button></div>}<div className="counter-order-actions"><Button onClick={()=>void loadPieces(saved.orderId,'packing')}>Packing checklist</Button><Button disabled={saved.status!=='ready'} onClick={()=>void loadPieces(saved.orderId,'collection')}>Verify pickup collection</Button><Button variant="outline" onClick={()=>{void refreshJobs(saved.orderId);setPage('prints')}}>Print progress / reprints</Button></div></section>}
    {page === 'admin' && admin && <CounterAdmin catalogue={catalogue} onCatalogue={setCatalogue} printers={printers} onReloadPrinters={openPrinterSettings} onOldAdmin={() => onAdminWorkspace(account)} onError={e => setError(problem(e))} onNotice={setNotice} />}
    {page === 'prints' && saved && <PrintProgress orderNumber={saved.orderNumber} promisedAt={saved.promisedAt} jobs={jobs.length ? jobs : saved.printJobs} pieces={saved.pieces} selected={selectedReprintPieces} onSelected={setSelectedReprintPieces} reprintBusy={reprintBusy} onReprintBill={() => void reprint('bill')} onReprintTags={() => void reprint('tags', selectedReprintPieces)} onRetry={doRetry} onResume={resumePendingJob} />}
    {page === 'pieces' && saved && <PieceMatching orderNumber={saved.orderNumber} stage={pieceStage} pieces={pieces} selected={pieceChecks} complete={collectionComplete} onSelected={setPieceChecks} onSubmit={() => void submitMatches()} />}
    {page === 'queue' && <PrintQueue jobs={jobs} onRefresh={() => void refreshJobs()} onOpenOrder={orderId=>void openOrder(orderId)} onRetry={doRetry} onResume={resumePendingJob} />}
  </div>;
};

const Setup = ({ onDone, error }: { onDone: (x: { fullName: string; pin: string }) => void; error: string }) => { const [fullName,setName]=useState(''); const [pin,setPin]=useState(''); const [confirm,setConfirm]=useState(''); const [localError,setError]=useState(''); return <div className="counter-auth"><form onSubmit={e=>{e.preventDefault(); if(pin!==confirm){setError('PINs do not match.');return;} onDone({fullName,pin});}} className="counter-auth-card"><WashingMachine /><h1>Set up Smart Laundry</h1><p>Create the first named administrator account.</p><Label>Admin name<Input value={fullName} onChange={e=>setName(e.target.value)} required /></Label><Label>PIN<Input value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label><Label>Confirm PIN<Input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" inputMode="numeric" required /></Label>{(error||localError)&&<p role="alert">{error||localError}</p>}<Button type="submit">Create admin account</Button></form></div>; };
const Login = ({ accounts, busy, error, onLogin, onRefresh }: { accounts: CounterAccount[]; busy:boolean; error:string; onLogin:(id:string,pin:string)=>void; onRefresh:()=>void }) => { const [id,setId]=useState(''); const [pin,setPin]=useState(''); const [admin,setAdmin]=useState(false); const shown=accounts.filter(a=>a.role===(admin?'admin':'staff')&&a.active); return <div className="counter-auth"><form className="counter-auth-card" onSubmit={e=>{e.preventDefault();if(id)onLogin(id,pin);}}><WashingMachine/><h1>Smart Laundry</h1><p>Choose your name and enter your PIN.</p><div className="counter-role-toggle"><button type="button" className={!admin?'selected':''} onClick={()=>{setAdmin(false);setId('');}}>Staff login</button><button type="button" className={admin?'selected':''} onClick={()=>{setAdmin(true);setId('');}}>Admin</button></div><Label>Name<select value={id} onChange={e=>setId(e.target.value)} required><option value="">Choose {admin?'administrator':'staff member'}</option>{shown.map(a=><option key={a.id} value={a.id}>{a.fullName}</option>)}</select></Label><Label>PIN<Input autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label>{error&&<p role="alert">{error}</p>}<Button disabled={busy||!id} type="submit"><LockKeyhole className="mr-2 h-4 w-4"/>{busy?'Signing in…':'Sign in'}</Button><button className="counter-link" type="button" onClick={onRefresh}>Refresh account list</button></form></div>; };

const CustomerEntry = ({customer,onChange,search}:{customer:{name:string;phone:string;customerId?:string};onChange:(c:{name:string;phone:string;customerId?:string})=>void;search:(phone:string)=>Promise<Array<{id:string;name:string;phone:string}>>}) => {const[hits,setHits]=useState<Array<{id:string;name:string;phone:string}>>([]);const[searchError,setSearchError]=useState('');useEffect(()=>{if(customer.phone.trim().length<3){setHits([]);return;}let live=true;const t=setTimeout(()=>void search(customer.phone).then(x=>{if(live){setHits(x);setSearchError('')}}).catch(e=>live&&setSearchError(problem(e))),250);return()=>{live=false;clearTimeout(t)}},[customer.phone,search]);return <section className="counter-customer counter-panel"><div><span className="counter-section-label">Customer</span><p>Look up by mobile or add a new customer</p></div><Label>Mobile number<Input value={customer.phone} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" onChange={e=>onChange({...customer,phone:e.target.value,customerId:undefined})}/></Label><Label>Name<Input value={customer.name} autoComplete="name" placeholder="Customer name" onChange={e=>onChange({...customer,name:e.target.value,customerId:undefined})}/></Label>{hits.length>0&&<div className="counter-customer-matches" role="listbox" aria-label="Matching customers">{hits.map(c=><button type="button" role="option" aria-selected={customer.customerId===c.id} key={c.id} onClick={()=>{onChange({name:c.name,phone:c.phone,customerId:c.id});setHits([])}}><strong>{c.name}</strong><span>{c.phone}</span></button>)}</div>}{searchError&&<p role="status">Customer lookup unavailable; enter details manually.</p>}</section>};

const PrintProgress = ({orderNumber,promisedAt,jobs,pieces,selected,onSelected,reprintBusy,onReprintBill,onReprintTags,onRetry,onResume}:{orderNumber:string;promisedAt:string;jobs:CounterPrintJob[];pieces:CounterPiece[];selected:string[];onSelected:(ids:string[])=>void;reprintBusy:boolean;onReprintBill:()=>void;onReprintTags:()=>void;onRetry:(j:CounterPrintJob)=>void;onResume:(j:CounterPrintJob)=>void}) => {const[confirming,setConfirming]=useState<string|null>(null);return <section className="counter-panel counter-status-page"><h1>{orderNumber} · Print progress</h1><p>Ready by {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(promisedAt))} IST</p>{jobs.map(j=><div key={j.id} className="counter-job"><Printer/><strong>{j.kind==='bill'?'Canon customer bill':'TSC garment tags'}</strong><Badge>{j.state}</Badge>{j.lastError&&<p>{j.lastError}</p>}{j.state==='pending'&&<Button onClick={()=>onResume(j)}>Resume {j.kind}</Button>}{j.state==='failed'&&<Button onClick={()=>onRetry(j)}>Retry {j.kind==='bill'?'bill':'tags'}</Button>}{j.state==='uncertain'&&(confirming===j.id?<div className="counter-uncertain-confirm" role="alert"><p>This job may already have printed. Check the printer output first; reprinting can create a duplicate.</p><Button onClick={()=>{setConfirming(null);onRetry(j)}}>Confirm reprint of {j.kind}</Button><Button variant="outline" onClick={()=>setConfirming(null)}>Cancel</Button></div>:<Button variant="outline" onClick={()=>setConfirming(j.id)}>Review uncertain {j.kind} job</Button>)}</div>)}<div className="counter-targeted-reprint"><h2>Reprint saved output</h2><Button variant="outline" disabled={reprintBusy} onClick={onReprintBill}>Reprint customer bill</Button><p>Select only the physical pieces that need replacement tags. IDs and saved garment/service details are reused.</p><div className="counter-piece-list">{pieces.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.shortId)} onChange={e=>onSelected(e.target.checked?[...selected,p.shortId]:selected.filter(id=>id!==p.shortId))}/><span><strong>{p.shortId}</strong> · {p.garment} / {p.service}</span><small>{p.position}/{p.total}</small></label>)}</div><Button disabled={reprintBusy||selected.length===0} onClick={onReprintTags}>Reprint selected tags ({selected.length})</Button></div></section>};
const PieceMatching = ({orderNumber,stage,pieces,selected,complete,onSelected,onSubmit}:{orderNumber:string;stage:'packing'|'collection';pieces:CounterPiece[];selected:string[];complete:boolean;onSelected:(p:string[])=>void;onSubmit:()=>void}) => <section className="counter-panel counter-status-page"><h1>{orderNumber} · {stage==='packing'?'Packing checklist':'Pickup collection'}</h1><p>{stage==='packing'?'Check the physical pieces as they are packed. Unchecking a piece clears its prior packing match.':'Check each printed piece ID with the customer before completing collection.'} {selected.length} of {pieces.length} checked.</p><div className="counter-piece-list">{pieces.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>onSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><span><strong>{p.shortId}</strong> · {p.garment} / {p.service}</span><small>{p.position}/{p.total}</small></label>)}</div>{complete&&<p role="status">All pieces collected.</p>}<Button disabled={stage==='collection'&&selected.length!==pieces.length} onClick={onSubmit}>{stage==='packing'?'Save packing checklist':'Verify and complete collection'}</Button></section>;

const PrintQueue = ({jobs,onRefresh,onOpenOrder,onRetry,onResume}:{jobs:CounterPrintJob[];onRefresh:()=>void;onOpenOrder:(id:string)=>void;onRetry:(job:CounterPrintJob)=>void;onResume:(job:CounterPrintJob)=>void}) => {const[confirming,setConfirming]=useState<string|null>(null);return <section className="counter-panel counter-status-page"><div className="counter-admin-heading"><h1>Saved print queue</h1><Button variant="outline" onClick={onRefresh}>Refresh queue</Button></div><p>Pending output remains saved across app restarts. Resume or retry each printer job independently.</p>{jobs.length===0?<p>No saved print jobs.</p>:jobs.map(job=><article className="counter-job" key={job.id}><div><strong>{job.orderNumber} · {job.kind==='bill'?'Canon bill':'TSC tags'}</strong><Badge>{job.state}</Badge>{job.lastError&&<p>{job.lastError}</p>}</div><Button variant="outline" onClick={()=>onOpenOrder(job.orderId)}>Open order</Button>{job.state==='pending'&&<Button onClick={()=>onResume(job)}>Resume this job</Button>}{job.state==='failed'&&<Button onClick={()=>onRetry(job)}>Retry this job</Button>}{job.state==='uncertain'&&(confirming===job.id?<div role="alert"><p>Check the printer first; confirm only if you need another copy.</p><Button onClick={()=>{setConfirming(null);onRetry(job)}}>Confirm reprint</Button><Button variant="outline" onClick={()=>setConfirming(null)}>Cancel</Button></div>:<Button variant="outline" onClick={()=>setConfirming(job.id)}>Review uncertain job</Button>)}</article>)}</section>};
