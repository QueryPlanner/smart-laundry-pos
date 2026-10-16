import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOfficeMachine, deleteOfficeMachine, listOfficeMachines, updateOfficeMachine, type OfficeMachine, type OfficeMachineInput } from '@/lib/localFirst/office';
import { ConfirmDelete, EmptyState, FormField, PageHeader, StatCard } from './ui';
import { formatShopDate, orUndefined, shopToday } from './officeFormat';
import type { SectionProps } from './sections';

interface Form { id: string | null; name: string; machineType: string; capacity: string; purchaseDate: string; lastMaintenanceDate: string; nextMaintenanceDate: string; notes: string }
const blankForm: Form = { id: null, name: '', machineType: '', capacity: '', purchaseDate: '', lastMaintenanceDate: '', nextMaintenanceDate: '', notes: '' };
interface Service { machine: OfficeMachine; servicedOn: string; nextDue: string; notes: string }

const inputOf = (machine: OfficeMachine, patch: Partial<OfficeMachineInput> = {}): OfficeMachineInput => ({
  name: machine.name, machineType: machine.machineType, capacity: machine.capacity ?? undefined,
  purchaseDate: machine.purchaseDate ?? undefined, lastMaintenanceDate: machine.lastMaintenanceDate ?? undefined,
  nextMaintenanceDate: machine.nextMaintenanceDate ?? undefined, notes: machine.notes ?? undefined, ...patch,
});

