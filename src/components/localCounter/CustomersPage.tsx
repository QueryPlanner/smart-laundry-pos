import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOfficeCustomer, deleteOfficeCustomer, getOfficeCustomer, listOfficeCustomers, updateOfficeCustomer, type CustomerType, type OfficeCustomer, type OfficeCustomerDetail } from '@/lib/localFirst/office';
import { ConfirmDelete, EmptyState, FormField, PageHeader, money } from './ui';
import { formatShopDate, orUndefined, statusLabel } from './officeFormat';
import type { SectionProps } from './sections';

const PAGE_SIZE = 100;
const TYPE_LABEL: Record<CustomerType, string> = { regular: 'Regular', student: 'Student', hostel: 'Hostel', other: 'Other' };
const TYPES = (Object.keys(TYPE_LABEL) as CustomerType[]).map(value => ({ value, label: TYPE_LABEL[value] }));

interface Form { id: string | null; name: string; phone: string; alternatePhone: string; address: string; customerType: CustomerType; notes: string; lockIdentity: boolean }
const blankForm: Form = { id: null, name: '', phone: '', alternatePhone: '', address: '', customerType: 'regular', notes: '', lockIdentity: false };

/** Customers: search, add and edit, with each customer's order history. Only an administrator can delete. */
export const CustomersPage = ({ account, onError, onNotice, onOpenOrder }: SectionProps) => {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<OfficeCustomer[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OfficeCustomerDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick(current => current + 1);
  const isAdmin = account.role === 'admin';

  useEffect(() => {
    let live = true;
    void listOfficeCustomers(search.trim(), 0, PAGE_SIZE).then(rows => { if (live) setCustomers(rows); }).catch(onError);
    return () => { live = false; };
  }, [search, tick, onError]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let live = true;
    void getOfficeCustomer(selectedId).then(found => { if (live) setDetail(found); }).catch(onError);
    return () => { live = false; };
  }, [selectedId, tick, onError]);

  const edit = (customer: OfficeCustomer) => setForm({
    id: customer.id, name: customer.name, phone: customer.phone, alternatePhone: customer.alternatePhone ?? '',
    address: customer.address ?? '', customerType: customer.customerType, notes: customer.notes ?? '',
    lockIdentity: customer.hasDiscountRule && !isAdmin,
  });
  const change = (patch: Partial<Form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    const fields = {
      name: form.name.trim(), phone: form.phone.trim(), alternatePhone: orUndefined(form.alternatePhone),
      address: orUndefined(form.address), customerType: form.customerType, notes: orUndefined(form.notes),
    };
    setSaving(true);
    try {
      const saved = form.id ? await updateOfficeCustomer(form.id, fields) : await createOfficeCustomer(fields);
      setForm(null);
      setSelectedId(saved.id);
      reload();
      onNotice(form.id ? 'Customer updated.' : 'Customer added.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const remove = async (customer: OfficeCustomer, reason: string) => {
    try {
      await deleteOfficeCustomer(customer.id, reason);
      setSelectedId(null);
      reload();
      onNotice('Customer deleted.');
    } catch (error) { onError(error); }
  };

  return (
    <section className="counter-page">
      <PageHeader title="Customers" subtitle="Everyone who has left laundry with you, with what they have billed." actions={<Button onClick={() => { setSelectedId(null); setForm(blankForm); }}>Add customer</Button>} />
      <div className="counter-panel counter-filters">
        <FormField label="Search customers"><Input value={search} placeholder="Name, mobile number or customer code" maxLength={100} onChange={event => setSearch(event.target.value)} /></FormField>
      </div>
      <div className="counter-split">
        <div className="counter-panel counter-table-wrap">
          {customers === null ? null : customers.length === 0 ? <EmptyState>{search.trim() ? 'No customer matches that search.' : 'No customers yet. They are added automatically with their first order, or add one here.'}</EmptyState> : (
            <>
              <table className="counter-table">
                <thead><tr><th>Name</th><th>Mobile</th><th className="num">Orders</th><th className="num">Billed</th><th>Last order</th></tr></thead>
                <tbody>{customers.map(customer => (
                  <tr key={customer.id} className={customer.id === selectedId ? 'counter-row-selected' : undefined}>
                    <td><button type="button" className="counter-link-button" onClick={() => { setForm(null); setSelectedId(customer.id); }}>{customer.name}</button>{customer.hasDiscountRule && <> <span className="counter-badge good">Discount</span></>}</td>
                    <td>{customer.phone}</td>
                    <td className="num">{customer.orderCount}</td>
                    <td className="num">{money(customer.billedMinor)}</td>
                    <td>{formatShopDate(customer.lastOrderAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {customers.length === PAGE_SIZE && <p className="counter-table-note">Showing the first {PAGE_SIZE} customers. Search to narrow the list.</p>}
            </>
          )}
        </div>
        {form && (
          <form className="counter-panel counter-detail" aria-label={form.id ? 'Edit customer' : 'Add customer'} onSubmit={event => { event.preventDefault(); void save(); }}>
            <h2>{form.id ? 'Edit customer' : 'Add customer'}</h2>
            <FormField label="Name"><Input value={form.name} maxLength={100} disabled={form.lockIdentity} onChange={event => change({ name: event.target.value })} /></FormField>
            <FormField label="Mobile number"><Input value={form.phone} inputMode="tel" disabled={form.lockIdentity} onChange={event => change({ phone: event.target.value })} /></FormField>
            {form.lockIdentity && <p className="counter-settings-note">This customer has a discount, so only the administrator can change the name or mobile number.</p>}
            <FormField label="Alternate mobile (optional)"><Input value={form.alternatePhone} inputMode="tel" onChange={event => change({ alternatePhone: event.target.value })} /></FormField>
            <FormField label="Customer type">
              <select value={form.customerType} onChange={event => change({ customerType: event.target.value as CustomerType })}>
                {TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
            <FormField label="Address (optional)"><Input value={form.address} maxLength={300} onChange={event => change({ address: event.target.value })} /></FormField>
            <FormField label="Notes (optional)"><textarea value={form.notes} maxLength={500} onChange={event => change({ notes: event.target.value })} /></FormField>
            <div className="counter-form-row">
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save customer'}</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </form>
        )}
        {!form && detail && (
          <article className="counter-panel counter-detail" aria-label="Customer details">
            <div>
              <h2>{detail.customer.name}</h2>
              <span className="counter-section-label">{detail.customer.customerCode} · {TYPE_LABEL[detail.customer.customerType]}</span>
            </div>
            <dl className="counter-facts">
              <dt>Mobile</dt><dd>{detail.customer.phone}</dd>
              {detail.customer.alternatePhone && <><dt>Alternate</dt><dd>{detail.customer.alternatePhone}</dd></>}
              {detail.customer.address && <><dt>Address</dt><dd>{detail.customer.address}</dd></>}
              {detail.customer.notes && <><dt>Notes</dt><dd>{detail.customer.notes}</dd></>}
              <dt>Orders</dt><dd>{detail.customer.orderCount}</dd>
              <dt>Billed</dt><dd>{money(detail.customer.billedMinor)}</dd>
              <dt>Last order</dt><dd>{formatShopDate(detail.customer.lastOrderAt)}</dd>
            </dl>
            <p className="counter-table-note">Billed leaves out cancelled orders.</p>
            {detail.customer.hasDiscountRule && <p className="counter-settings-note">This customer has an automatic discount set by the administrator.</p>}
            <h3>Recent orders</h3>
            {detail.recentOrders.length === 0 ? <EmptyState>No orders yet.</EmptyState> : (
              <table className="counter-table">
                <thead><tr><th>Bill</th><th>Date</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
                <tbody>{detail.recentOrders.map(order => (
                  <tr key={order.id}>
                    <td><button type="button" className="counter-link-button counter-bill-link" onClick={() => onOpenOrder(order.id)}>{order.orderNumber}</button></td>
                    <td>{formatShopDate(order.receivedAt)}</td>
                    <td>{statusLabel(order.status)}</td>
                    <td className="num">{money(order.totalMinor)}</td>
                    <td className="num">{money(order.balanceMinor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <div className="counter-form-row">
              <Button variant="outline" onClick={() => edit(detail.customer)}>Edit</Button>
              {isAdmin && <ConfirmDelete what={`customer ${detail.customer.name}`} onConfirm={reason => remove(detail.customer, reason)} />}
            </div>
            {isAdmin && detail.customer.orderCount > 0 && <p className="counter-table-note">A customer with orders cannot be deleted; orders are never deleted.</p>}
          </article>
        )}
      </div>
    </section>
  );
};
