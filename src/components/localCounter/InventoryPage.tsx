import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adjustOfficeInventory, createOfficeInventoryItem, deleteOfficeInventoryItem, listOfficeInventory, type OfficeInventoryItem, type StockTransactionType } from '@/lib/localFirst/office';
import { parsePaymentAmountMinor } from '@/lib/localFirst/payment';
import { ConfirmDelete, EmptyState, FormField, PageHeader, StatCard, money } from './ui';
import { orUndefined } from './officeFormat';
import type { SectionProps } from './sections';

const QUANTITY = /^\d{1,7}(?:\.\d{1,3})?$/;
const QUANTITY_HELP = 'Enter a quantity above zero with at most three decimals, like 2 or 0.5.';

type Move = 'in' | 'out' | 'up' | 'down';
const MOVES: Record<Move, { label: string; type: StockTransactionType; sign: 1 | -1; reason: string }> = {
  in: { label: 'Stock in (received)', type: 'stock_in', sign: 1, reason: 'Stock received' },
  out: { label: 'Stock out (used)', type: 'stock_out', sign: -1, reason: 'Used in the shop' },
  up: { label: 'Count correction: add', type: 'adjustment', sign: 1, reason: 'Count correction' },
  down: { label: 'Count correction: remove', type: 'adjustment', sign: -1, reason: 'Count correction' },
};

/** A plain quantity with up to three decimals; zero is allowed only where the caller says so. Blank counts as zero. */
const quantityOf = (text: string, allowZero = false): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return allowZero ? 0 : null;
  const value = QUANTITY.test(trimmed) ? Number(trimmed) : null;
  return value !== null && (value > 0 || allowZero) ? value : null;
};

interface NewItem { name: string; unit: string; minimum: string; opening: string; cost: string; notes: string }
const blankItem: NewItem = { name: '', unit: '', minimum: '', opening: '', cost: '', notes: '' };
interface Adjust { itemId: string; name: string; move: Move; quantity: string; reason: string }

