import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, ClipboardList, LayoutDashboard, LockKeyhole, LogOut, Package, Printer, Receipt, Settings, ShieldCheck, ShoppingBasket, Store, Trash2, Users, WashingMachine, Wrench, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  dispatchPrintJob, dispatchPrintJobs, enumeratePrinters, getCounterBootstrap,
  getCounterCatalogue, getCounterOrder, previewCounterDraftBill, previewCounterOrderBill,
  listPrintJobs, lockCounter, loginCounter, quoteCounterOrder,
  retryPrintJob, saveCounterOrder, searchCounterCustomers,
  reprintCounterOutput,
  setupCounterAdmin,
  type CounterAccount, type CounterBootstrap, type CounterCatalogue,
  type BillPreviewData, type CounterPrintJob, type CounterQuote, type CounterSavedOrder, type NativePrinter,
} from '@/lib/localFirst/counter';
import { BillPreview } from './BillPreview';
import { GarmentGrid } from './GarmentGrid';
import { OrderSummary } from './OrderSummary';
import { discountMinorOf } from '@/lib/localFirst/manualDiscount';
import { backStep, pushTrail } from '@/lib/localFirst/backTrail';
import { useOrderList } from '@/lib/localFirst/orders/useOrderList';
import { CounterAdmin } from './CounterAdmin';
import { RestorePendingBanner } from './RestorePendingBanner';
import { OrdersPage } from './orders/OrdersPage';
import { TrashRequestsPanel } from './orders/TrashRequestsPanel';
import { OrderWorkspace } from './orders/OrderWorkspace';
import { PrintProgress, PrintQueue } from './PrintJobs';
import { JOB_STATE_LABEL } from './printJobState';
import { canOpen, NAV_GROUPS, visibleNavGroups, type SectionId, type SectionProps } from './sections';
import { DashboardPage } from './DashboardPage';
import { SalesPage } from './SalesPage';
import { CustomersPage } from './CustomersPage';
import { ExpensesPage } from './ExpensesPage';
import { InventoryPage } from './InventoryPage';
import { MachinesPage } from './MachinesPage';
import { ShopSettingsPage } from './ShopSettingsPage';
import { TrashPage } from './TrashPage';

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
type Page = SectionId | 'detail' | 'handover' | 'prints';

/** The pages that belong to one open order: they can be shown only while that order is open. */
const ORDER_PAGES: Page[] = ['detail', 'handover', 'prints'];

/** Where a tap on the navigation or Lock goes. Leaving the order page with a draft needs a confirmation first. */
type Destination = Page | 'lock';

/** The words for the Back button of an order opened from `from`, or nothing for the order's own pages. */
const originLabel = (from: Page): string | undefined => {
  if (from === 'orders') return 'Orders';
  return NAV_GROUPS.flatMap(group => group.sections).find(section => section.id === from)?.label;
};

const NAV_ICON: Record<SectionId, LucideIcon> = {
  order: ShoppingBasket, orders: ClipboardList, queue: Printer, dashboard: LayoutDashboard, sales: BarChart3,
  customers: Users, expenses: Receipt, inventory: Package, machines: Wrench, admin: ShieldCheck, settings: Settings, trash: Trash2,
};

