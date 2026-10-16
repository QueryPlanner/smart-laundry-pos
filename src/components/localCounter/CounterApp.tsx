import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, LayoutDashboard, LockKeyhole, LogOut, Package, Printer, Receipt, Settings, ShieldCheck, ShoppingBasket, Store, Users, WashingMachine, Wrench, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cancelCounterOrder, collectCounterOrder, dispatchPrintJob, dispatchPrintJobs, enumeratePrinters, getCounterBootstrap,
  getCounterCatalogue, getCounterOrder, getOrderPieces,
  listPrintJobs, lockCounter, loginCounter, matchOrderPieces, quoteCounterOrder, recordCounterPayment,
  retryPrintJob, saveCounterOrder, searchCounterCustomers, searchCounterOrders,
  reprintCounterOutput,
  setupCounterAdmin, updateCounterOrderStatus,
  type CounterAccount, type CounterBootstrap, type CounterCatalogue, type CounterOrderSummary, type CounterPiece,
  type CounterPrintJob, type CounterQuote, type CounterSavedOrder, type NativePrinter,
} from '@/lib/localFirst/counter';
import { GarmentGrid } from './GarmentGrid';
import { OrderSummary } from './OrderSummary';
import { parsePaymentAmountMinor } from '@/lib/localFirst/payment';
import { CounterAdmin } from './CounterAdmin';
import { RestorePendingBanner } from './RestorePendingBanner';
import { CancelOrder } from './CancelOrder';
import { PrintProgress, PrintQueue } from './PrintJobs';
import { JOB_STATE_LABEL } from './printJobState';
import { defaultServiceId } from './orderDefaults';
import { canOpen, visibleNavGroups, type SectionId, type SectionProps } from './sections';
import { DashboardPage } from './DashboardPage';
import { SalesPage } from './SalesPage';
import { CustomersPage } from './CustomersPage';
import { ExpensesPage } from './ExpensesPage';
import { InventoryPage } from './InventoryPage';
import { MachinesPage } from './MachinesPage';
import { ShopSettingsPage } from './ShopSettingsPage';

const problem = (e: unknown) => e instanceof Error ? e.message : String(e || 'Something went wrong.');

// Fragments of the native error text that need their own wording or recovery.
const SAVE_KEY_REUSED = 'already used for a different order draft';
const QUOTE_OUT_OF_DATE = 'Review the refreshed quote';
const SAVE_MAY_EXIST = 'This order may already be saved. Check Orders / Pickup for the bill before saving again.';

/** Lets an async handler run one at a time: a second tap while the first is still working is ignored. */
const useSingleFlight = () => {
  const running = useRef(false);
  return useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    try { await action(); } finally { running.current = false; }
  }, []);
};

/** Everything the workspace can show: the registry sections plus the per-order pages reached from an order. */
type Page = SectionId | 'detail' | 'prints' | 'pieces';

/** Where a tap on the navigation or Lock goes. Leaving the order page with a draft needs a confirmation first. */
type Destination = Page | 'lock';

const NAV_ICON: Record<SectionId, LucideIcon> = {
  order: ShoppingBasket, orders: ClipboardList, queue: Printer, dashboard: LayoutDashboard, sales: BarChart3,
  customers: Users, expenses: Receipt, inventory: Package, machines: Wrench, admin: ShieldCheck, settings: Settings,
};