/** Shop supplies: stock levels with low-stock warnings. Staff add items and adjust stock; only an administrator can delete. */
export const InventoryPage = ({ account, onError, onNotice }: SectionProps) => {
  const [items, setItems] = useState<OfficeInventoryItem[] | null>(null);
  const [adding, setAdding] = useState<NewItem | null>(null);
  const [adjust, setAdjust] = useState<Adjust | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const isAdmin = account.role === 'admin';
  const reload = () => setTick(current => current + 1);

  useEffect(() => {
    let live = true;
    void listOfficeInventory().then(loaded => { if (live) setItems(loaded); }).catch(onError);
    return () => { live = false; };
  }, [tick, onError]);

  const saveItem = async () => {
    const minimum = quantityOf(adding.minimum, true);
    const opening = quantityOf(adding.opening, true);
    const cost = parsePaymentAmountMinor(adding.cost);
    if (minimum === null || opening === null) { onError(new Error(QUANTITY_HELP)); return; }
    if (cost === null) { onError(new Error('Enter the cost as an amount like 120 or 120.50.')); return; }
    setSaving(true);
    try {
      await createOfficeInventoryItem({
        name: adding.name.trim(), unit: adding.unit.trim(), minimumQuantity: minimum,
        openingQuantity: opening > 0 ? opening : undefined, purchaseCostMinor: cost > 0 ? cost : undefined, notes: orUndefined(adding.notes),
      });
      setAdding(null);
      reload();
      onNotice('Item added.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const saveAdjust = async () => {
    const quantity = quantityOf(adjust.quantity);
    if (quantity === null) { onError(new Error(QUANTITY_HELP)); return; }
    const move = MOVES[adjust.move];
    setSaving(true);
    try {
      await adjustOfficeInventory({ itemId: adjust.itemId, transactionType: move.type, changeQuantity: quantity * move.sign, reason: adjust.reason.trim() });
      setAdjust(null);
      reload();
      onNotice('Stock updated.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const remove = async (item: OfficeInventoryItem, reason: string) => {
    try {
      await deleteOfficeInventoryItem(item.id, reason);
      reload();
      onNotice('Item deleted.');
    } catch (error) { onError(error); }
  };

  const low = (items ?? []).filter(item => item.lowStock).length;
  const startAdjust = (item: OfficeInventoryItem) => setAdjust({ itemId: item.id, name: item.name, move: 'in', quantity: '', reason: MOVES.in.reason });

  return (
    <section className="counter-page">
      <PageHeader title="Inventory" subtitle="Detergent, hangers, packaging and other supplies." actions={<Button onClick={() => setAdding(blankItem)}>Add item</Button>} />
      {items && <div className="counter-stats">
        <StatCard label="Items" value={items.length} />
        <StatCard label="Low stock" value={low} tone={low > 0 ? 'bad' : 'good'} hint="At or below the minimum" />
      </div>}
      {adding && (
        <form className="counter-panel counter-detail" aria-label="Add item" onSubmit={event => { event.preventDefault(); void saveItem(); }}>
          <h2>Add item</h2>
          <div className="counter-form-row">
            <FormField label="Item name"><Input value={adding.name} maxLength={80} onChange={event => setAdding({ ...adding, name: event.target.value })} /></FormField>
            <FormField label="Unit"><Input value={adding.unit} maxLength={20} placeholder="kg, litre, pcs" onChange={event => setAdding({ ...adding, unit: event.target.value })} /></FormField>
            <FormField label="Warn me at or below"><Input value={adding.minimum} inputMode="decimal" onChange={event => setAdding({ ...adding, minimum: event.target.value })} /></FormField>
            <FormField label="Stock on hand now"><Input value={adding.opening} inputMode="decimal" onChange={event => setAdding({ ...adding, opening: event.target.value })} /></FormField>
            <FormField label="Cost per unit (₹, optional)"><Input value={adding.cost} inputMode="decimal" onChange={event => setAdding({ ...adding, cost: event.target.value })} /></FormField>
          </div>
          <FormField label="Notes (optional)"><textarea value={adding.notes} maxLength={500} onChange={event => setAdding({ ...adding, notes: event.target.value })} /></FormField>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save item'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setAdding(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {adjust && (
        <form className="counter-panel counter-detail" aria-label="Adjust stock" onSubmit={event => { event.preventDefault(); void saveAdjust(); }}>
          <h2>Adjust stock: {adjust.name}</h2>
          <div className="counter-form-row">
            <FormField label="What happened">
              <select value={adjust.move} onChange={event => { const move = event.target.value as Move; setAdjust({ ...adjust, move, reason: MOVES[move].reason }); }}>
                {(Object.keys(MOVES) as Move[]).map(key => <option key={key} value={key}>{MOVES[key].label}</option>)}
              </select>
            </FormField>
            <FormField label="Quantity"><Input value={adjust.quantity} inputMode="decimal" onChange={event => setAdjust({ ...adjust, quantity: event.target.value })} /></FormField>
            <FormField label="Reason"><Input value={adjust.reason} maxLength={200} onChange={event => setAdjust({ ...adjust, reason: event.target.value })} /></FormField>
          </div>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save stock change'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setAdjust(null)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="counter-panel counter-table-wrap">
        {items === null ? null : items.length === 0 ? <EmptyState>No items yet. Add the supplies you want to keep an eye on.</EmptyState> : (
          <table className="counter-table">
            <thead><tr><th>Item</th><th className="num">In stock</th><th className="num">Warn at</th><th className="num">Cost per unit</th><th><span className="counter-visually-hidden">Actions</span></th></tr></thead>
            <tbody>{items.map(item => (
              <tr key={item.id}>
                <td>{item.name}{item.notes && <small className="counter-cell-note">{item.notes}</small>}</td>
                <td className="num">{item.currentQuantity} {item.unit}{item.lowStock && <> <span className="counter-badge bad">Low stock</span></>}</td>
                <td className="num">{item.minimumQuantity > 0 ? `${item.minimumQuantity} ${item.unit}` : '—'}</td>
                <td className="num">{item.purchaseCostMinor === null ? '—' : money(item.purchaseCostMinor)}</td>
                <td>
                  <div className="counter-form-row">
                    <Button size="sm" variant="outline" onClick={() => startAdjust(item)}>Adjust stock</Button>
                    {isAdmin && <ConfirmDelete what={`item ${item.name} and its stock history`} onConfirm={reason => remove(item, reason)} />}
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
