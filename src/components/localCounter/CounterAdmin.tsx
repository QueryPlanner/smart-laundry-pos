import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CounterBackups } from './CounterBackups';
import { CounterDiscounts } from './CounterDiscounts';
import { RateCard } from './RateCard';
import { createCounterStaff, enumeratePrinters, getPrinterProfiles, listCounterStaff, resetCounterStaffPin, setCounterStaffActive, setPrinterProfiles, type CounterAccount, type CounterCatalogue, type NativePrinter } from '@/lib/localFirst/counter';

type AdminTab = 'rates' | 'discounts' | 'staff' | 'printers' | 'backups';
const TAB_LABEL: Record<AdminTab, string> = { rates: 'Rate card', discounts: 'Discounts', staff: 'Staff', printers: 'Printers', backups: 'Backups' };

interface CounterAdminProps {
  catalogue: CounterCatalogue | null;
  onCatalogue: (catalogue: CounterCatalogue) => void;
  printers: NativePrinter[];
  onReloadPrinters: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
  onRestoreStaged: () => void;
}

export const CounterAdmin = ({ catalogue, onCatalogue, printers, onReloadPrinters, onError, onNotice, onRestoreStaged }: CounterAdminProps) => {
  const [tab, setTab] = useState<AdminTab>('rates');
  const [staff, setStaff] = useState<CounterAccount[]>([]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [profiles, setProfiles] = useState({ billPrinterId: '', tagPrinterId: '' });
  const [knownPrinters, setKnownPrinters] = useState<NativePrinter[]>(printers);

  useEffect(() => {
    if (tab === 'staff') void listCounterStaff().then(setStaff).catch(onError);
    if (tab === 'printers') {
      void Promise.all([enumeratePrinters(), getPrinterProfiles()])
        .then(([installed, saved]) => { setKnownPrinters(installed); if (saved) setProfiles(saved); })
        .catch(onError);
    }
  }, [tab, onError]);
  // "Refresh printer list" reloads the list in the parent; show it without touching the picked printers.
  useEffect(() => { setKnownPrinters(printers); }, [printers]);

  return <section className="counter-panel counter-admin">
    <div className="counter-admin-heading">
      <div><span className="counter-section-label">Admin controls</span><h1>Rates, staff & printers</h1></div>
    </div>
    <div className="counter-admin-tabs">
      {(Object.keys(TAB_LABEL) as AdminTab[]).map(t => <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
    </div>
    {tab === 'rates' && catalogue && <RateCard catalogue={catalogue} onCatalogue={onCatalogue} onError={onError} onNotice={onNotice} />}
    {tab === 'discounts' && <CounterDiscounts onError={onError} onNotice={onNotice} />}
    {tab === 'backups' && <CounterBackups onError={onError} onNotice={onNotice} onRestoreStaged={onRestoreStaged} />}
    {tab === 'staff' && <>
      <form className="counter-add-staff" onSubmit={async e => {
        e.preventDefault();
        try {
          await createCounterStaff({ fullName: name, pin });
          setName(''); setPin('');
          setStaff(await listCounterStaff());
          onNotice('Staff account created.');
        } catch (x) { onError(x); }
      }}>
        <Label>Name<Input value={name} onChange={e => setName(e.target.value)} required /></Label>
        <Label>Initial PIN<Input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} required /></Label>
        <Button>Create staff</Button>
      </form>
      <div className="counter-staff-list">
        {staff.filter(x => x.role === 'staff').map(s => <StaffRow key={s.id} account={s} onChanged={async () => setStaff(await listCounterStaff())} onError={onError} onNotice={onNotice} />)}
      </div>
    </>}
    {tab === 'printers' && <>
      <p>Choose installed queues for each output. The native queue state is shown after saving.</p>
      <div className="counter-printer-settings">
        <Label>Canon bill printer<select value={profiles.billPrinterId} onChange={e => setProfiles({ ...profiles, billPrinterId: e.target.value })}><option value="">Select a printer</option>{knownPrinters.filter(x => x.isAvailable).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Label>
        <Label>TSC tag printer<select value={profiles.tagPrinterId} onChange={e => setProfiles({ ...profiles, tagPrinterId: e.target.value })}><option value="">Select a printer</option>{knownPrinters.filter(x => x.isAvailable).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Label>
        <Button onClick={async () => { try { await setPrinterProfiles(profiles); onNotice('Printer profiles saved.'); } catch (e) { onError(e); } }}>Save printers</Button>
        <Button variant="outline" onClick={onReloadPrinters}>Refresh printer list</Button>
      </div>
      <ul>{knownPrinters.map(p => <li key={p.id}>{p.name} · {p.isAvailable ? 'Available' : 'Unavailable'}{p.isDefault ? ' · system default' : ''}</li>)}</ul>
      <p className="counter-summary-note">TSC TE244 stock is 50 mm wide. Confirm alignment and feed calibration on the Windows shop computer.</p>
    </>}
  </section>;
};

interface StaffRowProps {
  account: CounterAccount;
  onChanged: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}

const StaffRow = ({ account, onChanged, onError, onNotice }: StaffRowProps) => {
  const [pin, setPin] = useState('');
  const toggleActive = async () => {
    try {
      await setCounterStaffActive(account.id, !account.active);
      onChanged();
      onNotice(account.active ? `${account.fullName} can no longer sign in.` : `${account.fullName} can sign in again.`);
    } catch (e) { onError(e); }
  };
  const resetPin = async () => {
    try {
      await resetCounterStaffPin(account.id, pin);
      setPin('');
      onChanged();
      onNotice(`New PIN saved for ${account.fullName}.`);
    } catch (e) { onError(e); }
  };
  return <div className="counter-staff-row">
    <strong>{account.fullName}</strong>
    <span>{account.active ? 'Active' : 'Inactive'}</span>
    <Button variant="outline" size="sm" onClick={() => void toggleActive()}>{account.active ? 'Deactivate' : 'Activate'}</Button>
    <Input aria-label={`New PIN for ${account.fullName}`} type="password" inputMode="numeric" value={pin} placeholder="Reset PIN" onChange={e => setPin(e.target.value)} />
    <Button variant="outline" size="sm" disabled={!pin} onClick={() => void resetPin()}>Reset PIN</Button>
  </div>;
};