export const CounterApp = () => {
  const [bootstrap, setBootstrap] = useState<CounterBootstrap | null>(null);
  const [account, setAccount] = useState<CounterAccount | null>(null);
  const [catalogue, setCatalogue] = useState<CounterCatalogue | null>(null);
  const [page, setPage] = useState<Page>('order');
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<{ name: string; phone: string; customerId?: string }>({ name: '', phone: '' });
  const [quote, setQuote] = useState<CounterQuote | null>(null);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [pendingLeave, setPendingLeave] = useState<Destination | null>(null);
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
  const [restoreStaged, setRestoreStaged] = useState(false);
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
  const printActionOnce = useSingleFlight();
  const matchesOnce = useSingleFlight();

  const refresh = useCallback(async () => {
    const b = await getCounterBootstrap(); setBootstrap(b); setAccount(b.account); setStartupWarning(b.warning || '');
    if (b.authenticated) setCatalogue(await getCounterCatalogue());
  }, []);
  useEffect(() => { void refresh().catch(e => setError(problem(e))); }, [refresh]);
  const retryStartup = () => {
    setError('');
    void refresh().catch(e => setError(problem(e)));
  };
  // Stable so that admin tabs, which load their data in effects, do not reload on every render here.
  const reportError = useCallback((e: unknown) => setError(problem(e)), []);
  useEffect(() => {
    if (!catalogue || !catalogue.services.length) return;
    setServiceId(current => current || defaultServiceId(catalogue));
  }, [catalogue]);
  const orderItems = useMemo(() => Object.entries(lines).filter(([, q]) => q > 0).map(([key, quantity]) => {
    const [garmentId, treatmentId] = key.split('|'); return { garmentId, serviceId: treatmentId, quantity };
  }), [lines]);
  const draftInProgress = orderItems.length > 0 || customer.name.trim() !== '' || customer.phone.trim() !== '';
  const reloadOrderResults = () => {
    void searchCounterOrders(orderSearch.trim(), 0, 50).then(setOrderResults).catch(e => setError(problem(e)));
  };
  useEffect(() => {
    if (!account || page !== 'orders') return;
    let active = true;
    setOrderSearchBusy(true);
    const timer = setTimeout(() => {
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
    setQuote(null);
    setQuoteError('');
    if (!account || !customer.name.trim() || orderItems.length === 0) return;
    let active = true;
    const timer = setTimeout(() => {
      void quoteCounterOrder({ customer, items: orderItems }).then(q => {
        if (!active) return;
        reviewedQuote.current = q;
        setQuote(q);
      }).catch(e => { if (active) setQuoteError(problem(e)); });
    }, 140);
    return () => { active = false; clearTimeout(timer); };
  }, [account, customer, orderItems, quoteRefresh]);

  const addGarment = (garmentId: string, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`;
    return { ...current, [key]: (current[key] || 0) + 1 };
  });
  const setQuantity = (garmentId: string, quantity: number, treatment = serviceId) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const next = { ...current }; if (quantity > 0 && Number.isInteger(quantity)) next[key] = quantity; else delete next[key]; return next;
  });
  const signIn = async (id: string, pin: string) => {
    setBusy(true); setError('');
    try {
      const a = await loginCounter(id, pin);
      setAccount(a); setCatalogue(await getCounterCatalogue()); setPage('order'); clearDraft();
      // A new person must never see the previous person's order tabs.
      setSaved(null);
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  /** State that belongs to the order being looked at, including the keys that make retries safe. */
  const resetOrderScopedState = () => {
    setPayment(''); setPaymentMethodExisting('cash'); setPaymentReference(''); setPaymentError('');
    setSelectedReprintPieces([]); reprintRequestKeys.current = {};
    setPieceChecks([]); setCollectionComplete(false);
    paymentRequestId.current = crypto.randomUUID(); collectionRequestId.current = crypto.randomUUID();
  };
  const clearDraft = () => {
    setCustomer({ name: '', phone: '' }); setLines({}); setPaymentMethod('cash'); setServiceId(defaultServiceId(catalogue));
    setQuote(null); setQuoteError(''); reviewedQuote.current = null;
    setReprintBusy(false); resetOrderScopedState();
    idempotencyKey.current = crypto.randomUUID();
    setError(''); setNotice('');
  };
  const save = async () => {
    // The Save button is only enabled with a quote for exactly this draft, and the native save
    // rejects any quote that does not match the order, so a stale quote can never be charged.
    const quoteToSave = reviewedQuote.current as CounterQuote;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveCounterOrder({ customer, items: orderItems, reviewedQuote: quoteToSave, idempotencyKey: idempotencyKey.current, ...(quoteToSave.totalMinor > 0 ? { payment: { amountMinor: quoteToSave.totalMinor, method: paymentMethod } } : {}) });
      setSaved(result); clearDraft(); setPage('prints');
      try {
        const dispatched = await dispatchPrintJobs(result.orderId);
        setJobs(dispatched);
        setNotice(`Order ${result.orderNumber} saved. Current bill and tag queue states are shown below.`);
      } catch (dispatchError) {
        setJobs(result.printJobs);
        setError(`Order ${result.orderNumber} is saved, but print dispatch failed: ${problem(dispatchError)}. Use the print queue to review or retry each output.`);
      }
    } catch (e) { reportSaveFailure(problem(e)); }
    finally { setBusy(false); }
  };
  const reportSaveFailure = (message: string) => {
    if (message.includes(SAVE_KEY_REUSED)) {
      // The request key stays: if the first save did go through, retrying with it cannot duplicate the order.
      setError(SAVE_MAY_EXIST);
      return;
    }
    if (message.includes(QUOTE_OUT_OF_DATE)) {
      // Rates or the promised date moved on (for example after midnight IST): fetch a fresh quote for
      // the same draft so the operator can see the new total and date, then save again.
      setError(message);
      setQuoteRefresh(count => count + 1);
      return;
    }
    setError(`Order save did not complete: ${message}. The same request key will be retained if you retry.`);
  };
  const loadPieces = async (orderId: string, target: 'packing'|'collection'='packing') => { try { const p = await getOrderPieces(orderId); setPieces(p); setPieceStage(target); setPieceChecks(p.filter(x => target==='packing'?x.packingMatched:x.collectionMatched).map(x => x.id)); setCollectionComplete(false); setPage('pieces'); } catch (e) { setError(problem(e)); } };
  const submitMatches = (order: CounterSavedOrder) => matchesOnce(async () => {
    try {
      const result = await matchOrderPieces(order.orderId, pieceStage, pieceChecks);
      const refreshed = await getOrderPieces(order.orderId);
      setPieces(refreshed);
      setPieceChecks(refreshed.filter(x => pieceStage === 'packing' ? x.packingMatched : x.collectionMatched).map(x => x.id));
      if (pieceStage === 'collection' && result.complete) {
        const updated = await collectCounterOrder(order.orderId, pieceChecks, collectionRequestId.current);
        setSaved(updated);
        setPieces(updated.pieces);
        setCollectionComplete(true);
        setNotice('Every garment has been verified and this order is collected.');
        collectionRequestId.current = crypto.randomUUID();
      } else {
        setCollectionComplete(false);
        setNotice(result.complete ? `Every garment is checked for ${pieceStage}.` : `${result.matchedCount} of ${result.expectedCount} pieces checked for ${pieceStage}. Missing pieces must be checked.`);
      }
    } catch (e) { setError(problem(e)); }
  });
  const refreshJobs = async (orderId?: string) => { try { setJobs(await listPrintJobs(orderId)); } catch (e) { setError(problem(e)); } };
  // Only the Print queue page shows every order's jobs; anywhere else the list stays that order's own.
  const refreshJobsAfterAction = (orderId: string) => refreshJobs(page === 'queue' ? undefined : orderId);
  const doRetry = (job: CounterPrintJob) => printActionOnce(async () => {
    try { await retryPrintJob(job.id, job.state === 'uncertain'); await refreshJobsAfterAction(job.orderId); } catch (e) { setError(problem(e)); }
  });
  const resumePendingJob = (job: CounterPrintJob) => printActionOnce(async () => {
    try { await dispatchPrintJob(job.id); await refreshJobsAfterAction(job.orderId); } catch (e) { setError(problem(e)); }
  });
  const openOrder = async (orderId: string) => {
    setBusy(true); setError('');
    try {
      const result = await getCounterOrder(orderId);
      if (!result) throw new Error('This order is no longer available.');
      // Another order must not inherit the previous one's payment form, reprint picks or request keys.
      if (saved?.orderId !== result.orderId) resetOrderScopedState();
      setSaved(result); setPieces(result.pieces); setJobs(result.printJobs);
      setPieceChecks([]); setCollectionComplete(false); setNotice(''); setPage('detail');
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  const updateStatus = async (order: CounterSavedOrder, status: 'washing'|'drying'|'ironing'|'quality_check'|'packing'|'ready') => {
    setBusy(true);
    try {
      const result = await updateCounterOrderStatus(order.orderId, status);
      setSaved(result);
      setNotice(`Order ${result.orderNumber} moved to ${status.replace('_', ' ')}.`);
      reloadOrderResults();
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  const cancelOrder = async (order: CounterSavedOrder, reason: string) => {
    setBusy(true); setError('');
    try {
      const result = await cancelCounterOrder(order.orderId, reason);
      setSaved(result);
      setNotice('Order cancelled. Hand back any money received.');
      reloadOrderResults();
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  const addPayment = async (order: CounterSavedOrder) => { const amountMinor = parsePaymentAmountMinor(payment); if (amountMinor === null || amountMinor <= 0) { setPaymentError('Enter a payment greater than zero with at most two decimal places.'); return; } if (amountMinor > order.balanceMinor) { setPaymentError('Payment cannot exceed the remaining balance.'); return; } setBusy(true); setPaymentError(''); try { const result=await recordCounterPayment(order.orderId,{amountMinor,method:paymentMethodExisting,reference:paymentReference.trim()||undefined,idempotencyKey:paymentRequestId.current}); setSaved(result); setPayment(''); setPaymentReference(''); paymentRequestId.current=crypto.randomUUID(); setNotice('Payment saved to this order.'); } catch(e) { setPaymentError(problem(e)); } finally { setBusy(false); } };
  const reprint = (order: CounterSavedOrder, kind: 'bill' | 'tags', pieceIds: string[] = []) => printActionOnce(async () => {
    const selected = kind === 'tags' ? [...new Set(pieceIds)].sort() : [];
    const requestKey = `${kind}:${selected.join(',')}`;
    const requestId = reprintRequestKeys.current[requestKey] ||= crypto.randomUUID();
    setReprintBusy(true); setError('');
    try {
      const created = await reprintCounterOutput(order.orderId, kind, selected, requestId);
      const dispatched = await dispatchPrintJob(created.id);
      await refreshJobs(order.orderId);
      if (dispatched.state !== 'submitted') {
        // The reprint exists but the printer did not take it. Keep the request key so the same
        // selection resumes the same job instead of creating another one.
        setError(`The reprint was saved but did not print (${JOB_STATE_LABEL[dispatched.state]}). Use Retry in the Print queue.`);
        return;
      }
      delete reprintRequestKeys.current[requestKey];
      setSelectedReprintPieces([]);
      setNotice(kind === 'bill' ? 'A bill reprint was added to the Canon queue.' : `${selected.length} selected garment tag(s) were added to the TSC queue.`);
    } catch (e) {
      setError(`The ${kind} reprint request may already be saved. Retry this same selection to safely resume: ${problem(e)}`);
    } finally { setReprintBusy(false); }
  });
  const openPrinterSettings = async () => { try { setPrinters(await enumeratePrinters()); setPage('admin'); } catch (e) { setError(problem(e)); } };
  const logout = async () => { try { await lockCounter(); } catch (e) { setError(`The counter could not be locked: ${problem(e)}`); return; } clearDraft(); setSaved(null); setJobs([]); setPieces([]); setOrderResults([]); setOrderSearch(''); setOrderOffset(0); setPieceChecks([]); setSelectedReprintPieces([]); setAccount(null); setCatalogue(null); setPage('order'); setBootstrap(await getCounterBootstrap()); };

  /** Moves to a page, doing whatever that page needs loaded first. */
  const arrive = (destination: Destination) => {
    if (destination === 'lock') { void logout(); return; }
    if (destination === 'order') { clearDraft(); setSaved(null); }
    if (destination === 'queue') void refreshJobs();
    if (destination === 'prints') void refreshJobs((saved as CounterSavedOrder).orderId);
    if (destination === 'pieces') { void loadPieces((saved as CounterSavedOrder).orderId); return; }
    setPage(destination);
  };
  /** Goes there at once, or asks first when it would walk away from an order that is being taken. */
  const leaveTo = (destination: Destination) => {
    if (destination === 'order' && page === 'order') return;
    if (draftInProgress && destination !== 'order') { setPendingLeave(destination); return; }
    arrive(destination);
  };
  const discardDraftAndLeave = () => {
    const destination = pendingLeave as Destination;
    setPendingLeave(null);
    // A failed lock keeps the draft, so only clear it for pages that really replace it.
    if (destination !== 'lock') clearDraft();
    arrive(destination);
  };
  const keepEditing = () => setPendingLeave(null);
  // Section pages load their own data in effects; keep these callbacks stable so they do not reload on every render here.
  const openOrderRef = useRef(openOrder);
  openOrderRef.current = openOrder;
  const onOpenOrder = useCallback((orderId: string) => void openOrderRef.current(orderId), []);

  const restoreWaiting = restoreStaged || !!bootstrap?.restorePending;
  if (!bootstrap) {
    // A failed start-up must say so; the spinner text is only for a request that is really pending.
    if (error) return <div className="counter-auth"><div className="counter-auth-card"><WashingMachine /><h1>Smart Laundry</h1><p role="alert">{error}</p><Button onClick={retryStartup}>Try again</Button></div></div>;
    return <div className="counter-auth"><p>Opening local counter…</p></div>;
  }
  if (bootstrap.setupRequired) return <Setup onDone={async name => { try { const a = await setupCounterAdmin({ fullName: name.fullName, pin: name.pin }); setAccount(a); setCatalogue(await getCounterCatalogue()); const next=await getCounterBootstrap(); setBootstrap(next); setStartupWarning(next.warning||''); } catch (e) { setError(problem(e)); } }} error={error} />;
  if (!account) return <>{restoreWaiting && <RestorePendingBanner />}<Login accounts={bootstrap.accounts || []} busy={busy} error={error} onLogin={signIn} onRefresh={() => void refresh().catch(e => setError(problem(e)))} /></>;
  const admin = account.role === 'admin';
  const orderCancelled = saved?.status === 'cancelled';
  const shortOrderQuery = orderSearch.trim().length === 1;
  // Jobs of other orders can sit in the shared list; this page only ever shows its own order's.
  const savedOrderJobs = saved ? jobs.filter(j => j.orderId === saved.orderId) : [];

  const activeSection: Page = page === 'detail' ? 'orders' : page;
  const sectionProps: SectionProps = { account, onError: reportError, onNotice: setNotice, onOpenOrder };
  const showing = (section: SectionId) => page === section && canOpen(section, account.role);

  return <div className="counter-shell">
    <header className="counter-topbar"><div className="counter-brand"><span className="counter-brand-mark"><WashingMachine /></span><span><strong>Smart Laundry</strong><small>Counter · Offline</small></span></div><div className="counter-session"><Badge variant="outline">{admin ? 'Admin' : 'Staff'} · {account.fullName}</Badge><Button variant="outline" size="sm" onClick={() => leaveTo('lock')}><LogOut className="mr-2 h-4 w-4" />Lock</Button></div></header>
    <nav className="counter-nav" aria-label="Workspace sections">
      {visibleNavGroups(account.role).map(group => <div key={group.label} className="counter-nav-group" role="group" aria-label={group.label}>
        <span className="counter-nav-label" aria-hidden="true">{group.label}</span>
        {group.sections.map(section => {
          const Icon = NAV_ICON[section.id];
          return <button key={section.id} type="button" className={activeSection === section.id ? 'active' : ''} aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => leaveTo(section.id)}><Icon className="h-4 w-4" />{section.label}</button>;
        })}
        {group.label === 'Counter' && saved && <>
          <button type="button" className={page === 'prints' ? 'active' : ''} aria-current={page === 'prints' ? 'page' : undefined} onClick={() => leaveTo('prints')}>Print progress</button>
          {!orderCancelled && <button type="button" className={page === 'pieces' ? 'active' : ''} aria-current={page === 'pieces' ? 'page' : undefined} onClick={() => leaveTo('pieces')}>Packing / pickup</button>}
        </>}
      </div>)}
    </nav>
    {pendingLeave && <div className="counter-discard-bar" role="alertdialog" aria-label="Unsaved order">
      <p>You have an unsaved order. Discard it?</p>
      <Button onClick={discardDraftAndLeave}>Discard order</Button>
      <Button variant="outline" onClick={keepEditing}>Keep editing</Button>
    </div>}
    {notice && <p className="counter-notice" role="status">{notice}</p>}{error && <p className="counter-error" role="alert">{error}</p>}
    {quoteError && <p className="counter-error" role="alert">{quoteError}</p>}
    {restoreWaiting && <RestorePendingBanner />}
    {startupWarning && <p className="counter-error" role="status">{startupWarning}</p>}
    {page === 'order' && <fieldset className="counter-fieldset" disabled={busy}><div className="counter-layout"><main className="counter-main"><CustomerEntry customer={customer} onChange={setCustomer} search={searchCounterCustomers} /><section className="counter-panel"><div className="counter-services" role="tablist" aria-label="Service"><span className="counter-section-label">Choose service</span>{catalogue?.services.filter(x => x.active).map(s => <button key={s.id} role="tab" aria-selected={s.id === serviceId} className={s.id === serviceId ? 'selected' : ''} onClick={() => setServiceId(s.id)}>{s.name}</button>)}</div><GarmentGrid catalogue={catalogue} serviceId={serviceId} lines={lines} onAdd={id => addGarment(id)} onQuantity={setQuantity} /></section></main><aside className="counter-aside"><OrderSummary catalogue={catalogue} lines={lines} quote={quote} quoteFailed={quoteError !== ''} customer={customer} paymentMethod={paymentMethod} onPaymentMethod={setPaymentMethod} onRemove={(id, sid) => setQuantity(id, 0, sid)} onQuantity={setQuantity} onSave={() => void save()} busy={busy} /></aside></div></fieldset>}
    {page === 'orders' && <section className="counter-panel counter-status-page">
      <h1>Orders / Pickup</h1>
      <Label htmlFor="counter-order-search">Search bill number or customer mobile<Input id="counter-order-search" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} placeholder="Bill number or mobile" /></Label>
      {orderSearchBusy && <p role="status">Searching saved orders…</p>}
      {shortOrderQuery && <p role="status">Type at least 2 characters of the bill number or mobile number.</p>}
      {orderResults.length === 0 && !orderSearchBusy && !shortOrderQuery && <p>No matching saved orders.</p>}
      <div className="counter-order-results">{orderResults.map(item => <article key={item.id}><div><strong>{item.orderNumber}</strong><span>{item.customerName} · {item.customerPhone}</span></div><div><Badge>{item.status.replace('_', ' ')}</Badge><span>Balance ₹{(item.balanceMinor / 100).toFixed(2)} · {item.pieceCount} pieces</span></div><Button variant="outline" disabled={busy} onClick={() => void openOrder(item.id)}>Open order</Button></article>)}</div>
      {orderHasMore && <Button variant="outline" onClick={() => { setOrderSearchBusy(true); void searchCounterOrders(orderSearch.trim(), orderOffset, 50).then(next => { setOrderResults(current => [...current, ...next]); setOrderOffset(orderOffset + next.length); setOrderHasMore(next.length === 50); }).catch(e => setError(problem(e))).finally(() => setOrderSearchBusy(false)); }}>Load more</Button>}
    </section>}
    {page === 'detail' && saved && <section className="counter-panel counter-status-page">
      <h1>{saved.orderNumber} · Order details</h1>
      <p>Received {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(saved.receivedAt))} · Ready by {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(saved.promisedAt))}</p>
      <div className="counter-order-totals"><span>Total ₹{(saved.totalMinor / 100).toFixed(2)}</span><span>Paid ₹{(saved.paidMinor / 100).toFixed(2)}</span><strong>Balance ₹{(saved.balanceMinor / 100).toFixed(2)}</strong></div>
      <Label>Processing status<select value={saved.status} disabled={busy || saved.status === 'collected' || orderCancelled} onChange={event => void updateStatus(saved, event.target.value as 'washing'|'drying'|'ironing'|'quality_check'|'packing'|'ready')}><option value="received" disabled>Received</option><option value="washing">Washing</option><option value="drying">Drying</option><option value="ironing">Ironing</option><option value="quality_check">Quality check</option><option value="packing">Packing</option><option value="ready">Ready for pickup</option><option value="collected" disabled>Collected (use the pickup check)</option><option value="cancelled" disabled>Cancelled</option></select></Label>
      {orderCancelled && <p>This order was cancelled. No payment or pickup can be recorded for it.</p>}
      {saved.balanceMinor > 0 && !orderCancelled && <div className="counter-payment"><h2>Record later payment</h2><Label htmlFor="later-payment">Amount received<Input id="later-payment" type="number" min="0" step="0.01" value={payment} onChange={event => { setPayment(event.target.value); setPaymentError(''); }} /></Label><Label htmlFor="later-payment-method">Method<select id="later-payment-method" value={paymentMethodExisting} onChange={event => setPaymentMethodExisting(event.target.value as typeof paymentMethodExisting)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></Label><Label htmlFor="payment-reference">Reference (optional)<Input id="payment-reference" value={paymentReference} onChange={event => setPaymentReference(event.target.value)} /></Label>{paymentError && <p role="alert">{paymentError}</p>}<Button disabled={busy} onClick={() => void addPayment(saved)}>Save payment</Button></div>}
      <div className="counter-order-actions">
        {!orderCancelled && <>
          <Button onClick={() => void loadPieces(saved.orderId, 'packing')}>Packing checklist</Button>
          <Button disabled={saved.status !== 'ready'} onClick={() => void loadPieces(saved.orderId, 'collection')}>Verify pickup collection</Button>
        </>}
        <Button variant="outline" onClick={() => { void refreshJobs(saved.orderId); setPage('prints'); }}>Print progress / reprints</Button>
      </div>
      {admin && saved.status !== 'collected' && !orderCancelled && <CancelOrder key={saved.orderId} busy={busy} onCancel={reason => cancelOrder(saved, reason)} />}
    </section>}
    {showing('admin') && <CounterAdmin catalogue={catalogue} onCatalogue={setCatalogue} printers={printers} onReloadPrinters={openPrinterSettings} onError={reportError} onNotice={setNotice} onRestoreStaged={() => setRestoreStaged(true)} />}
    {showing('dashboard') && <DashboardPage {...sectionProps} />}
    {showing('sales') && <SalesPage {...sectionProps} />}
    {showing('customers') && <CustomersPage {...sectionProps} />}
    {showing('expenses') && <ExpensesPage {...sectionProps} />}
    {showing('inventory') && <InventoryPage {...sectionProps} />}
    {showing('machines') && <MachinesPage {...sectionProps} />}
    {showing('settings') && <ShopSettingsPage {...sectionProps} />}
    {page === 'prints' && saved && <PrintProgress orderNumber={saved.orderNumber} promisedAt={saved.promisedAt} jobs={savedOrderJobs.length ? savedOrderJobs : saved.printJobs} pieces={saved.pieces} selected={selectedReprintPieces} onSelected={setSelectedReprintPieces} reprintBusy={reprintBusy} onReprintBill={() => void reprint(saved, 'bill')} onReprintTags={() => void reprint(saved, 'tags', selectedReprintPieces)} onRetry={doRetry} onResume={resumePendingJob} />}
    {page === 'pieces' && saved && <PieceMatching orderNumber={saved.orderNumber} stage={pieceStage} pieces={pieces} selected={pieceChecks} complete={collectionComplete} onSelected={setPieceChecks} onSubmit={() => void submitMatches(saved)} />}
    {page === 'queue' && <PrintQueue jobs={jobs} onRefresh={() => void refreshJobs()} onOpenOrder={orderId => void openOrder(orderId)} onRetry={doRetry} onResume={resumePendingJob} />}
  </div>;
};

const Setup = ({ onDone, error }: { onDone: (x: { fullName: string; pin: string }) => void; error: string }) => { const [fullName,setName]=useState(''); const [pin,setPin]=useState(''); const [confirm,setConfirm]=useState(''); const [localError,setError]=useState(''); return <div className="counter-auth"><form onSubmit={e=>{e.preventDefault(); if(pin!==confirm){setError('PINs do not match.');return;} onDone({fullName,pin});}} className="counter-auth-card"><WashingMachine /><h1>Set up Smart Laundry</h1><p>Create the first named administrator account.</p><Label>Admin name<Input value={fullName} onChange={e=>setName(e.target.value)} required /></Label><Label>PIN<Input value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label><Label>Confirm PIN<Input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" inputMode="numeric" required /></Label>{(error||localError)&&<p role="alert">{error||localError}</p>}<Button type="submit">Create admin account</Button></form></div>; };
const Login = ({ accounts, busy, error, onLogin, onRefresh }: { accounts: CounterAccount[]; busy:boolean; error:string; onLogin:(id:string,pin:string)=>void; onRefresh:()=>void }) => { const [id,setId]=useState(''); const [pin,setPin]=useState(''); const [admin,setAdmin]=useState(false); const shown=accounts.filter(a=>a.role===(admin?'admin':'staff')&&a.active); return <div className="counter-auth"><form className="counter-auth-card" onSubmit={e=>{e.preventDefault();if(id)onLogin(id,pin);}}><WashingMachine/><h1>Smart Laundry</h1><p>Choose your name and enter your PIN.</p><div className="counter-role-toggle"><button type="button" className={!admin?'selected':''} onClick={()=>{setAdmin(false);setId('');}}>Staff login</button><button type="button" className={admin?'selected':''} onClick={()=>{setAdmin(true);setId('');}}>Admin</button></div><Label>Name<select value={id} onChange={e=>setId(e.target.value)} required><option value="">Choose {admin?'administrator':'staff member'}</option>{shown.map(a=><option key={a.id} value={a.id}>{a.fullName}</option>)}</select></Label><Label>PIN<Input autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label>{error&&<p role="alert">{error}</p>}<Button disabled={busy||!id} type="submit"><LockKeyhole className="mr-2 h-4 w-4"/>{busy?'Signing in…':'Sign in'}</Button><button className="counter-link" type="button" onClick={onRefresh}>Refresh account list</button></form></div>; };

const CustomerEntry = ({customer,onChange,search}:{customer:{name:string;phone:string;customerId?:string};onChange:(c:{name:string;phone:string;customerId?:string})=>void;search:(phone:string)=>Promise<Array<{id:string;name:string;phone:string}>>}) => {const[hits,setHits]=useState<Array<{id:string;name:string;phone:string}>>([]);const[searchError,setSearchError]=useState('');useEffect(()=>{if(customer.phone.trim().length<3){setHits([]);return;}let live=true;const t=setTimeout(()=>void search(customer.phone).then(x=>{if(live){setHits(x);setSearchError('')}}).catch(e=>live&&setSearchError(problem(e))),250);return()=>{live=false;clearTimeout(t)}},[customer.phone,search]);return <section className="counter-customer counter-panel"><div><span className="counter-section-label">Customer</span><p>Look up by mobile or add a new customer</p></div><Label>Mobile number<Input value={customer.phone} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" onChange={e=>onChange({...customer,phone:e.target.value,customerId:undefined})}/></Label><Label>Name<Input value={customer.name} autoComplete="name" placeholder="Customer name" onChange={e=>onChange({...customer,name:e.target.value,customerId:undefined})}/></Label>{hits.length>0&&<div className="counter-customer-matches" role="listbox" aria-label="Matching customers">{hits.map(c=><button type="button" role="option" aria-selected={customer.customerId===c.id} key={c.id} onClick={()=>{onChange({name:c.name,phone:c.phone,customerId:c.id});setHits([])}}><strong>{c.name}</strong><span>{c.phone}</span></button>)}</div>}{searchError&&<p role="status">Customer lookup unavailable; enter details manually.</p>}</section>};

const PieceMatching = ({orderNumber,stage,pieces,selected,complete,onSelected,onSubmit}:{orderNumber:string;stage:'packing'|'collection';pieces:CounterPiece[];selected:string[];complete:boolean;onSelected:(p:string[])=>void;onSubmit:()=>void}) => <section className="counter-panel counter-status-page"><h1>{orderNumber} · {stage==='packing'?'Packing checklist':'Pickup collection'}</h1><p>{stage==='packing'?'Check the physical pieces as they are packed. Unchecking a piece clears its prior packing match.':'Check each printed piece ID with the customer before completing collection.'} {selected.length} of {pieces.length} checked.</p><div className="counter-piece-list">{pieces.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>onSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/><span><strong>{p.shortId}</strong> · {p.garment} / {p.service}</span><small>{p.position}/{p.total}</small></label>)}</div>{complete&&<p role="status">All pieces collected.</p>}<Button disabled={stage==='collection'&&selected.length!==pieces.length} onClick={onSubmit}>{stage==='packing'?'Save packing checklist':'Verify and complete collection'}</Button></section>;
