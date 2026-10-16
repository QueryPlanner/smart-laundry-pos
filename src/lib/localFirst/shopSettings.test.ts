import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => 'native-result'),
  isTauriRuntime: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));

import * as shop from './shopSettings';

const valid: shop.ShopSettings = {
  shopName: 'Sunrise', shopAddress: '12 MG Road', shopPhone: '020 5550 1234', receiptFooter: 'Thanks', receiptMessage: '', orderPrefix: 'sr',
  printShopNameOnBill: true, printShopAddress: true, printShopPhone: true, printCustomerPhone: true,
  printReceivedAt: true, printReadyBy: true, printShopNameOnTags: false, tagLine: '', tagLengthMm: 30,
};

/** [wrapper, native command, exact arguments sent]. Every exported function wrapper appears once. */
const table: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['getShopSettings', () => shop.getShopSettings(), 'counter_get_shop_settings', undefined],
  ['saveShopSettings', () => shop.saveShopSettings(valid), 'counter_save_shop_settings', { settings: valid }],
];

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe('shop settings wrappers', () => {
  it.each(table)('%s sends the exact native command and arguments', async (_name, run, command, args) => {
    await expect(run()).resolves.toBe('native-result');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => shop.getShopSettings()).toThrow('only in the Tauri runtime');
    expect(() => shop.saveShopSettings(valid)).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('shop settings form checks', () => {
  it('normalises the prefix like the native side', () => {
    expect(shop.normalizeOrderPrefix('  sr1 ')).toBe('SR1');
  });

  const cases: Array<[string, Partial<shop.ShopSettings>, string | null]> = [
    ['valid values', {}, null],
    ['limits are inclusive', { shopName: 'n'.repeat(60), shopAddress: 'a'.repeat(120), shopPhone: '1'.repeat(20), receiptFooter: 'f'.repeat(600), receiptMessage: 'm'.repeat(120), orderPrefix: 'ab12cd' }, null],
    ['blank name', { shopName: '  ' }, 'Enter the shop name.'],
    ['long name', { shopName: 'n'.repeat(61) }, 'Shop name must be 60 characters or fewer.'],
    ['long address', { shopAddress: 'a'.repeat(121) }, 'Address must be 120 characters or fewer.'],
    ['long phone', { shopPhone: '1'.repeat(21) }, 'Phone must be 20 characters or fewer.'],
    ['long footer', { receiptFooter: 'f'.repeat(601) }, 'Bill footer / terms must be 600 characters or fewer.'],
    ['multiline footer terms', { receiptFooter: 'Wash within 24 hours.\nUncollected items may be donated.' }, null],
    ['long message', { receiptMessage: 'm'.repeat(121) }, 'Message line must be 120 characters or fewer.'],
    ['message line break', { receiptMessage: 'a\nb' }, 'Message line cannot contain control characters.'],
    ['long tag line', { tagLine: 't'.repeat(41) }, 'Tag line must be 40 characters or fewer.'],
    ['name line break', { shopName: 'a\nb' }, 'Shop name cannot contain control characters.'],
    ['footer control character', { receiptFooter: 'a\u0007b' }, 'Bill footer / terms cannot contain control characters.'],
    ['blank prefix', { orderPrefix: ' ' }, 'The bill number prefix must be 1 to 6 letters or digits.'],
    ['long prefix', { orderPrefix: 'ABCDEFG' }, 'The bill number prefix must be 1 to 6 letters or digits.'],
    ['hyphen prefix', { orderPrefix: 'A-B' }, 'The bill number prefix must be 1 to 6 letters or digits.'],
  ];
  it.each(cases)('%s', (_name, patch, problem) => {
    expect(shop.shopSettingsProblem({ ...valid, ...patch })).toBe(problem);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(shop.shopSettingsProblem({ ...valid, shopName: '\u{1F9FA}'.repeat(60) })).toBeNull();
  });
});
