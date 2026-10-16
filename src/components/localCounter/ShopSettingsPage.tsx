import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getShopSettings, normalizeOrderPrefix, saveShopSettings, SHOP_SETTINGS_LIMITS, shopSettingsProblem, type ShopSettings } from '@/lib/localFirst/shopSettings';
import { FormField, PageHeader } from './ui';
import type { SectionProps } from './sections';

const same = (a: ShopSettings, b: ShopSettings): boolean =>
  a.shopName === b.shopName && a.shopAddress === b.shopAddress && a.shopPhone === b.shopPhone
  && a.receiptFooter === b.receiptFooter && a.orderPrefix === b.orderPrefix;

/** Admin-only shop identity: what the bill shows at the top and bottom, and the bill-number prefix. */
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
  const change = (key: keyof ShopSettings, value: string) => setForm(current => ({ ...current, [key]: value }));

  const save = async () => {
    const problem = shopSettingsProblem(form);
    if (problem) { onError(new Error(problem)); return; }
    setSaving(true);
    try {
      const stored = await saveShopSettings({ ...form, shopName: form.shopName.trim(), shopAddress: form.shopAddress.trim(), shopPhone: form.shopPhone.trim(), receiptFooter: form.receiptFooter.trim(), orderPrefix: normalizeOrderPrefix(form.orderPrefix) });
      setSaved(stored);
      setForm(stored);
      onNotice('Shop settings saved. New bills use them.');
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const phone = form.shopPhone.trim();
  return (
    <section className="counter-page">
      <PageHeader title="Shop settings" subtitle="What every new bill shows, and how bill numbers start." />
      <div className="counter-settings-grid">
        <form className="counter-panel counter-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <FormField label="Shop name"><Input value={form.shopName} maxLength={SHOP_SETTINGS_LIMITS.shopName} onChange={event => change('shopName', event.target.value)} /></FormField>
          <FormField label="Address" hint="Optional. Printed under the shop name."><Input value={form.shopAddress} maxLength={SHOP_SETTINGS_LIMITS.shopAddress} onChange={event => change('shopAddress', event.target.value)} /></FormField>
          <FormField label="Phone" hint="Optional. Any format, up to 20 characters."><Input value={form.shopPhone} maxLength={SHOP_SETTINGS_LIMITS.shopPhone} onChange={event => change('shopPhone', event.target.value)} /></FormField>
          <FormField label="Receipt footer" hint="Optional. The last line of the bill; blank prints a plain thank-you."><Input value={form.receiptFooter} maxLength={SHOP_SETTINGS_LIMITS.receiptFooter} onChange={event => change('receiptFooter', event.target.value)} /></FormField>
          <FormField label="Bill number prefix" hint="1 to 6 letters or digits, for example LA.">
            <Input value={form.orderPrefix} maxLength={SHOP_SETTINGS_LIMITS.orderPrefix} onChange={event => change('orderPrefix', event.target.value.toUpperCase())} />
          </FormField>
          <p className="counter-settings-note">Changing the prefix affects new orders only. Saved bills keep their numbers, and the running number keeps counting up, so no bill number is ever repeated.</p>
          <div className="counter-form-row">
            <Button type="submit" disabled={saving || same(form, saved)}>{saving ? 'Saving...' : 'Save settings'}</Button>
            <Button type="button" variant="outline" disabled={saving || same(form, saved)} onClick={() => setForm(saved)}>Discard changes</Button>
          </div>
        </form>
        <aside className="counter-panel counter-settings-preview" aria-label="Bill header preview">
          <span className="counter-section-label">Bill preview</span>
          <strong>{form.shopName.trim() || 'SMART LAUNDRY'}</strong>
          {form.shopAddress.trim() && <span>{form.shopAddress.trim()}</span>}
          {phone && <span>Tel: {phone}</span>}
          <span className="counter-settings-sample">Bill: {normalizeOrderPrefix(form.orderPrefix) || 'LA'}-2026-00001</span>
          <span className="counter-settings-sample">Total, Paid, Balance ...</span>
          <em>{form.receiptFooter.trim() || 'Thank you'}</em>
          <small>A bill keeps the details it was saved with, so reprints always match the original.</small>
        </aside>
      </div>
    </section>
  );
};
