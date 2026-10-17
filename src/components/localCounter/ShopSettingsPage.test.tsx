// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShopSettingsPage } from './ShopSettingsPage';
import type { CounterAccount } from '@/lib/localFirst/counter';
import type { ShopSettings } from '@/lib/localFirst/shopSettings';

const api = vi.hoisted(() => ({ getShopSettings: vi.fn(), saveShopSettings: vi.fn() }));
vi.mock('@/lib/localFirst/shopSettings', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/localFirst/shopSettings')>()), ...api }));

const admin: CounterAccount = { id: 'a1', fullName: 'Owner', role: 'admin', active: true };
// orderPrefix is the retired, stored-only value: the page must send it back unchanged.
const stored: ShopSettings = {
  shopName: 'Sunrise Cleaners', shopAddress: '12 MG Road', shopPhone: '020 5550 1234', receiptFooter: 'Visit again', receiptMessage: 'Your clothes, ready on time', orderPrefix: 'LA',
  printShopNameOnBill: true, printShopAddress: true, printShopPhone: true, printCustomerPhone: true, printReceivedAt: true, printReadyBy: true,
  printShopNameOnTags: false, tagLine: '', tagLengthMm: 30,
};

const setup = () => {
  const onError = vi.fn(); const onNotice = vi.fn(); const onOpenOrder = vi.fn();
  render(<ShopSettingsPage account={admin} onError={onError} onNotice={onNotice} onOpenOrder={onOpenOrder} />);
  return { onError, onNotice };
};
// A field's hint sits inside its label, so match on the start of the label text.
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const tagPreview = (): HTMLElement => screen.getByLabelText('Bill header preview').querySelector('.counter-settings-tag-preview') as HTMLElement;

// The footer as printed on the bill preview; the form's textarea holds the same words, so search inside the preview.
const previewFooter = (): HTMLElement => screen.getByLabelText('Bill header preview').querySelector('em') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.getShopSettings.mockResolvedValue(stored);
  api.saveShopSettings.mockImplementation(async (settings: unknown) => settings);
});
afterEach(cleanup);

