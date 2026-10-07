import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import {
  Archive,
  BarChart3,
  Box,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DatabaseBackup,
  FileText,
  Gauge,
  LogOut,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { backupDatabase, restoreDatabase } from '@/lib/localFirst/backup';
import { localLaundryRepository } from '@/lib/localFirst/repository';
import { calculateLineTotal, calculateOrderTotals, getPaymentStatus } from '@/lib/localFirst/domain';
import { startLocalFirstApp } from '@/lib/localFirst/startup';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type Customer,
  type CustomerType,
  type DashboardSummary,
  type Expense,
  type InventoryItem,
  type LocalOrder,
  type LocalUser,
  type Machine,
  type OrderStatus,
  type PaymentMethod,
  type ReportSummary,
  type Service,
  type ServiceType,
  type ShopSettings,
} from '@/lib/localFirst/types';

type Section = 'dashboard' | 'orders' | 'customers' | 'services' | 'payments' | 'expenses' | 'inventory' | 'machines' | 'reports' | 'settings';
type ActionHandler = (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
type DraftOrderItem = {
  itemName: string;
  serviceId: string;
  serviceType: ServiceType;
  quantity: string;
  weight: string;
  rate: string;
};

const newDraftOrderItem = (): DraftOrderItem => ({
  itemName: '',
  serviceId: '',
  serviceType: 'piece',
  quantity: '1',
  weight: '0',
  rate: '0',
});

const getDraftLineTotalLabel = (item: DraftOrderItem): string => {
  try {
    return money(calculateLineTotal({
      service_type: item.serviceType,
      quantity: Number(item.quantity),
      weight_kg: Number(item.weight),
      rate: Number(item.rate),
    }));
  } catch {
    return '—';
  }
};

const money = (value: number): string => `₹${Number(value || 0).toFixed(2)}`;
const today = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const statusLabel = (status: string): string => status.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

type SubmissionResult<T> = { started: false } | { started: true; value: T };

const useSubmissionLock = () => {
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const run = async <T,>(operation: () => Promise<T>): Promise<SubmissionResult<T>> => {
    if (inFlight.current) return { started: false };
    inFlight.current = true;
    setSubmitting(true);
    try {
      return { started: true, value: await operation() };
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return { submitting, run };
};

const defaultDashboard: DashboardSummary = {
  orders_today: 0,
  pieces_today: 0,
  weight_today: 0,
  sales_today: 0,
  collected_today: 0,
  outstanding: 0,
  in_process: 0,
  ready: 0,
  overdue: 0,
};

const emptySettings: ShopSettings = {
  shop_name: 'Smart Laundry',
  shop_address: '',
  shop_phone: '',
  gst_number: '',
  receipt_footer: 'Thank you for choosing us.',
  order_prefix: 'LA',
  default_completion_days: 2,
  device_id: '',
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  try {
    return JSON.stringify(error);
  } catch {
    return 'Something went wrong.';
  }
};

const SetupScreen = ({ onComplete, warning }: { onComplete: (user: LocalUser) => void; warning: string }) => {
  const [fullName, setFullName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const { submitting, run } = useSubmissionLock();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (pin !== confirmPin) {
      setError('The PINs do not match.');
      return;
    }
    setError('');
    try {
      const result = await run(() => localLaundryRepository.createAdmin(fullName, pin));
      if (result.started) onComplete(result.value);
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  };

  return (
    <AuthCard
      title="Set up Smart Laundry"
      description="Create the local administrator for this Mac. This database starts empty."
      icon={<ShieldCheck className="h-6 w-6" />}
    >
      {warning && <WarningNotice>{warning}</WarningNotice>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Administrator name" value={fullName} onChange={setFullName} required />
        <Field label="PIN" value={pin} onChange={setPin} type="password" inputMode="numeric" required placeholder="4 to 8 digits" />
        <Field label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} type="password" inputMode="numeric" required />
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Creating account...' : 'Create local account'}</Button>
      </form>
    </AuthCard>
  );
};

const LoginScreen = ({ onLogin, warning }: { onLogin: (user: LocalUser) => void; warning: string }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const { submitting, run } = useSubmissionLock();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const result = await run(() => localLaundryRepository.authenticate(pin));
      if (!result.started) return;
      const user = result.value;
      if (!user) setError('Incorrect PIN.');
      else onLogin(user);
    } catch (loginError) {
      setError(errorMessage(loginError));
    }
  };

  return (
    <AuthCard title="Unlock Smart Laundry" description="This local account works without internet." icon={<ShieldCheck className="h-6 w-6" />}>
      {warning && <WarningNotice>{warning}</WarningNotice>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="PIN" value={pin} onChange={setPin} type="password" inputMode="numeric" required autoFocus />
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Checking...' : 'Unlock'}</Button>
      </form>
    </AuthCard>
  );
};

const AuthCard = ({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="min-h-screen bg-slate-950 px-4 py-12 text-slate-900">
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700">{icon}</div>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  </div>
);

const Field = ({ label, value, onChange, type = 'text', required = false, placeholder, inputMode, autoFocus }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string; inputMode?: 'numeric' | 'decimal' | 'text'; autoFocus?: boolean }) => {
  const id = useId();
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} onChange={event => onChange(event.target.value)} type={type} required={required} placeholder={placeholder} inputMode={inputMode} autoFocus={autoFocus} />
  </div>;
};

const ErrorText = ({ children }: { children: React.ReactNode }) => <p role="alert" className="text-sm text-red-600">{children}</p>;
const Notice = ({ children }: { children: React.ReactNode }) => <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{children}</div>;
const WarningNotice = ({ children }: { children: React.ReactNode }) => <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{children}</div>;

export const LocalFirstApp = () => {
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [error, setError] = useState('');
  const [backupWarning, setBackupWarning] = useState('');
  const [restorePending, setRestorePending] = useState(false);

  useEffect(() => {
    startLocalFirstApp()
      .then(result => {
        setSetupRequired(!result.hasLocalUser);
        const startupWarnings = [
          result.initializationWarning,
          'backupError' in result
            ? `Automatic startup backup failed. You can continue using the app. ${errorMessage(result.backupError)}`
            : undefined,
        ].filter((warning): warning is string => Boolean(warning));
        setBackupWarning(startupWarnings.join(' '));
      })
      .catch(initializationError => setError(errorMessage(initializationError)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Opening local database...</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-red-200">{error}</div>;
  if (setupRequired) return <SetupScreen warning={backupWarning} onComplete={createdUser => { setUser(createdUser); setSetupRequired(false); }} />;
  if (!user) return <LoginScreen warning={backupWarning} onLogin={setUser} />;

  return <LocalWorkspace
    user={user}
    startupWarning={backupWarning}
    restorePending={restorePending}
    onRestoreStaged={() => setRestorePending(true)}
    onLock={() => setUser(null)}
  />;
};

const LocalWorkspace = ({ user, startupWarning, restorePending, onRestoreStaged, onLock }: {
  user: LocalUser;
  startupWarning: string;
  restorePending: boolean;
  onRestoreStaged: () => void;
  onLock: () => void;
}) => {
  const [section, setSection] = useState<Section>('dashboard');
  const [dashboard, setDashboard] = useState(defaultDashboard);
  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<ShopSettings>(emptySettings);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [printOrder, setPrintOrder] = useState<LocalOrder | null>(null);
  const [printPending, setPrintPending] = useState(false);
  const printInFlight = useRef(false);
  const printRequestId = useRef(0);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const nextDashboard = await localLaundryRepository.getDashboardSummary();
      const nextOrders = await localLaundryRepository.listOrders();
      const nextCustomers = await localLaundryRepository.listCustomers();
      const nextServices = await localLaundryRepository.listServices();
      const nextExpenses = await localLaundryRepository.listExpenses();
      const nextInventory = await localLaundryRepository.listInventory();
      const nextMachines = await localLaundryRepository.listMachines();
      const nextSettings = await localLaundryRepository.getSettings();
      setDashboard(nextDashboard);
      setOrders(nextOrders);
      setCustomers(nextCustomers);
      setServices(nextServices);
      setExpenses(nextExpenses);
      setInventory(nextInventory);
      setMachines(nextMachines);
      setSettings(nextSettings);
    } catch (refreshError) {
      setNotice(errorMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!printOrder) return undefined;
    let invokeStarted = false;
    const finishPrinting = () => setPrintOrder(null);
    const printFrame = window.requestAnimationFrame(() => {
      invokeStarted = true;
      void invoke('plugin:webview|print').then(() => {
        printInFlight.current = false;
        setPrintPending(false);
      }).catch(printError => {
        printInFlight.current = false;
        setPrintPending(false);
        setPrintOrder(null);
        setNotice(errorMessage(printError));
      });
    });
    window.addEventListener('afterprint', finishPrinting, { once: true });
    return () => {
      window.cancelAnimationFrame(printFrame);
      window.removeEventListener('afterprint', finishPrinting);
      if (!invokeStarted) {
        printInFlight.current = false;
        setPrintPending(false);
      }
    };
  }, [printOrder]);

  const run = async (operation: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    if (restorePending) {
      setNotice('A restore is staged. Close and reopen the app before writing.');
      return false;
    }

    try {
      await operation();
      setNotice(successMessage);
      await refresh();
      return true;
    } catch (operationError) {
      setNotice(errorMessage(operationError));
      return false;
    }
  };

  const preparePrint = async (orderId: string): Promise<void> => {
    if (printInFlight.current) return;
    printInFlight.current = true;
    setPrintPending(true);
    const requestId = ++printRequestId.current;
    try {
      const order = await localLaundryRepository.getOrder(orderId);
      if (!order) throw new Error('Order not found.');
      if (requestId !== printRequestId.current) {
        printInFlight.current = false;
        setPrintPending(false);
        return;
      }
      setPrintOrder(order);
    } catch (printError) {
      printInFlight.current = false;
      setPrintPending(false);
      setNotice(errorMessage(printError));
    }
  };

  const navigateTo = (nextSection: Section) => {
    printRequestId.current += 1;
    setSection(nextSection);
    setPrintOrder(null);
  };

  const nav = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: Gauge },
    { id: 'orders' as const, label: 'Orders', icon: ClipboardList },
    { id: 'customers' as const, label: 'Customers', icon: Users },
    { id: 'services' as const, label: 'Services', icon: Wrench },
    { id: 'payments' as const, label: 'Payments', icon: Receipt },
    { id: 'expenses' as const, label: 'Expenses', icon: ShoppingBag },
    { id: 'inventory' as const, label: 'Inventory', icon: Package },
    { id: 'machines' as const, label: 'Machines', icon: Wrench },
    { id: 'reports' as const, label: 'Reports', icon: BarChart3 },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ];

  return (
    <>
    <div className="no-print min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 bg-slate-950 p-4 text-white lg:block">
          <div className="mb-8 flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600"><Archive className="h-5 w-5" /></div>
            <div><p className="font-semibold">{settings.shop_name || 'Smart Laundry'}</p><p className="text-xs text-slate-400">Offline POS</p></div>
          </div>
          <nav className="space-y-1">
            {nav.map(item => {
              const Icon = item.icon;
              return <button key={item.id} onClick={() => navigateTo(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${section === item.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><Icon className="h-4 w-4" />{item.label}</button>;
            })}
          </nav>
          <div className="mt-8 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <p>Local account</p><p className="mt-1 text-slate-200">{user.full_name}</p>
            <Button variant="ghost" size="sm" className="mt-4 w-full justify-start px-0 text-slate-300 hover:bg-transparent hover:text-white" onClick={onLock}><LogOut className="mr-2 h-4 w-4" />Lock app</Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 shadow-sm sm:px-6">
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Local mode</p><h1 className="text-xl font-semibold">{nav.find(item => item.id === section)?.label}</h1></div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="border-green-300 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" />Saved locally</Badge><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Refresh'}</Button></div>
          </header>
          <div className="p-4 sm:p-6">
            {startupWarning && <WarningNotice>{startupWarning}</WarningNotice>}
            {restorePending && <WarningNotice>A backup restore is staged. Close and reopen Smart Laundry to apply it. The app blocks writes until it restarts.</WarningNotice>}
            {notice && <div className="mb-4 flex items-center justify-between"><Notice>{notice}</Notice><Button variant="ghost" size="sm" onClick={() => setNotice('')}>Dismiss</Button></div>}
            {section === 'dashboard' && <DashboardSection summary={dashboard} orders={orders.slice(0, 8)} onOpenOrders={() => navigateTo('orders')} />}
            {section === 'orders' && <OrdersSection orders={orders} services={services} customers={customers} userId={user.id} onAction={run} onPrint={preparePrint} printPending={printPending} />}
            {section === 'customers' && <CustomersSection customers={customers} userId={user.id} onAction={run} />}
            {section === 'services' && <ServicesSection services={services} userId={user.id} onAction={run} />}
            {section === 'payments' && <PaymentsSection orders={orders} userId={user.id} onAction={run} />}
            {section === 'expenses' && <ExpensesSection expenses={expenses} userId={user.id} onAction={run} />}
            {section === 'inventory' && <InventorySection inventory={inventory} userId={user.id} onAction={run} />}
            {section === 'machines' && <MachinesSection machines={machines} userId={user.id} onAction={run} />}
            {section === 'reports' && <ReportsSection report={report} onGenerate={(from, to) => localLaundryRepository.getReport(from, to).then(setReport)} />}
            {section === 'settings' && <SettingsSection settings={settings} userId={user.id} onAction={run} onRestoreStaged={onRestoreStaged} />}
          </div>
        </main>
      </div>
      <div className="fixed bottom-0 left-0 right-0 flex gap-1 overflow-x-auto border-t bg-white p-2 lg:hidden">
        {nav.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => navigateTo(item.id)} className={`flex min-w-20 flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] ${section === item.id ? 'bg-blue-100 text-blue-700' : 'text-slate-500'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}
      </div>
    </div>
    {printOrder && <PrintableReceipt order={printOrder} settings={settings} />}
    </>
  );
};

const DashboardSection = ({ summary, orders, onOpenOrders }: { summary: DashboardSummary; orders: LocalOrder[]; onOpenOrders: () => void }) => (
  <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Orders today" value={summary.orders_today} icon={<ClipboardList />} />
      <Metric title="Sales today" value={money(summary.sales_today)} icon={<BarChart3 />} />
      <Metric title="Collected today" value={money(summary.collected_today)} icon={<Receipt />} />
      <Metric title="Outstanding" value={money(summary.outstanding)} icon={<Clock3 />} />
      <Metric title="Pieces today" value={summary.pieces_today} icon={<ShoppingBag />} />
      <Metric title="Weight today" value={`${summary.weight_today.toFixed(2)} kg`} icon={<Box />} />
      <Metric title="In process" value={summary.in_process} icon={<Wrench />} />
      <Metric title="Ready" value={summary.ready} icon={<CheckCircle2 />} />
    </div>
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Recent orders</CardTitle><Button variant="outline" size="sm" onClick={onOpenOrders}>View all</Button></CardHeader><CardContent>{orders.length === 0 ? <Empty text="No orders yet." /> : <OrderTable orders={orders} compact />}</CardContent></Card>
    {summary.overdue > 0 && <Notice>{summary.overdue} order(s) are overdue.</Notice>}
  </div>
);

const PrintableReceipt = ({ order, settings }: { order: LocalOrder; settings: ShopSettings }) => {
  const paidAmount = order.paid_amount || 0;
  const balance = Math.max(0, order.total_amount - paidAmount);
  const payments = (order.payments || []).filter(payment => !payment.voided_at);

  return <div className="receipt-print hidden print:block mx-auto max-w-md p-4 text-xs text-black">
    <div className="receipt-section text-center"><h1 className="text-lg font-bold">{settings.shop_name}</h1><p>{settings.shop_address || ' '}</p><p>{settings.shop_phone || ' '}</p></div>
    <div className="receipt-section mt-4 border-b border-t py-2"><div className="flex justify-between font-bold"><span>Order</span><span>{order.order_number}</span></div><div className="flex justify-between"><span>Customer</span><span>{order.customer_name}</span></div><div className="flex justify-between"><span>Phone</span><span>{order.customer_phone}</span></div><div className="flex justify-between"><span>Received</span><span>{new Date(order.received_at).toLocaleString()}</span></div><div className="flex justify-between"><span>Ready by</span><span>{order.expected_ready_at ? new Date(order.expected_ready_at).toLocaleDateString() : '—'}</span></div><div className="flex justify-between"><span>Status</span><span>{statusLabel(order.status)}</span></div></div>
    <div className="receipt-section mt-4"><h2 className="mb-2 font-bold">Items</h2><table className="w-full"><thead><tr className="border-b"><th className="py-1 text-left">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Rate</th><th className="py-1 text-right">Total</th></tr></thead><tbody>{(order.items || []).map(item => <tr key={item.id} className="border-b"><td className="py-1">{item.item_name}<div className="text-[10px]">{item.service_name}</div></td><td className="py-1 text-right">{item.service_type === 'weight' ? `${item.weight_kg} kg` : item.quantity}</td><td className="py-1 text-right">{money(item.rate)}</td><td className="py-1 text-right">{money(item.line_total)}</td></tr>)}</tbody></table></div>
    <div className="receipt-section mt-4 border-t pt-2"><div className="flex justify-between"><span>Subtotal</span><span>{money(order.subtotal)}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(order.discount_amount)}</span></div><div className="mt-2 flex justify-between border-t pt-2 text-sm font-bold"><span>Total</span><span>{money(order.total_amount)}</span></div><div className="flex justify-between"><span>Paid</span><span>{money(paidAmount)}</span></div><div className="flex justify-between"><span>Balance</span><span>{money(balance)}</span></div>{payments.length > 0 ? payments.map(payment => <div key={payment.id} className="flex justify-between text-[10px]"><span>{statusLabel(payment.method)}</span><span>{money(payment.amount)}</span></div>) : <div className="flex justify-between text-[10px]"><span>No payment recorded</span><span>₹0.00</span></div>}</div>
    {order.special_instructions && <div className="receipt-section mt-4 border-t pt-2"><p className="font-bold">Instructions</p><p>{order.special_instructions}</p></div>}
    <p className="receipt-section mt-5 text-center">{settings.receipt_footer}</p>
  </div>;
};

const Metric = ({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) => <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-slate-500">{title}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div><div className="rounded-lg bg-blue-50 p-3 text-blue-700">{icon}</div></CardContent></Card>;

const OrdersSection = ({ orders, services, customers, userId, onAction, onPrint, printPending }: { orders: LocalOrder[]; services: Service[]; customers: Customer[]; userId: string; onAction: ActionHandler; onPrint: (orderId: string) => Promise<void>; printPending: boolean }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [showForm, setShowForm] = useState(true);
  const filtered = useMemo(() => orders.filter(order => (status === 'all' || order.status === status) && (!search || `${order.order_number} ${order.customer_name} ${order.customer_phone}`.toLowerCase().includes(search.toLowerCase()))), [orders, search, status]);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">Create and manage orders without internet.</p></div><Button onClick={() => setShowForm(value => !value)}><Plus className="mr-2 h-4 w-4" />{showForm ? 'Hide new order' : 'New order'}</Button></div>
    {showForm && <OrderForm services={services} customers={customers} userId={userId} onAction={onAction} />}
    <Card><CardHeader><div className="flex flex-wrap items-center gap-3"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input aria-label="Search orders by order number, customer, or phone" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search order, customer, phone" /></div><select aria-label="Filter orders by status" className="h-10 rounded-md border bg-white px-3 text-sm" value={status} onChange={event => setStatus(event.target.value as OrderStatus | 'all')}><option value="all">All statuses</option>{ORDER_STATUSES.map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></div></CardHeader><CardContent><OrderTable orders={filtered} userId={userId} onAction={onAction} onPrint={orderId => void onPrint(orderId)} printPending={printPending} /></CardContent></Card>
  </div>;
};

const OrderForm = ({ services, customers, userId, onAction }: { services: Service[]; customers: Customer[]; userId: string; onAction: ActionHandler }) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [items, setItems] = useState<DraftOrderItem[]>([newDraftOrderItem()]);
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [discountValue, setDiscountValue] = useState('0');
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [expectedReadyAt, setExpectedReadyAt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [damageNotes, setDamageNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();

  const preview = useMemo(() => {
    try {
      getPaymentStatus(0, Number(paymentAmount));
      return {
        totals: calculateOrderTotals(
          items.map(item => ({
          item_name: item.itemName,
          service_id: item.serviceId || undefined,
          service_name: services.find(service => service.id === item.serviceId)?.name || item.itemName,
            service_type: item.serviceType,
            quantity: Number(item.quantity),
            weight_kg: Number(item.weight),
            rate: Number(item.rate),
          })),
          discountType,
          Number(discountValue),
        ),
        error: '',
      };
    } catch (previewError) {
      return { totals: null, error: errorMessage(previewError) };
    }
  }, [items, services, discountType, discountValue, paymentAmount]);
  const previewTotals = preview.totals;

  const pickCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    const customer = customers.find(item => item.id === customerId);
    if (customer) { setCustomerName(customer.name); setCustomerPhone(customer.phone); }
  };

  const updateItem = (index: number, changes: Partial<DraftOrderItem>) => {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  };

  const pickService = (index: number, nextId: string) => {
    const item = items[index];
    const service = services.find(candidate => candidate.id === nextId);
    const rate = service
      ? item.serviceType === 'weight' ? service.price_per_kg : service.price_per_piece
      : null;
    updateItem(index, { serviceId: nextId, itemName: service?.name || '', rate: rate == null ? item.rate : String(rate) });
  };

  const changeServiceType = (index: number, serviceType: ServiceType) => {
    const item = items[index];
    const service = services.find(candidate => candidate.id === item.serviceId);
    const rate = service
      ? serviceType === 'weight' ? service.price_per_kg : service.price_per_piece
      : null;
    updateItem(index, { serviceType, rate: rate == null ? item.rate : String(rate) });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await submitOnce(async () => {
      const saved = await onAction(
        () => localLaundryRepository.createOrder({
          customer_id: selectedCustomerId || customers.find(customer => customer.phone === customerPhone)?.id,
          customer_name: customerName,
          customer_phone: customerPhone,
          expected_ready_at: expectedReadyAt ? new Date(`${expectedReadyAt}T18:00:00`).toISOString() : undefined,
          order_type: items.some(item => item.serviceType === 'combined') ? 'combined' : items.some(item => item.serviceType === 'weight') && items.some(item => item.serviceType === 'piece') ? 'combined' : items.some(item => item.serviceType === 'weight') ? 'weight' : 'piece',
          items: items.map(item => ({
            item_name: item.itemName,
            service_id: item.serviceId || undefined,
            service_name: services.find(service => service.id === item.serviceId)?.name || item.itemName,
            service_type: item.serviceType,
            quantity: Number(item.quantity),
            weight_kg: Number(item.weight),
            rate: Number(item.rate),
          })),
          discount_type: discountType,
          discount_value: Number(discountValue),
          payment: Number(paymentAmount) > 0 ? { amount: Number(paymentAmount), method: paymentMethod } : undefined,
          special_instructions: instructions,
          damage_notes: damageNotes,
          internal_notes: internalNotes,
        }, userId),
        'Order saved locally.',
      );
      if (!saved) return;
      setCustomerName(''); setCustomerPhone(''); setSelectedCustomerId(''); setItems([newDraftOrderItem()]); setDiscountValue('0'); setPaymentAmount('0'); setExpectedReadyAt(''); setInstructions(''); setDamageNotes(''); setInternalNotes('');
    });
  };

  return <Card><CardHeader><CardTitle>New order</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-5">
    <div className="grid gap-4 md:grid-cols-3"><div className="space-y-1.5"><Label htmlFor="order-existing-customer">Existing customer</Label><select id="order-existing-customer" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={selectedCustomerId} onChange={event => pickCustomer(event.target.value)}><option value="">Select or enter below</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></div>
    <Field label="Customer name" value={customerName} onChange={setCustomerName} required />
    <Field label="Mobile number" value={customerPhone} onChange={setCustomerPhone} required /></div>
    <div className="space-y-3 rounded-lg border bg-slate-50 p-4"><div className="flex items-center justify-between"><div><p className="font-medium">Items and services</p><p className="text-xs text-slate-500">Add each clothing item or weight-based service separately.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setItems(current => [...current, newDraftOrderItem()])}><Plus className="mr-1 h-3.5 w-3.5" />Add item</Button></div>{items.map((item, index) => <div key={index} className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-2 xl:grid-cols-6"><div className="space-y-1.5 xl:col-span-2"><Label htmlFor={`order-service-${index}`}>Service</Label><select id={`order-service-${index}`} className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.serviceId} onChange={event => pickService(index, event.target.value)}><option value="">Custom item</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div><Field label="Item name" value={item.itemName} onChange={value => updateItem(index, { itemName: value })} required /><div className="space-y-1.5"><Label htmlFor={`order-billing-type-${index}`}>Billing type</Label><select id={`order-billing-type-${index}`} className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={item.serviceType} onChange={event => changeServiceType(index, event.target.value as ServiceType)}><option value="piece">Piece</option><option value="weight">Weight</option><option value="combined">Combined</option></select></div><Field label="Quantity" value={item.quantity} onChange={value => updateItem(index, { quantity: value })} inputMode="decimal" /><Field label="Weight (kg)" value={item.weight} onChange={value => updateItem(index, { weight: value })} inputMode="decimal" /><Field label="Rate" value={item.rate} onChange={value => updateItem(index, { rate: value })} inputMode="decimal" /><div className="flex items-end justify-between gap-3 xl:col-span-6"><p className="text-xs text-slate-500">Item total: <span className="font-medium text-slate-900">{getDraftLineTotalLabel(item)}</span></p>{items.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button>}</div></div>)}</div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="space-y-1.5"><Label htmlFor="order-discount-type">Discount type</Label><div className="flex gap-2"><select id="order-discount-type" className="h-10 rounded-md border bg-white px-2 text-sm" value={discountType} onChange={event => setDiscountType(event.target.value as typeof discountType)}><option value="fixed">₹</option><option value="percentage">%</option></select><Input aria-label="Discount amount" value={discountValue} onChange={event => setDiscountValue(event.target.value)} inputMode="decimal" /></div></div><Field label="Payment received" value={paymentAmount} onChange={setPaymentAmount} inputMode="decimal" /><div className="space-y-1.5"><Label htmlFor="order-payment-method">Payment method</Label><select id="order-payment-method" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(method => <option key={method} value={method}>{statusLabel(method)}</option>)}</select></div><Field label="Expected ready date" value={expectedReadyAt} onChange={setExpectedReadyAt} type="date" /><Field label="Instructions" value={instructions} onChange={setInstructions} /><Field label="Existing damage or stains" value={damageNotes} onChange={setDamageNotes} /><Field label="Internal notes" value={internalNotes} onChange={setInternalNotes} /></div>
    {preview.error && <ErrorText>{preview.error}</ErrorText>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">Subtotal: <span className="font-semibold text-slate-900">{previewTotals ? money(previewTotals.subtotal) : '—'}</span> · Total: <span className="font-semibold text-slate-900">{previewTotals ? money(previewTotals.totalAmount) : '—'}</span></p><Button type="submit" disabled={submitting || Boolean(preview.error)}>{submitting ? 'Saving...' : 'Save order'}</Button></div>
  </form></CardContent></Card>;
};

type OrderTableProps =
  | { orders: LocalOrder[]; compact: true }
  | { orders: LocalOrder[]; compact?: false; userId: string; onAction: ActionHandler; onPrint: (orderId: string) => void; printPending?: boolean };

const OrderTable = (props: OrderTableProps) => {
  const { orders } = props;
  if (orders.length === 0) return <Empty text="No orders found." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Order</th><th className="px-2 py-3">Customer</th><th className="px-2 py-3">Total</th><th className="px-2 py-3">Payment</th><th className="px-2 py-3">Status</th>{props.compact !== true && <th className="px-2 py-3">Actions</th>}</tr></thead><tbody>{orders.map(order => <tr key={order.id} className="border-b last:border-0"><td className="px-2 py-3 font-medium">{order.order_number}<div className="text-xs text-slate-500">{new Date(order.received_at).toLocaleDateString()}</div></td><td className="px-2 py-3">{order.customer_name}<div className="text-xs text-slate-500">{order.customer_phone}</div></td><td className="px-2 py-3">{money(order.total_amount)}</td><td className="px-2 py-3"><Badge variant="outline">{statusLabel(order.payment_status)}</Badge><div className="text-xs text-slate-500">{money(order.paid_amount || 0)} paid</div></td><td className="px-2 py-3"><Badge>{statusLabel(order.status)}</Badge></td>{props.compact !== true && <td className="px-2 py-3"><div className="flex items-center gap-2"><select aria-label={`Status for order ${order.order_number}`} className="h-8 rounded border bg-white px-2 text-xs" value={order.status} onChange={event => props.onAction(() => localLaundryRepository.setOrderStatus(order.id, event.target.value as OrderStatus, props.userId), 'Order status updated.')}>{ORDER_STATUSES.map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</select><Button aria-label={`Print order ${order.order_number}`} size="sm" variant="outline" disabled={props.printPending} onClick={() => props.onPrint(order.id)}><FileText className="h-3.5 w-3.5" /></Button></div></td>}</tr>)}</tbody></table></div>;
};

const CustomersSection = ({ customers, userId, onAction }: { customers: Customer[]; userId: string; onAction: ActionHandler }) => {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [alternatePhone, setAlternatePhone] = useState(''); const [type, setType] = useState<CustomerType>('regular'); const [address, setAddress] = useState(''); const [notes, setNotes] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();
  const submit = async (event: FormEvent) => { event.preventDefault(); await submitOnce(async () => { const saved = await onAction(() => localLaundryRepository.createCustomer({ name, phone, alternate_phone: alternatePhone, customer_type: type, address, notes }, userId), 'Customer saved locally.'); if (!saved) return; setName(''); setPhone(''); setAlternatePhone(''); setAddress(''); setNotes(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Add customer</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-3"><Field label="Name" value={name} onChange={setName} required /><Field label="Mobile" value={phone} onChange={setPhone} required /><Field label="Alternate mobile" value={alternatePhone} onChange={setAlternatePhone} /><div className="space-y-1.5"><Label htmlFor="customer-type">Customer type</Label><select id="customer-type" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={type} onChange={event => setType(event.target.value as CustomerType)}><option value="regular">Regular</option><option value="student">Student</option><option value="hostel">Hostel</option><option value="other">Other</option></select></div><Field label="Address" value={address} onChange={setAddress} /><Field label="Notes" value={notes} onChange={setNotes} /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save customer'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>{customers.length} customers</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Customer</th><th className="px-2 py-3">Phone</th><th className="px-2 py-3">Type</th><th className="px-2 py-3">Address</th><th className="px-2 py-3">Created</th></tr></thead><tbody>{customers.map(customer => <tr key={customer.id} className="border-b last:border-0"><td className="px-2 py-3 font-medium">{customer.name}<div className="text-xs text-slate-500">{customer.customer_code}</div></td><td className="px-2 py-3">{customer.phone}</td><td className="px-2 py-3">{statusLabel(customer.customer_type)}</td><td className="px-2 py-3">{customer.address || '—'}</td><td className="px-2 py-3">{new Date(customer.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div></CardContent></Card></div>;
};

const ServicesSection = ({ services, userId, onAction }: { services: Service[]; userId: string; onAction: ActionHandler }) => {
  const [name, setName] = useState(''); const [piecePrice, setPiecePrice] = useState(''); const [kgPrice, setKgPrice] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();
  const submit = async (event: FormEvent) => { event.preventDefault(); await submitOnce(async () => { const saved = await onAction(() => localLaundryRepository.createService({ name, price_per_piece: piecePrice ? Number(piecePrice) : undefined, price_per_kg: kgPrice ? Number(kgPrice) : undefined }, userId), 'Service saved locally.'); if (!saved) return; setName(''); setPiecePrice(''); setKgPrice(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Add service</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-4"><Field label="Service name" value={name} onChange={setName} required /><Field label="Price per piece" value={piecePrice} onChange={setPiecePrice} inputMode="decimal" /><Field label="Price per kg" value={kgPrice} onChange={setKgPrice} inputMode="decimal" /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save service'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Services and pricing</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Name</th><th className="px-2 py-3">Per piece</th><th className="px-2 py-3">Per kg</th><th className="px-2 py-3">State</th></tr></thead><tbody>{services.map(service => <tr key={service.id} className="border-b last:border-0"><td className="px-2 py-3 font-medium">{service.name}</td><td className="px-2 py-3">{service.price_per_piece == null ? '—' : money(service.price_per_piece)}</td><td className="px-2 py-3">{service.price_per_kg == null ? '—' : money(service.price_per_kg)}</td><td className="px-2 py-3">{service.active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div></CardContent></Card></div>;
};

const PaymentsSection = ({ orders, userId, onAction }: { orders: LocalOrder[]; userId: string; onAction: ActionHandler }) => {
  const [orderId, setOrderId] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<PaymentMethod>('cash'); const [reference, setReference] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!orderId) return; await submitOnce(async () => { const saved = await onAction(() => localLaundryRepository.addPayment(orderId, { amount: Number(amount), method, reference_number: reference }, userId), 'Payment added locally.'); if (!saved) return; setAmount(''); setReference(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Record payment</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-4"><div className="space-y-1.5 md:col-span-2"><Label htmlFor="payment-order">Order</Label><select id="payment-order" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">Select order</option>{orders.filter(order => order.payment_status !== 'paid').map(order => <option key={order.id} value={order.id}>{order.order_number} · {order.customer_name} · {money(order.total_amount - (order.paid_amount || 0))} due</option>)}</select></div><Field label="Amount" value={amount} onChange={setAmount} inputMode="decimal" required /><div className="space-y-1.5"><Label htmlFor="payment-method">Method</Label><select id="payment-method" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></div><Field label="Reference number" value={reference} onChange={setReference} /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Add payment'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Balances</CardTitle></CardHeader><CardContent><OrderTable orders={orders.filter(order => order.payment_status !== 'paid')} compact /></CardContent></Card></div>;
};

const ExpensesSection = ({ expenses, userId, onAction }: { expenses: Expense[]; userId: string; onAction: ActionHandler }) => {
  const [date, setDate] = useState(today()); const [category, setCategory] = useState('electricity'); const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<Exclude<PaymentMethod, 'credit'>>('cash'); const [notes, setNotes] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();
  const submit = async (event: FormEvent) => { event.preventDefault(); await submitOnce(async () => { const saved = await onAction(() => localLaundryRepository.createExpense({ expense_date: date, category, description, amount: Number(amount), payment_method: method, notes }, userId), 'Expense saved locally.'); if (!saved) return; setDescription(''); setAmount(''); setNotes(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Record expense</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-3"><Field label="Date" value={date} onChange={setDate} type="date" required /><div className="space-y-1.5"><Label htmlFor="expense-category">Category</Label><select id="expense-category" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={category} onChange={event => setCategory(event.target.value)}>{['electricity', 'water', 'rent', 'salary', 'detergent', 'chemicals', 'packaging', 'machine repair', 'maintenance', 'other'].map(item => <option key={item}>{item}</option>)}</select></div><Field label="Amount" value={amount} onChange={setAmount} inputMode="decimal" required /><Field label="Description" value={description} onChange={setDescription} /><div className="space-y-1.5"><Label htmlFor="expense-payment-method">Payment method</Label><select id="expense-payment-method" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={method} onChange={event => setMethod(event.target.value as typeof method)}>{PAYMENT_METHODS.filter(item => item !== 'credit').map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></div><Field label="Notes" value={notes} onChange={setNotes} /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save expense'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Expense history</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Date</th><th className="px-2 py-3">Category</th><th className="px-2 py-3">Description</th><th className="px-2 py-3">Amount</th><th className="px-2 py-3">Method</th></tr></thead><tbody>{expenses.map(expense => <tr key={expense.id} className="border-b last:border-0"><td className="px-2 py-3">{expense.expense_date}</td><td className="px-2 py-3">{statusLabel(expense.category)}</td><td className="px-2 py-3">{expense.description || '—'}</td><td className="px-2 py-3">{money(expense.amount)}</td><td className="px-2 py-3">{statusLabel(expense.payment_method)}</td></tr>)}</tbody></table></div></CardContent></Card></div>;
};

const InventorySection = ({ inventory, userId, onAction }: { inventory: InventoryItem[]; userId: string; onAction: ActionHandler }) => {
  const [name, setName] = useState(''); const [unit, setUnit] = useState('bottle'); const [minimum, setMinimum] = useState('0'); const [selected, setSelected] = useState(''); const [change, setChange] = useState(''); const [reason, setReason] = useState('');
  const { submitting: adding, run: submitAddOnce } = useSubmissionLock();
  const { submitting: adjusting, run: submitAdjustmentOnce } = useSubmissionLock();
  const addItem = async (event: FormEvent) => { event.preventDefault(); await submitAddOnce(async () => { const saved = await onAction(() => localLaundryRepository.createInventoryItem({ name, unit, minimum_quantity: Number(minimum) }, userId), 'Inventory item saved locally.'); if (!saved) return; setName(''); setUnit('bottle'); setMinimum('0'); }); };
  const adjust = async (event: FormEvent) => { event.preventDefault(); if (!selected) return; await submitAdjustmentOnce(async () => { const saved = await onAction(() => localLaundryRepository.adjustInventory(selected, Number(change), Number(change) >= 0 ? 'stock_in' : 'stock_out', reason, userId), 'Stock updated locally.'); if (!saved) return; setChange(''); setReason(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Add inventory item</CardTitle></CardHeader><CardContent><form onSubmit={addItem} className="grid gap-4 md:grid-cols-4"><Field label="Item name" value={name} onChange={setName} required /><Field label="Unit" value={unit} onChange={setUnit} required /><Field label="Minimum quantity" value={minimum} onChange={setMinimum} inputMode="decimal" /><div className="flex items-end"><Button type="submit" disabled={adding}>{adding ? 'Saving...' : 'Add item'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Stock adjustment</CardTitle></CardHeader><CardContent><form onSubmit={adjust} className="grid gap-4 md:grid-cols-4"><div className="space-y-1.5"><Label htmlFor="inventory-adjustment-item">Item</Label><select id="inventory-adjustment-item" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select item</option>{inventory.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><Field label="Change quantity" value={change} onChange={setChange} inputMode="decimal" required /><Field label="Reason" value={reason} onChange={setReason} /><div className="flex items-end"><Button type="submit" disabled={adjusting}>{adjusting ? 'Saving...' : 'Save adjustment'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Current stock</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Item</th><th className="px-2 py-3">Quantity</th><th className="px-2 py-3">Minimum</th><th className="px-2 py-3">State</th></tr></thead><tbody>{inventory.map(item => <tr key={item.id} className="border-b last:border-0"><td className="px-2 py-3">{item.name}</td><td className="px-2 py-3">{item.current_quantity} {item.unit}</td><td className="px-2 py-3">{item.minimum_quantity}</td><td className="px-2 py-3">{item.current_quantity <= item.minimum_quantity ? <Badge variant="destructive">Low stock</Badge> : <Badge variant="outline">Healthy</Badge>}</td></tr>)}</tbody></table></div></CardContent></Card></div>;
};

const MachinesSection = ({ machines, userId, onAction }: { machines: Machine[]; userId: string; onAction: ActionHandler }) => {
  const [name, setName] = useState(''); const [type, setType] = useState('washing machine'); const [capacity, setCapacity] = useState(''); const [nextMaintenance, setNextMaintenance] = useState(''); const [notes, setNotes] = useState('');
  const { submitting, run: submitOnce } = useSubmissionLock();
  const submit = async (event: FormEvent) => { event.preventDefault(); await submitOnce(async () => { const saved = await onAction(() => localLaundryRepository.createMachine({ name, machine_type: type, capacity, purchase_date: null, last_maintenance_date: null, next_maintenance_date: nextMaintenance || null, notes }, userId), 'Machine saved locally.'); if (!saved) return; setName(''); setCapacity(''); setNextMaintenance(''); setNotes(''); }); };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Add machine</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-3"><Field label="Machine name" value={name} onChange={setName} required /><div className="space-y-1.5"><Label htmlFor="machine-type">Type</Label><select id="machine-type" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={type} onChange={event => setType(event.target.value)}>{['washing machine', 'dryer', 'iron', 'steam press', 'other'].map(item => <option key={item}>{item}</option>)}</select></div><Field label="Capacity" value={capacity} onChange={setCapacity} /><Field label="Next maintenance" value={nextMaintenance} onChange={setNextMaintenance} type="date" /><Field label="Notes" value={notes} onChange={setNotes} /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save machine'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Maintenance schedule</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="px-2 py-3">Machine</th><th className="px-2 py-3">Type</th><th className="px-2 py-3">Capacity</th><th className="px-2 py-3">Next maintenance</th></tr></thead><tbody>{machines.map(machine => <tr key={machine.id} className="border-b last:border-0"><td className="px-2 py-3">{machine.name}</td><td className="px-2 py-3">{statusLabel(machine.machine_type)}</td><td className="px-2 py-3">{machine.capacity || '—'}</td><td className="px-2 py-3">{machine.next_maintenance_date || 'Not scheduled'}</td></tr>)}</tbody></table></div></CardContent></Card></div>;
};

const ReportsSection = ({ report, onGenerate }: { report: ReportSummary | null; onGenerate: (from: string, to: string) => Promise<void> }) => {
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const generate = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(''); try { await onGenerate(from, to); } catch (reportError) { setError(errorMessage(reportError)); } finally { setLoading(false); } };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Report range</CardTitle></CardHeader><CardContent><form onSubmit={generate} className="flex flex-wrap items-end gap-4"><Field label="From" value={from} onChange={setFrom} type="date" required /><Field label="To" value={to} onChange={setTo} type="date" required /><Button type="submit" disabled={loading}>{loading ? 'Generating...' : 'Generate report'}</Button></form>{error && <ErrorText>{error}</ErrorText>}</CardContent></Card>{report && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Orders" value={report.orders_today} icon={<ClipboardList />} /><Metric title="Revenue" value={money(report.sales_today)} icon={<BarChart3 />} /><Metric title="Expenses" value={money(report.expenses)} icon={<ShoppingBag />} /><Metric title="Estimated profit" value={money(report.estimated_profit)} icon={<CheckCircle2 />} /><Metric title="Completed" value={report.completed_orders} icon={<CheckCircle2 />} /><Metric title="Average order" value={money(report.average_order_value)} icon={<Receipt />} /><Metric title="Pieces" value={report.pieces_today} icon={<Box />} /><Metric title="Weight" value={`${report.weight_today.toFixed(2)} kg`} icon={<Package />} /></div>}</div>;
};

const SettingsSection = ({ settings, userId, onAction, onRestoreStaged }: {
  settings: ShopSettings;
  userId: string;
  onAction: ActionHandler;
  onRestoreStaged: () => void;
}) => {
  const [form, setForm] = useState(settings);
  const { submitting, run: submitOnce } = useSubmissionLock();
  useEffect(() => setForm(settings), [settings]);
  const update = (key: keyof ShopSettings, value: string | number) => setForm(current => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const settingsPatch: Omit<ShopSettings, 'device_id'> = {
      shop_name: form.shop_name,
      shop_address: form.shop_address,
      shop_phone: form.shop_phone,
      gst_number: form.gst_number,
      receipt_footer: form.receipt_footer,
      order_prefix: form.order_prefix,
      default_completion_days: form.default_completion_days,
    };
    await submitOnce(() => onAction(async () => {
      await localLaundryRepository.saveSettings(settingsPatch, userId);
    }, 'Settings saved locally.'));
  };
  const backup = async () => { try { const path = await backupDatabase(); window.alert(`Backup created at ${path}`); } catch (backupError) { window.alert(errorMessage(backupError)); } };
  const restore = async () => {
    try {
      const selected = await open({
        title: 'Choose a Smart Laundry backup',
        multiple: false,
        directory: false,
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const confirmed = await confirm(
        'This backup will replace the current database the next time Smart Laundry opens. The app will first save a safety backup. Smart Laundry will block changes until it restarts.',
        { title: 'Restore backup', kind: 'warning', okLabel: 'Stage restore', cancelLabel: 'Cancel' },
      );
      if (!confirmed) return;
      const message = await restoreDatabase(selected);
      onRestoreStaged();
      window.alert(message);
    } catch (restoreError) {
      window.alert(errorMessage(restoreError));
    }
  };
  return <div className="space-y-6"><Card><CardHeader><CardTitle>Shop settings</CardTitle></CardHeader><CardContent><form onSubmit={save} className="grid gap-4 md:grid-cols-2"><Field label="Shop name" value={form.shop_name} onChange={value => update('shop_name', value)} required /><Field label="Phone" value={form.shop_phone} onChange={value => update('shop_phone', value)} /><Field label="Address" value={form.shop_address} onChange={value => update('shop_address', value)} /><Field label="GST number" value={form.gst_number} onChange={value => update('gst_number', value)} /><Field label="Order prefix" value={form.order_prefix} onChange={value => update('order_prefix', value)} /><Field label="Default completion days" value={form.default_completion_days} onChange={value => update('default_completion_days', Number(value))} inputMode="numeric" /><Field label="Receipt footer" value={form.receipt_footer} onChange={value => update('receipt_footer', value)} /><div className="flex items-end"><Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save settings'}</Button></div></form></CardContent></Card><Card><CardHeader><CardTitle>Backup</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-500">Backups stay on this Mac. A backup is also created when the app opens, and the newest 30 database copies are kept.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void backup()}><DatabaseBackup className="mr-2 h-4 w-4" />Backup now</Button><Button variant="outline" onClick={() => void restore()}>Restore backup</Button></div><p className="text-xs text-slate-500">Restore stages the selected file and applies it after you close and reopen the app.</p></CardContent></Card></div>;
};

const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-slate-500">{text}</p>;