export const CounterApp = () => {
  const [bootstrap, setBootstrap] = useState<CounterBootstrap | null>(null);
  const [account, setAccount] = useState<CounterAccount | null>(null);
  const [catalogue, setCatalogue] = useState<CounterCatalogue | null>(null);
  const [page, setPage] = useState<Page>('order');
  /** The screens visited before this one, newest last, for the Back button. */
  const [trail, setTrail] = useState<Page[]>([]);
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Record<string, number>>({});
  /** Prices typed for this bill only, in paise per piece, keyed like `lines`. Any signed-in user may set one. */
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<{ name: string; phone: string; customerId?: string }>({ name: '', phone: '' });
  const [quote, setQuote] = useState<CounterQuote | null>(null);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  /** An extra discount for this bill only, in rupees as typed. Empty means none. */
  const [discount, setDiscount] = useState('');
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof saveCounterOrder>> | null>(null);
  const [jobs, setJobs] = useState<CounterPrintJob[]>([]);
  // Where the open order was reached from, so Back on its page returns there.
  const [origin, setOrigin] = useState<{ page: Page; label: string }>({ page: 'orders', label: 'Orders' });
  const [printers, setPrinters] = useState<NativePrinter[]>([]);
  const idempotencyKey = useRef(crypto.randomUUID());
  // Set when a save starts. Until then the request key follows the discount, because it changes the
  // order; after an attempt the key stays so a retry cannot duplicate the order.
  const saveAttempted = useRef(false);
  const reprintRequestKeys = useRef<Record<string, string>>({});
  const [reprintBusy, setReprintBusy] = useState(false);
  const [selectedReprintPieces, setSelectedReprintPieces] = useState<string[]>([]);
  /** The bill shown in the preview window, and the saved order it can be printed for (none for an unsaved order). */
  const [preview, setPreview] = useState<{ title: string; data: BillPreviewData; orderId?: string } | null>(null);
  const [startupWarning, setStartupWarning] = useState('');
  const [restoreStaged, setRestoreStaged] = useState(false);
  const reviewedQuote = useRef<CounterQuote | null>(null);
  const printActionOnce = useSingleFlight();
  const previewOnce = useSingleFlight();

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
  // The Orders / Pickup list lives here, not in its page, so Back from an order restores the search and segment.
  const orderList = useOrderList({ active: !!account && page === 'orders', onError: reportError });
  const orderItems = useMemo(() => Object.entries(lines).filter(([, q]) => q > 0).map(([key, quantity]) => {
    const [garmentId, treatmentId] = key.split('|');
    return { garmentId, serviceId: treatmentId, quantity, ...(key in priceOverrides ? { unitPriceOverrideMinor: priceOverrides[key] } : {}) };
  }), [lines, priceOverrides]);
  const manualDiscountMinor = discountMinorOf(discount);
  // What is priced, saved and previewed: the garments, and the extra discount when there is one.
  const orderInput = useMemo(() => ({ customer, items: orderItems, ...(manualDiscountMinor > 0 ? { manualDiscountMinor } : {}) }), [customer, orderItems, manualDiscountMinor]);
  // Shown on the New order tab, so a kept draft is not forgotten.
  const draftInProgress = orderItems.length > 0 || customer.name.trim() !== '' || customer.phone.trim() !== '';
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
      void quoteCounterOrder(orderInput).then(q => {
        if (!active) return;
        reviewedQuote.current = q;
        setQuote(q);
      }).catch(e => { if (active) setQuoteError(problem(e)); });
    }, 140);
    return () => { active = false; clearTimeout(timer); };
  }, [account, customer, orderItems, orderInput, quoteRefresh]);

  const addGarment = (garmentId: string, treatment: string) => setLines(current => {
    const key = `${garmentId}|${treatment}`;
    return { ...current, [key]: (current[key] || 0) + 1 };
  });
  const setQuantity = (garmentId: string, quantity: number, treatment: string) => setLines(current => {
    const key = `${garmentId}|${treatment}`; const next = { ...current };
    if (quantity > 0 && Number.isInteger(quantity)) next[key] = quantity;
    else { delete next[key]; setPriceOverrides(prices => { const rest = { ...prices }; delete rest[key]; return rest; }); }
    return next;
  });
  /** `undefined` goes back to the rate-card price. */
  const setLinePrice = (garmentId: string, treatment: string, priceMinor: number | undefined) => setPriceOverrides(current => {
    const key = `${garmentId}|${treatment}`; const next = { ...current };
    if (priceMinor === undefined) delete next[key]; else next[key] = priceMinor;
    return next;
  });
  const signIn = async (id: string, pin: string) => {
    setBusy(true); setError('');
    try {
      const a = await loginCounter(id, pin);
      setAccount(a); setCatalogue(await getCounterCatalogue()); setPage('order'); setTrail([]); setNotice('');
      // A new person must never see the previous person's order tabs.
      setSaved(null);
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  /** State that belongs to the order being looked at, including the keys that make retries safe. */
  const resetOrderScopedState = () => {
    setSelectedReprintPieces([]); reprintRequestKeys.current = {};
  };
  const clearDraft = () => {
    setCustomer({ name: '', phone: '' }); setLines({}); setPriceOverrides({}); setDiscount('');
    setQuote(null); setQuoteError(''); reviewedQuote.current = null;
    setReprintBusy(false); resetOrderScopedState();
    idempotencyKey.current = crypto.randomUUID(); saveAttempted.current = false;
    setError(''); setNotice('');
  };
  /** A different discount is a different order, so before any save it gets a new request key too. */
  const changeDiscount = (text: string) => {
    setDiscount(text);
    if (!saveAttempted.current) idempotencyKey.current = crypto.randomUUID();
  };
  const save = async () => {
    // The Save button is only enabled with a quote for exactly this draft, and the native save
    // rejects any quote that does not match the order, so a stale quote can never be charged.
    const quoteToSave = reviewedQuote.current as CounterQuote;
    saveAttempted.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveCounterOrder({ ...orderInput, reviewedQuote: quoteToSave, idempotencyKey: idempotencyKey.current });
      setSaved(result); clearDraft(); navigate('prints');
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
  const refreshJobs = async (orderId?: string) => { try { setJobs(await listPrintJobs(orderId)); } catch (e) { setError(problem(e)); } };
  // Only the Print queue page shows every order's jobs; anywhere else the list stays that order's own.
  const refreshJobsAfterAction = (orderId: string) => refreshJobs(page === 'queue' ? undefined : orderId);
  const doRetry = (job: CounterPrintJob) => printActionOnce(async () => {
    try { await retryPrintJob(job.id, job.state === 'uncertain'); await refreshJobsAfterAction(job.orderId); } catch (e) { setError(problem(e)); }
  });
  const resumePendingJob = (job: CounterPrintJob) => printActionOnce(async () => {
    try { await dispatchPrintJob(job.id); await refreshJobsAfterAction(job.orderId); } catch (e) { setError(problem(e)); }
  });
  const openOrder = async (orderId: string, target: 'detail' | 'handover' = 'detail') => {
    setBusy(true); setError('');
    try {
      const result = await getCounterOrder(orderId);
      if (!result) throw new Error('This order is no longer available.');
      // Another order must not inherit the previous one's reprint picks or request keys.
      if (saved?.orderId !== result.orderId) resetOrderScopedState();
      // Moving between an order's own pages keeps where it was first opened from.
      const from = originLabel(page);
      if (from) setOrigin({ page, label: from });
      setSaved(result); setJobs(result.printJobs); setNotice(''); navigate(target);
    } catch (e) { setError(problem(e)); } finally { setBusy(false); }
  };
  /** A fresher copy of the open order (after a payment, a stage change, a hand-over ...). */
  const replaceOrder = useCallback((order: CounterSavedOrder) => { setSaved(order); setJobs(order.printJobs); }, []);
  /** After a hand-over: back to the list of orders waiting for pickup, ready for the next customer. */
  const finishHandover = () => { orderList.setSegment('ready'); setSaved(null); navigate('orders'); };
  const reprint = (orderId: string, kind: 'bill' | 'tags', pieceIds: string[] = []) => printActionOnce(async () => {
    const selected = kind === 'tags' ? [...new Set(pieceIds)].sort() : [];
    const requestKey = `${orderId}:${kind}:${selected.join(',')}`;
    const requestId = reprintRequestKeys.current[requestKey] ||= crypto.randomUUID();
    setReprintBusy(true); setError('');
    try {
      const created = await reprintCounterOutput(orderId, kind, selected, requestId);
      const dispatched = await dispatchPrintJob(created.id);
      await refreshJobs(orderId);
      if (dispatched.state !== 'submitted') {
        // The reprint exists but the printer did not take it. Keep the request key so the same
        // selection resumes the same job instead of creating another one.
        setError(`The reprint was saved but did not print (${JOB_STATE_LABEL[dispatched.state]}). Use Retry in the Print queue.`);
        return;
      }
      delete reprintRequestKeys.current[requestKey];
      setSelectedReprintPieces([]);
      setNotice(kind === 'bill' ? `Bill ${created.orderNumber} sent to the printer.` : `${selected.length} selected garment tag(s) were added to the TSC queue.`);
    } catch (e) {
      setError(kind === 'bill'
        ? `The bill could not be printed: ${problem(e)}. Press Reprint bill again to retry.`
        : `The ${kind} reprint request may already be saved. Retry this same selection to safely resume: ${problem(e)}`);
    } finally { setReprintBusy(false); }
  });
  /** Shows the bill of the order being taken. Nothing is saved. */
  const previewDraft = () => previewOnce(async () => {
    try {
      setPreview({ title: 'Bill preview', data: await previewCounterDraftBill(orderInput) });
    } catch (e) { setError(problem(e)); }
  });
  /** Shows the bill of a saved order, as a reprint would print it now. */
  const previewSaved = (order: CounterSavedOrder) => previewOnce(async () => {
    try {
      setPreview({ title: `Bill ${order.orderNumber}`, data: await previewCounterOrderBill(order.orderId), orderId: order.orderId });
    } catch (e) { setError(problem(e)); }
  });
  const printFromPreview = () => {
    const orderId = (preview as { orderId: string }).orderId;
    setPreview(null);
    void reprint(orderId, 'bill');
  };
  const openPrinterSettings = async () => { try { setPrinters(await enumeratePrinters()); navigate('admin'); } catch (e) { setError(problem(e)); } };
  const logout = async () => { try { await lockCounter(); } catch (e) { setError(`The counter could not be locked: ${problem(e)}`); return; } setNotice(''); setSaved(null); setPreview(null); setJobs([]); orderList.reset(); setSelectedReprintPieces([]); setAccount(null); setCatalogue(null); setPage('order'); setTrail([]); setBootstrap(await getCounterBootstrap()); };

  /** Shows a page and remembers the one being left, so Back can return to it. */
  const navigate = (next: Page) => { setTrail(current => pushTrail(current, page, next)); setPage(next); };
  /** Moves to a page, doing whatever that page needs loaded first. */
  const arrive = (destination: Destination) => {
    if (destination === 'lock') { void logout(); return; }
    if (destination === 'order') setSaved(null);
    if (destination === 'queue') void refreshJobs();
    navigate(destination);
  };
  /** The order being taken stays as it is while other pages are open (and across Lock) until it is saved or cleared. */
  const leaveTo = (destination: Destination) => {
    if (destination === 'order' && page === 'order') return;
    arrive(destination);
  };
  /** The screen Back returns to: the newest one visited that can still be shown. */
  const back = backStep(trail, previous => previous !== page && (!ORDER_PAGES.includes(previous) || saved !== null));
  // Only offered (see the header) while `back` exists.
  const goBack = () => {
    setTrail(back.rest);
    if (back.target === 'queue') void refreshJobs();
    setPage(back.target);
  };
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
  // Jobs of other orders can sit in the shared list; this page only ever shows its own order's.
  const savedOrderJobs = saved ? jobs.filter(j => j.orderId === saved.orderId) : [];

  // An order's own pages (detail, hand-over, print progress) belong to Orders / Pickup in the navigation.
  const activeSection: Page = page === 'detail' || page === 'handover' || page === 'prints' ? 'orders' : page;
  const sectionProps: SectionProps = { account, onError: reportError, onNotice: setNotice, onOpenOrder };
  const showing = (section: SectionId) => page === section && canOpen(section, account.role);

  return <div className="counter-shell">
    <div className="counter-sticky-head">
      <header className="counter-topbar"><div className="counter-brand">{back && <Button variant="outline" className="counter-back" onClick={goBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>}<span className="counter-brand-mark"><WashingMachine /></span><span><strong>Smart Laundry</strong><small>Counter · Offline</small></span></div><div className="counter-session"><Badge variant="outline">{admin ? 'Admin' : 'Staff'} · {account.fullName}</Badge><Button variant="outline" size="sm" onClick={() => leaveTo('lock')}><LogOut className="mr-2 h-4 w-4" />Lock</Button></div></header>
      <nav className="counter-nav" aria-label="Workspace sections">
        {visibleNavGroups(account.role).map(group => <div key={group.label} className="counter-nav-group" role="group" aria-label={group.label}>
          <span className="counter-nav-label" aria-hidden="true">{group.label}</span>
          {group.sections.map(section => {
            const Icon = NAV_ICON[section.id];
            return <button key={section.id} type="button" className={activeSection === section.id ? 'active' : ''} aria-current={activeSection === section.id ? 'page' : undefined} onClick={() => leaveTo(section.id)}><Icon className="h-4 w-4" />{section.label}{section.id === 'order' && draftInProgress && page !== 'order' && <span className="counter-draft-dot" aria-hidden="true">in progress</span>}</button>;
          })}
        </div>)}
      </nav>
    </div>
    {notice && <p className="counter-notice" role="status">{notice}</p>}{error && <p className="counter-error" role="alert">{error}</p>}
    {quoteError && <p className="counter-error" role="alert">{quoteError}</p>}
    {restoreWaiting && <RestorePendingBanner />}
    {startupWarning && <p className="counter-error" role="status">{startupWarning}</p>}
    {page === 'order' && <fieldset className="counter-fieldset" disabled={busy}><div className="counter-layout"><main className="counter-main"><CustomerEntry customer={customer} onChange={setCustomer} search={searchCounterCustomers} /><section className="counter-panel"><GarmentGrid catalogue={catalogue} lines={lines} onAdd={addGarment} onQuantity={setQuantity} /></section></main><aside className="counter-aside"><OrderSummary catalogue={catalogue} lines={lines} quote={quote} quoteFailed={quoteError !== ''} customer={customer} discount={discount} onDiscount={changeDiscount} onRemove={(id, sid) => setQuantity(id, 0, sid)} onQuantity={setQuantity} onPrice={setLinePrice} onSave={() => void save()} onPreview={() => void previewDraft()} onClear={clearDraft} busy={busy} /></aside></div></fieldset>}
    {page === 'orders' && admin && <TrashRequestsPanel onError={reportError} onNotice={setNotice} onChanged={orderList.reload} />}
    {page === 'orders' && <OrdersPage query={orderList.query} onQuery={orderList.setQuery} segment={orderList.segment} onSegment={orderList.setSegment} day={orderList.day} today={orderList.today} onDay={orderList.setDay} counts={orderList.counts} results={orderList.results} loading={orderList.loading} hasMore={orderList.hasMore} onLoadMore={orderList.loadMore} onOpen={id => void openOrder(id)} onHandover={id => void openOrder(id, 'handover')} onReprintBill={id => void reprint(id, 'bill')} busy={busy} />}
    {(page === 'detail' || page === 'handover') && saved && <OrderWorkspace order={saved} view={page} isAdmin={admin} backLabel={origin.label} onBack={() => arrive(origin.page)} onView={navigate} onOrder={replaceOrder} onError={reportError} onNotice={setNotice} onReprintBill={() => void reprint(saved.orderId, 'bill')} onPreviewBill={() => void previewSaved(saved)} onReprintTags={() => void reprint(saved.orderId, 'tags', saved.pieces.filter(piece => piece.tagged).map(piece => piece.shortId))} onOpenPrints={() => { void refreshJobs(saved.orderId); navigate('prints'); }} onFinished={finishHandover} />}
    {showing('admin') && <CounterAdmin catalogue={catalogue} onCatalogue={setCatalogue} printers={printers} onReloadPrinters={openPrinterSettings} onError={reportError} onNotice={setNotice} onRestoreStaged={() => setRestoreStaged(true)} />}
    {showing('dashboard') && <DashboardPage {...sectionProps} />}
    {showing('sales') && <SalesPage {...sectionProps} />}
    {showing('customers') && <CustomersPage {...sectionProps} />}
    {showing('expenses') && <ExpensesPage {...sectionProps} />}
    {showing('inventory') && <InventoryPage {...sectionProps} />}
    {showing('machines') && <MachinesPage {...sectionProps} />}
    {showing('settings') && <ShopSettingsPage {...sectionProps} />}
    {showing('trash') && <TrashPage {...sectionProps} />}
    {page === 'prints' && saved && <PrintProgress onBack={() => navigate('detail')} orderNumber={saved.orderNumber} promisedAt={saved.promisedAt} jobs={savedOrderJobs.length ? savedOrderJobs : saved.printJobs} pieces={saved.pieces} selected={selectedReprintPieces} onSelected={setSelectedReprintPieces} reprintBusy={reprintBusy} onReprintBill={() => void reprint(saved.orderId, 'bill')} onReprintTags={() => void reprint(saved.orderId, 'tags', selectedReprintPieces)} onRetry={doRetry} onResume={resumePendingJob} />}
    {preview && <BillPreview title={preview.title} preview={preview.data} onClose={() => setPreview(null)} onPrint={preview.orderId ? printFromPreview : undefined} />}
    {page === 'queue' && <PrintQueue jobs={jobs} onRefresh={() => void refreshJobs()} onOpenOrder={orderId => void openOrder(orderId)} onRetry={doRetry} onResume={resumePendingJob} />}
  </div>;
};

const Setup = ({ onDone, error }: { onDone: (x: { fullName: string; pin: string }) => void; error: string }) => { const [fullName,setName]=useState(''); const [pin,setPin]=useState(''); const [confirm,setConfirm]=useState(''); const [localError,setError]=useState(''); return <div className="counter-auth"><form onSubmit={e=>{e.preventDefault(); if(pin!==confirm){setError('PINs do not match.');return;} onDone({fullName,pin});}} className="counter-auth-card"><WashingMachine /><h1>Set up Smart Laundry</h1><p>Create the first named administrator account.</p><Label>Admin name<Input value={fullName} onChange={e=>setName(e.target.value)} required /></Label><Label>PIN<Input value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label><Label>Confirm PIN<Input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" inputMode="numeric" required /></Label>{(error||localError)&&<p role="alert">{error||localError}</p>}<Button type="submit">Create admin account</Button></form></div>; };
const Login = ({ accounts, busy, error, onLogin, onRefresh }: { accounts: CounterAccount[]; busy:boolean; error:string; onLogin:(id:string,pin:string)=>void; onRefresh:()=>void }) => { const [id,setId]=useState(''); const [pin,setPin]=useState(''); const [admin,setAdmin]=useState(false); const shown=accounts.filter(a=>a.role===(admin?'admin':'staff')&&a.active); return <div className="counter-auth"><form className="counter-auth-card" onSubmit={e=>{e.preventDefault();if(id)onLogin(id,pin);}}><WashingMachine/><h1>Smart Laundry</h1><p>Choose your name and enter your PIN.</p><div className="counter-role-toggle"><button type="button" className={!admin?'selected':''} onClick={()=>{setAdmin(false);setId('');}}>Staff login</button><button type="button" className={admin?'selected':''} onClick={()=>{setAdmin(true);setId('');}}>Admin</button></div><Label>Name<select value={id} onChange={e=>setId(e.target.value)} required><option value="">Choose {admin?'administrator':'staff member'}</option>{shown.map(a=><option key={a.id} value={a.id}>{a.fullName}</option>)}</select></Label><Label>PIN<Input autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" required /></Label>{error&&<p role="alert">{error}</p>}<Button disabled={busy||!id} type="submit"><LockKeyhole className="mr-2 h-4 w-4"/>{busy?'Signing in…':'Sign in'}</Button><button className="counter-link" type="button" onClick={onRefresh}>Refresh account list</button></form></div>; };

const CustomerEntry = ({customer,onChange,search}:{customer:{name:string;phone:string;customerId?:string};onChange:(c:{name:string;phone:string;customerId?:string})=>void;search:(phone:string)=>Promise<Array<{id:string;name:string;phone:string}>>}) => {const[hits,setHits]=useState<Array<{id:string;name:string;phone:string}>>([]);const[searchError,setSearchError]=useState('');useEffect(()=>{if(customer.phone.trim().length<3){setHits([]);return;}let live=true;const t=setTimeout(()=>void search(customer.phone).then(x=>{if(live){setHits(x);setSearchError('')}}).catch(e=>live&&setSearchError(problem(e))),250);return()=>{live=false;clearTimeout(t)}},[customer.phone,search]);return <section className="counter-customer counter-panel"><div><span className="counter-section-label">Customer</span><p>Look up by mobile or add a new customer</p></div><Label>Mobile number<Input value={customer.phone} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" onChange={e=>onChange({...customer,phone:e.target.value,customerId:undefined})}/></Label><Label>Name<Input value={customer.name} autoComplete="name" placeholder="Customer name" onChange={e=>onChange({...customer,name:e.target.value,customerId:undefined})}/></Label>{hits.length>0&&<div className="counter-customer-matches" role="listbox" aria-label="Matching customers">{hits.map(c=><button type="button" role="option" aria-selected={customer.customerId===c.id} key={c.id} onClick={()=>{onChange({name:c.name,phone:c.phone,customerId:c.id});setHits([])}}><strong>{c.name}</strong><span>{c.phone}</span></button>)}</div>}{searchError&&<p role="status">Customer lookup unavailable; enter details manually.</p>}</section>};