/** Washers, dryers and irons with their service dates. Staff add machines and record services; only an administrator can delete. */
export const MachinesPage = ({ account, onError, onNotice }: SectionProps) => {
  const [machines, setMachines] = useState<OfficeMachine[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const isAdmin = account.role === 'admin';
  const reload = () => setTick(current => current + 1);

  useEffect(() => {
    let live = true;
    void listOfficeMachines().then(loaded => { if (live) setMachines(loaded); }).catch(onError);
    return () => { live = false; };
  }, [tick, onError]);

  const change = (patch: Partial<Form>) => setForm(current => ({ ...current, ...patch }));
  const edit = (machine: OfficeMachine) => setForm({
    id: machine.id, name: machine.name, machineType: machine.machineType, capacity: machine.capacity ?? '',
    purchaseDate: machine.purchaseDate ?? '', lastMaintenanceDate: machine.lastMaintenanceDate ?? '',
    nextMaintenanceDate: machine.nextMaintenanceDate ?? '', notes: machine.notes ?? '',
  });

  const run = async (action: () => Promise<unknown>, notice: string, done: () => void) => {
    setSaving(true);
    try { await action(); done(); reload(); onNotice(notice); } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const save = () => {
    const input: OfficeMachineInput = {
      name: form.name.trim(), machineType: form.machineType.trim(), capacity: orUndefined(form.capacity),
      purchaseDate: orUndefined(form.purchaseDate), lastMaintenanceDate: orUndefined(form.lastMaintenanceDate),
      nextMaintenanceDate: orUndefined(form.nextMaintenanceDate), notes: orUndefined(form.notes),
    };
    return run(() => (form.id ? updateOfficeMachine(form.id, input) : createOfficeMachine(input)), form.id ? 'Machine updated.' : 'Machine added.', () => setForm(null));
  };

  const saveService = () => {
    const patch = { lastMaintenanceDate: service.servicedOn, nextMaintenanceDate: orUndefined(service.nextDue), notes: orUndefined(service.notes) };
    return run(() => updateOfficeMachine(service.machine.id, inputOf(service.machine, patch)), 'Service recorded.', () => setService(null));
  };

  const remove = async (machine: OfficeMachine, reason: string) => {
    try {
      await deleteOfficeMachine(machine.id, reason);
      reload();
      onNotice('Machine deleted.');
    } catch (error) { onError(error); }
  };

  const due = (machines ?? []).filter(machine => machine.maintenanceDue).length;

  return (
    <section className="counter-page">
      <PageHeader title="Machines" subtitle="Keep track of when each machine was last serviced and when it is next due." actions={<Button onClick={() => { setService(null); setForm(blankForm); }}>Add machine</Button>} />
      {machines && <div className="counter-stats">
        <StatCard label="Machines" value={machines.length} />
        <StatCard label="Service due" value={due} tone={due > 0 ? 'warn' : 'good'} hint="Next service date is today or past" />
      </div>}
      {form && (
        <form className="counter-panel counter-detail" aria-label={form.id ? 'Edit machine' : 'Add machine'} onSubmit={event => { event.preventDefault(); void save(); }}>
          <h2>{form.id ? 'Edit machine' : 'Add machine'}</h2>
          <div className="counter-form-row">
            <FormField label="Name"><Input value={form.name} maxLength={80} onChange={event => change({ name: event.target.value })} /></FormField>
            <FormField label="Type"><Input value={form.machineType} maxLength={40} placeholder="Washer, Dryer, Iron" onChange={event => change({ machineType: event.target.value })} /></FormField>
            <FormField label="Capacity (optional)"><Input value={form.capacity} maxLength={40} placeholder="12 kg" onChange={event => change({ capacity: event.target.value })} /></FormField>
          </div>
          <div className="counter-form-row">
            <FormField label="Bought on"><Input type="date" value={form.purchaseDate} max={shopToday()} onChange={event => change({ purchaseDate: event.target.value })} /></FormField>
            <FormField label="Last serviced"><Input type="date" value={form.lastMaintenanceDate} max={shopToday()} onChange={event => change({ lastMaintenanceDate: event.target.value })} /></FormField>
            <FormField label="Next service due"><Input type="date" value={form.nextMaintenanceDate} onChange={event => change({ nextMaintenanceDate: event.target.value })} /></FormField>
          </div>
          <FormField label="Notes (optional)"><textarea value={form.notes} maxLength={500} onChange={event => change({ notes: event.target.value })} /></FormField>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save machine'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {service && (
        <form className="counter-panel counter-detail" aria-label="Record service" onSubmit={event => { event.preventDefault(); void saveService(); }}>
          <h2>Record service: {service.machine.name}</h2>
          <div className="counter-form-row">
            <FormField label="Serviced on"><Input type="date" value={service.servicedOn} max={shopToday()} onChange={event => setService({ ...service, servicedOn: event.target.value })} /></FormField>
            <FormField label="Next service due"><Input type="date" value={service.nextDue} onChange={event => setService({ ...service, nextDue: event.target.value })} /></FormField>
          </div>
          <FormField label="Service notes"><textarea value={service.notes} maxLength={500} onChange={event => setService({ ...service, notes: event.target.value })} /></FormField>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save service'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setService(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="counter-panel counter-table-wrap">
        {machines === null ? null : machines.length === 0 ? <EmptyState>No machines yet. Add your washers, dryers and irons.</EmptyState> : (
          <table className="counter-table">
            <thead><tr><th>Machine</th><th>Type</th><th>Last serviced</th><th>Next service</th><th><span className="counter-visually-hidden">Actions</span></th></tr></thead>
            <tbody>{machines.map(machine => (
              <tr key={machine.id}>
                <td>{machine.name}{machine.capacity && <small className="counter-cell-note">{machine.capacity}</small>}{machine.notes && <small className="counter-cell-note">{machine.notes}</small>}</td>
                <td>{machine.machineType}</td>
                <td className="counter-nowrap">{formatShopDate(machine.lastMaintenanceDate)}</td>
                <td className="counter-nowrap">{formatShopDate(machine.nextMaintenanceDate)}{machine.maintenanceDue && <> <span className="counter-badge warn">Due</span></>}</td>
                <td>
                  <div className="counter-form-row">
                    <Button size="sm" variant="outline" onClick={() => { setForm(null); setService({ machine, servicedOn: shopToday(), nextDue: '', notes: machine.notes ?? '' }); }}>Record service</Button>
                    <Button size="sm" variant="outline" onClick={() => { setService(null); edit(machine); }}>Edit</Button>
                    {isAdmin && <ConfirmDelete what={`machine ${machine.name}`} onConfirm={reason => remove(machine, reason)} />}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
};
