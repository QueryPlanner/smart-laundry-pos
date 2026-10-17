import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

/** The only shop settings the counter can read or change; the native side refuses any other key. */
export interface ShopSettings {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  receiptFooter: string;
  receiptMessage: string;
  /** Legacy: no longer edited or used in bill numbers. Kept so the stored value round-trips unchanged. */
  orderPrefix: string;
  printShopNameOnBill: boolean;
  printShopAddress: boolean;
  printShopPhone: boolean;
  printCustomerPhone: boolean;
  printReceivedAt: boolean;
  printReadyBy: boolean;
  printShopNameOnTags: boolean;
  tagLine: string;
  tagLengthMm: number;
}

/** Mirrors the native limits so the form can warn early; the native command is the authority. */
export const SHOP_SETTINGS_LIMITS = {
  shopName: 60, shopAddress: 120, shopPhone: 20, receiptFooter: 600, receiptMessage: 120,
  tagLine: 40, minTagLengthMm: 30, maxTagLengthMm: 200,
} as const;

const hasControlCharacter = (text: string): boolean => [...text].some(character => { const code = character.charCodeAt(0); return code < 0x20 || (code >= 0x7f && code <= 0x9f); });

/** A plain-language problem with the form, or null when it can be sent. */
export const shopSettingsProblem = (settings: ShopSettings): string | null => {
  if (!settings.shopName.trim()) return 'Enter the shop name.';
  const labels = { shopName: 'Shop name', shopAddress: 'Address', shopPhone: 'Phone', receiptFooter: 'Bill footer / terms', receiptMessage: 'Message line', tagLine: 'Tag line' } as const;
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const text = settings[key].trim();
    const withoutAllowedNewlines = key === 'receiptFooter' ? text.replace(/\n/g, '') : text;
    if (hasControlCharacter(withoutAllowedNewlines)) return `${labels[key]} cannot contain control characters.`;
    if ([...text].length > SHOP_SETTINGS_LIMITS[key]) return `${labels[key]} must be ${SHOP_SETTINGS_LIMITS[key]} characters or fewer.`;
  }
  if (!Number.isFinite(settings.tagLengthMm) || settings.tagLengthMm < SHOP_SETTINGS_LIMITS.minTagLengthMm || settings.tagLengthMm > SHOP_SETTINGS_LIMITS.maxTagLengthMm) return 'Tag cut length must be between 30 and 200 mm.';
  if (Math.abs(settings.tagLengthMm * 10 - Math.round(settings.tagLengthMm * 10)) > 0.001) return 'Tag cut length can have at most one decimal place.';
  return null;
};

/** Any logged-in account: the counter prints these on every bill. */
export const getShopSettings = (): Promise<ShopSettings> => call('counter_get_shop_settings');
/** Admin only. Applies to bills of orders saved afterwards; saved bills and reprints keep what they were printed with. */
export const saveShopSettings = (settings: ShopSettings): Promise<ShopSettings> => call('counter_save_shop_settings', { settings });
