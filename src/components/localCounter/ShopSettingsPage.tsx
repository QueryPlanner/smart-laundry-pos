import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getShopSettings, normalizeOrderPrefix, saveShopSettings, SHOP_SETTINGS_LIMITS, shopSettingsProblem, type ShopSettings } from '@/lib/localFirst/shopSettings';
import { FormField, PageHeader } from './ui';
import type { SectionProps } from './sections';

const same = (a: ShopSettings, b: ShopSettings): boolean =>
  a.shopName === b.shopName && a.shopAddress === b.shopAddress && a.shopPhone === b.shopPhone
  && a.receiptFooter === b.receiptFooter && a.orderPrefix === b.orderPrefix
  && a.printShopNameOnBill === b.printShopNameOnBill && a.printShopAddress === b.printShopAddress
  && a.printShopPhone === b.printShopPhone && a.printCustomerPhone === b.printCustomerPhone
  && a.printReceivedAt === b.printReceivedAt && a.printReadyBy === b.printReadyBy
  && a.printShopNameOnTags === b.printShopNameOnTags && a.tagLine === b.tagLine
  && a.tagLengthMm === b.tagLengthMm;

/** Admin-only shop identity, print content and tag feed length. */
export const ShopSettingsPage = ({ onError, onNotice }: SectionProps) => {
  const [saved, setSaved] = useState<ShopSettings | null>(null);
  const [form, setForm] = useState<ShopSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void getShopSettings().then(loaded => { if (live) { setSaved(loaded); setForm(loaded); } }).catch(onError);
    return () => { live = false; };
  }, [onError]);

  if (!form || !saved) return <section className="counter-page"><PageHeader title="Shop settings" /></section>;
  const change = <K extends keyof ShopSettings,>(key: K, value: ShopSettings[K]) => setForm(current => current ? ({ ...current, [key]: value }) : current);

  const save = async () => {
    const problem = shopSettingsProblem(form);
    if (problem) { onError(new Error(problem)); return; }
    setSaving(true);
    try {
      const stored = await saveShopSettings({ ...form, shopName: form.shopName.trim(), shopAddress: form.shopAddress.trim(), shopPhone: form.shopPhone.trim(), receiptFooter: form.receiptFooter.trim(), tagLine: form.tagLine.trim(), orderPrefix: normalizeOrderPrefix(form.orderPrefix) });
      setSaved(stored);
      setForm(stored);
      onNotice('Shop and print settings saved. New orders use them.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const phone = form.shopPhone.trim();
  return (
    <section className="counter-page">
      <PageHeader title="Shop settings" subtitle="Set your laundry name, choose what prints, and set the tag cut length." />
      <div className="counter-settings-grid">
        <form noValidate className="counter-panel counter-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <FormField label="Shop name"><Input value={form.shopName} maxLength={SHOP_SETTINGS_LIMITS.shopName} onChange={event => change('shopName', event.target.value)} /></FormField>
          <FormField label="Address" hint="Optional. Printed under the shop name."><Input value={form.shopAddress} maxLength={SHOP_SETTINGS_LIMITS.shopAddress} onChange={event => change('shopAddress', event.target.value)} /></FormField>
          <FormField label="Phone" hint="Optional. Any format, up to 20 characters."><Input value={form.shopPhone} maxLength={SHOP_SETTINGS_LIMITS.shopPhone} onChange={event => change('shopPhone', event.target.value)} /></FormField>
          <FormField label="Receipt footer" hint="Optional. The last line of the bill; blank prints a plain thank-you."><Input value={form.receiptFooter} maxLength={SHOP_SETTINGS_LIMITS.receiptFooter} onChange={event => change('receiptFooter', event.target.value)} /></FormField>
          <FormField label="Bill number prefix" hint="1 to 6 letters or digits, for example LA.">
            <Input value={form.orderPrefix} maxLength={SHOP_SETTINGS_LIMITS.orderPrefix} onChange={event => change('orderPrefix', event.target.value.toUpperCase())} />
          </FormField>
          <fieldset className="counter-print-options">
            <legend>Bill content</legend>
            <CheckOption label="Print laundry name" checked={form.printShopNameOnBill} onChange={checked => change('printShopNameOnBill', checked)} />
            <CheckOption label="Print shop address" checked={form.printShopAddress} onChange={checked => change('printShopAddress', checked)} />
            <CheckOption label="Print shop phone" checked={form.printShopPhone} onChange={checked => change('printShopPhone', checked)} />
            <CheckOption label="Print customer phone" checked={form.printCustomerPhone} onChange={checked => change('printCustomerPhone', checked)} />
            <CheckOption label="Print received date and time" checked={form.printReceivedAt} onChange={checked => change('printReceivedAt', checked)} />
            <CheckOption label="Print ready-by time" checked={form.printReadyBy} onChange={checked => change('printReadyBy', checked)} />
            <p className="counter-settings-note">Order number, customer name, garment details, prices and payment totals always stay on the bill.</p>
          </fieldset>
          <fieldset className="counter-print-options">
            <legend>TSC tag content</legend>
            <CheckOption label="Print laundry name on tags" checked={form.printShopNameOnTags} onChange={checked => change('printShopNameOnTags', checked)} />
            <FormField label="Optional tag line" hint="Up to 40 characters. No customer name or date is printed on tags.">
              <Input value={form.tagLine} maxLength={SHOP_SETTINGS_LIMITS.tagLine} onChange={event => change('tagLine', event.target.value)} />
            </FormField>
            <FormField label="Tag cut length (mm)" hint="50 mm-wide continuous roll; each tag feeds this length, including a blank cut band.">
              <Input type="number" min={SHOP_SETTINGS_LIMITS.minTagLengthMm} max={SHOP_SETTINGS_LIMITS.maxTagLengthMm} step="0.1" value={form.tagLengthMm} onChange={event => change('tagLengthMm', event.target.value === '' ? Number.NaN : Number(event.target.value))} />
            </FormField>
            <p className="counter-settings-note">Bill number, garment, service, piece count and internal piece ID always stay on the tag. Barcode and customer details are not used.</p>
          </fieldset>
          <p className="counter-settings-note">Changing the bill prefix affects new orders only. Print settings are saved with new jobs; existing orders keep their original print content and reprint layout.</p>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving || same(form, saved)}>{saving ? 'Saving...' : 'Save settings'}</Button>
            <Button type="button" variant="outline" disabled={saving || same(form, saved)} onClick={() => setForm(saved)}>Discard changes</Button>
          </div>
        </form>
        <aside className="counter-panel counter-settings-preview" aria-label="Bill header preview">
          <span className="counter-section-label">Bill preview</span>
          {form.printShopNameOnBill && <strong>{form.shopName.trim() || 'SMART LAUNDRY'}</strong>}
          {form.printShopAddress && form.shopAddress.trim() && <span>{form.shopAddress.trim()}</span>}
          {form.printShopPhone && phone && <span>Tel: {phone}</span>}
          <span className="counter-settings-sample">Bill: {normalizeOrderPrefix(form.orderPrefix) || 'LA'}-2026-00001</span>
          <span>Customer: Asha Patil</span>
          {form.printCustomerPhone && <span>Phone: 98765 43210</span>}
          {form.printReceivedAt && <span>Received: 16 Oct 2026</span>}
          <span>Shirt · Wash + Iron · 2 × ₹25</span>
          <span className="counter-settings-sample">Subtotal · Total · Paid</span>
          {form.printReadyBy && <span>Ready by: 18 Oct 2026, 5:00 PM</span>}
          <em>{form.receiptFooter.trim() || 'Thank you'}</em>
          <span className="counter-section-label counter-tag-preview-label">TSC tag preview · 50 mm wide × {Number.isFinite(form.tagLengthMm) ? form.tagLengthMm.toFixed(1) : '—'} mm</span>
          <div className="counter-settings-tag-preview">
            {form.printShopNameOnTags && <strong>{form.shopName.trim() || 'SMART LAUNDRY'}</strong>}
            <span>Bill LA-2026-00001</span><span>Shirt · Wash + Iron</span><span>Piece 3/4</span><span>ID 2600123-3</span>
            {form.tagLine.trim() && <em>{form.tagLine.trim()}</em>}
            <small>Blank area reserved below for cutting</small>
          </div>
          <small>Saved bills and tags keep their original settings so reprints match the first print.</small>
        </aside>
      </div>
    </section>
  );
};

const CheckOption = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) => (
  <label className="counter-print-option"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>
);
