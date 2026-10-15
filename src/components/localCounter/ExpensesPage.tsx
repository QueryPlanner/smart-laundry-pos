import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOfficeExpense, deleteOfficeExpense, listOfficeExpenses, type ExpensePaymentMethod, type OfficeExpense, type OfficeExpenseList } from '@/lib/localFirst/office';
import { parsePaymentAmountMinor } from '@/lib/localFirst/payment';
import { ConfirmDelete, EmptyState, FormField, PageHeader, StatCard, money } from './ui';
import { formatShopDate, orUndefined, shopMonthStart, shopToday } from './officeFormat';
import type { SectionProps } from './sections';

const METHOD_LABEL: Record<ExpensePaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' };
const METHODS = (Object.keys(METHOD_LABEL) as ExpensePaymentMethod[]).map(value => ({ value, label: METHOD_LABEL[value] }));
const AMOUNT_HELP = 'Enter an amount above zero, like 250 or 250.50.';

interface Form { date: string; category: string; amount: string; method: ExpensePaymentMethod; description: string; notes: string }
const blankForm = (): Form => ({ date: shopToday(), category: '', amount: '', method: 'cash', description: '', notes: '' });

/** Shop expenses by day and category. Staff record them; only an administrator can delete one. */
export const ExpensesPage = ({ account, onError, onNotice }: SectionProps) => {
  const [from, setFrom] = useState(shopMonthStart);
  const [to, setTo] = useState(shopToday);
  const [category, setCategory] = useState('');
  const [list, setList] = useState<OfficeExpenseList | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const isAdmin = account.role === 'admin';
  const categories = list?.categories ?? [];

  useEffect(() => {
    let live = true;
    void listOfficeExpenses({ from: orUndefined(from), to: orUndefined(to), category: orUndefined(category) })
      .then(loaded => { if (live) setList(loaded); }).catch(onError);
    return () => { live = false; };
  }, [from, to, category, tick, onError]);

  const change = (patch: Partial<Form>) => setForm(current => ({ ...current, ...patch }));

  const save = async () => {
    const amountMinor = parsePaymentAmountMinor(form.amount);
    if (!amountMinor) { onError(new Error(AMOUNT_HELP)); return; }
    setSaving(true);
    try {
      await createOfficeExpense({
        expenseDate: form.date, category: form.category.trim(), description: orUndefined(form.description),
        amountMinor, paymentMethod: form.method, notes: orUndefined(form.notes),
      });
      setForm(null);
      setTick(current => current + 1);
      onNotice('Expense recorded.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const remove = async (expense: OfficeExpense, reason: string) => {
    try {
      await deleteOfficeExpense(expense.id, reason);
      setTick(current => current + 1);
      onNotice('Expense deleted.');
    } catch (error) { onError(error); }
  };

  return (
    <section className="counter-page">
      <PageHeader title="Expenses" subtitle="Dates are shop dates, and both the first and last day are included." actions={<Button onClick={() => setForm(blankForm())}>Add expense</Button>} />
      <div className="counter-panel counter-filters">
        <FormField label="From"><Input type="date" value={from} onChange={event => setFrom(event.target.value)} /></FormField>
        <FormField label="To"><Input type="date" value={to} onChange={event => setTo(event.target.value)} /></FormField>
        <FormField label="Category">
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </FormField>
        <div className="counter-chips" aria-label="Date range">
          <button type="button" onClick={() => { setFrom(shopMonthStart()); setTo(shopToday()); }}>This month</button>
          <button type="button" onClick={() => { setFrom(''); setTo(''); }}>All time</button>
        </div>
      </div>
      {list && <div className="counter-stats">
        <StatCard label="Total spent" value={money(list.totalMinor)} hint="In the selected dates" tone="warn" />
        <StatCard label="Expenses" value={list.matching} hint={list.matching > list.items.length ? `Showing the latest ${list.items.length}` : undefined} />
      </div>}
      {form && (
        <form className="counter-panel counter-detail" aria-label="Add expense" onSubmit={event => { event.preventDefault(); void save(); }}>
          <h2>Add expense</h2>
          <div className="counter-form-row">
            <FormField label="Date"><Input type="date" value={form.date} max={shopToday()} onChange={event => change({ date: event.target.value })} /></FormField>
            <FormField label="Category">
              <Input value={form.category} list="expense-categories" maxLength={60} placeholder="Rent, Electricity, Detergent..." onChange={event => change({ category: event.target.value })} />
              <datalist id="expense-categories">{categories.map(name => <option key={name} value={name} />)}</datalist>
            </FormField>
            <FormField label="Amount (₹)"><Input value={form.amount} inputMode="decimal" onChange={event => change({ amount: event.target.value })} /></FormField>
            <FormField label="Paid by">
              <select value={form.method} onChange={event => change({ method: event.target.value as ExpensePaymentMethod })}>
                {METHODS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Description (optional)"><Input value={form.description} maxLength={200} onChange={event => change({ description: event.target.value })} /></FormField>
          <FormField label="Notes (optional)"><textarea value={form.notes} maxLength={500} onChange={event => change({ notes: event.target.value })} /></FormField>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save expense'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="counter-panel counter-table-wrap">
        {list === null ? null : list.items.length === 0 ? <EmptyState>No expenses in these dates.</EmptyState> : (
          <table className="counter-table">
            <thead><tr><th>Date</th><th>Category</th><th>Details</th><th>Paid by</th><th className="num">Amount</th><th>Recorded by</th>{isAdmin && <th><span className="counter-visually-hidden">Actions</span></th>}</tr></thead>
            <tbody>{list.items.map(expense => (
              <tr key={expense.id}>
                <td className="counter-nowrap">{formatShopDate(expense.expenseDate)}</td>
                <td>{expense.category}</td>
                <td>{[expense.description, expense.notes].filter(Boolean).join(' · ') || '—'}</td>
                <td>{METHOD_LABEL[expense.paymentMethod]}</td>
                <td className="num">{money(expense.amountMinor)}</td>
                <td>{expense.createdByName ?? '—'}</td>
                {isAdmin && <td><ConfirmDelete what={`this ${money(expense.amountMinor)} ${expense.category} expense (profit for ${formatShopDate(expense.expenseDate)} will change)`} onConfirm={reason => remove(expense, reason)} /></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
};