describe('ShopSettingsPage', () => {
  it('shows only the editable shop settings, none of the retired ones', async () => {
    setup();
    await waitFor(() => expect(field('Shop name').value).toBe('Sunrise Cleaners'));
    expect(field('Address').value).toBe('12 MG Road');
    expect(field('Phone').value).toBe('020 5550 1234');
    expect(field('Bill footer / terms').value).toBe('Visit again');
    expect(field('Message line').value).toBe('Your clothes, ready on time');
    expect(screen.queryByLabelText(/^Bill number prefix/)).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Print laundry name' }) as HTMLInputElement).checked).toBe(true);
    expect(field('Tag cut length').value).toBe('30');
    expect(screen.getByText(/TSC tag preview/).textContent).toContain('30.0 mm');
    for (const retired of [/GST/i, /receipt width/i, /completion days/i, /bill number prefix/i]) expect(screen.queryByText(retired)).toBeNull();
    expect(screen.getByText(/Print settings are saved with new jobs/)).toBeTruthy();
    expect(screen.getByText(/Printed on every tag/)).toBeTruthy();
    expect(screen.getByText(/Customer name and phone, bill number, garment, service, piece count and internal piece ID always print on the tag/)).toBeTruthy();
  });

  it('renders an empty page header until the settings load, and reports a load failure', async () => {
    api.getShopSettings.mockRejectedValue(new Error('boom'));
    const { onError } = setup();
    expect(screen.getByRole('heading', { name: 'Shop settings' })).toBeTruthy();
    expect(screen.queryByLabelText(/^Shop name/)).toBeNull();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' })));
  });

  it('does not touch state when it unmounts before the settings arrive', async () => {
    let finish: (value: typeof stored) => void = () => undefined;
    api.getShopSettings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onError = vi.fn();
    const view = render(<ShopSettingsPage account={admin} onError={onError} onNotice={vi.fn()} onOpenOrder={vi.fn()} />);
    view.unmount();
    finish(stored);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps Save disabled until something changes and can discard edits', async () => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    const saveButton = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement;
    const discard = screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
    type('Shop name', 'Moonrise');
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(discard);
    expect(field('Shop name').value).toBe('Sunrise Cleaners');
    expect(saveButton.disabled).toBe(true);
    for (const [label, value] of [['Address', 'x'], ['Phone', '1'], ['Bill footer / terms', 'y'], ['Message line', 'z']] as const) {
      type(label, value);
      expect(saveButton.disabled).toBe(false);
      fireEvent.click(discard);
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Print ready-by time' }));
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(discard);
    expect((screen.getByRole('checkbox', { name: 'Print ready-by time' }) as HTMLInputElement).checked).toBe(true);
  });

  it('saves trimmed values, passes the stored prefix through unchanged, and confirms', async () => {
    const { onNotice, onError } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Shop name', '  Moonrise Wash  ');
    type('Address', ' 5 Hill Rd ');
    type('Phone', ' 99 ');
    type('Bill footer / terms', ' See you ');
    type('Message line', '  Ready when you are  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.saveShopSettings).toHaveBeenCalledWith({ ...stored, shopName: 'Moonrise Wash', shopAddress: '5 Hill Rd', shopPhone: '99', receiptFooter: 'See you', receiptMessage: 'Ready when you are', orderPrefix: 'LA' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Shop and print settings saved. New orders use them.'));
    expect(onError).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
    expect(field('Shop name').value).toBe('Moonrise Wash');
  });

  it('disables both buttons and shows Saving... while a save is pending', async () => {
    let finish: (value: ShopSettings) => void = () => undefined;
    api.saveShopSettings.mockReturnValue(new Promise<ShopSettings>(resolve => { finish = resolve; }));
    const { onNotice } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Shop name', 'Moonrise');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const saving = await screen.findByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true);
    finish({ ...stored, shopName: 'Moonrise' });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Shop and print settings saved. New orders use them.'));
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses an invalid form before calling the native command', async () => {
    const { onError } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Shop name', '  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Enter the shop name.' }));
    expect(api.saveShopSettings).not.toHaveBeenCalled();
  });

  it('validates the tag cut length and previews configurable tag branding', async () => {
    const { onError } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Optional tag line', 'Keep together');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Print laundry name on tags' }));
    type('Tag cut length', '201');
    expect(screen.getByLabelText('Bill header preview').textContent).toContain('Sunrise Cleaners');
    expect(screen.getByLabelText('Bill header preview').textContent).toContain('Keep together');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tag cut length must be between 30 and 200 mm.' }));
    expect(api.saveShopSettings).not.toHaveBeenCalled();
  });

  it('shows a dash for a cleared tag cut length and refuses to save it', async () => {
    const { onError } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Tag cut length', '');
    expect(field('Tag cut length').value).toBe('');
    expect(screen.getByText(/TSC tag preview/).textContent).toContain('× — mm');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Tag cut length must be between 30 and 200 mm.' }));
    expect(api.saveShopSettings).not.toHaveBeenCalled();
  });

  it('falls back to SMART LAUNDRY on the tag when the laundry name is blank', async () => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Print laundry name on tags' }));
    expect(tagPreview().querySelector('strong')?.textContent).toBe('Sunrise Cleaners');
    type('Shop name', '  ');
    expect(tagPreview().querySelector('strong')?.textContent).toBe('SMART LAUNDRY');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Print laundry name on tags' }));
    expect(tagPreview().querySelector('strong')).toBeNull();
  });

  it('always previews the customer name and phone on the tag, in order', async () => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    const lines = Array.from(tagPreview().querySelectorAll('span')).map(line => line.textContent);
    expect(lines).toEqual(['Bill 202610170001', 'Rita Joshi', '98765 43210', 'Shirt · Wash + Iron', 'Piece 3/4', 'ID 2610170001-3']);
  });

  it.each([
    ['Print laundry name', 'Sunrise Cleaners'],
    ['Print shop address', '12 MG Road'],
    ['Print shop phone', 'Tel: 020 5550 1234'],
    ['Print customer phone', 'Phone: 98765 43210'],
    ['Print received date and time', 'Received: 16 Oct 2026'],
    ['Print ready-by time', 'Ready by: 18 Oct 2026'],
  ])('toggling "%s" hides and restores its bill preview line', async (option, line) => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    const checkbox = screen.getByRole('checkbox', { name: option });
    expect(screen.getByLabelText('Bill header preview').textContent).toContain(line);
    fireEvent.click(checkbox);
    expect(screen.getByLabelText('Bill header preview').textContent).not.toContain(line);
    fireEvent.click(checkbox);
    expect(screen.getByLabelText('Bill header preview').textContent).toContain(line);
  });

  it('keeps the fixed terms line as the last bill line after the footer', async () => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    const footer = previewFooter();
    expect(footer.nextElementSibling?.textContent).toBe('* terms and conditions apply');
    expect(footer.nextElementSibling?.nextElementSibling?.textContent).toMatch(/TSC tag preview/);
  });

  it('keeps the fixed terms line last when the footer is changed or left empty', async () => {
    setup();
    await screen.findByLabelText(/^Shop name/);
    type('Bill footer / terms', 'Pay on pickup');
    const changed = previewFooter();
    expect(changed.textContent).toBe('Pay on pickup');
    expect(changed.nextElementSibling?.textContent).toBe('* terms and conditions apply');
    type('Bill footer / terms', '');
    const empty = previewFooter();
    expect(empty.textContent).toBe('Thank you');
    expect(empty.nextElementSibling?.textContent).toBe('* terms and conditions apply');
    expect(empty.nextElementSibling?.nextElementSibling?.textContent).toMatch(/TSC tag preview/);
  });

  it('surfaces a refused save and keeps the edits', async () => {
    api.saveShopSettings.mockRejectedValue(new Error('Administrator access is required'));
    const { onError, onNotice } = setup();
    await screen.findByLabelText(/^Shop name/);
    type('Shop name', 'Moonrise');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Administrator access is required' })));
    expect(onNotice).not.toHaveBeenCalled();
    expect(field('Shop name').value).toBe('Moonrise');
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('previews the bill header, leaving out empty lines and falling back to the defaults', async () => {
    setup();
    const preview = await screen.findByLabelText('Bill header preview');
    expect(preview.textContent).toContain('Sunrise Cleaners');
    expect(preview.textContent).toContain('12 MG Road');
    expect(preview.textContent).toContain('Tel: 020 5550 1234');
    expect(preview.textContent).toContain('Bill: 202610170001');
    expect(preview.textContent).toContain('Visit again');
    type('Shop name', ' ');
    type('Address', '');
    type('Phone', '');
    type('Bill footer / terms', '');
    type('Message line', '');
    expect(preview.textContent).toContain('SMART LAUNDRY');
    expect(preview.textContent).not.toContain('Tel:');
    expect(preview.textContent).not.toContain('12 MG Road');
    expect(preview.textContent).toContain('Bill: 202610170001');
    expect(preview.textContent).toContain('Thank you');
  });
});
