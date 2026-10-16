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
  orderPrefix: string;
}

/** Mirrors the native limits so the form can warn early; the native command is the authority. */
export const SHOP_SETTINGS_LIMITS = { shopName: 60, shopAddress: 120, shopPhone: 20, receiptFooter: 120, orderPrefix: 6 } as const;

const PREFIX_PATTERN = /^[A-Z0-9]{1,6}$/;
const hasControlCharacter = (text: string): boolean => [...text].some(character => { const code = character.charCodeAt(0); return code < 0x20 || (code >= 0x7f && code <= 0x9f); });

/** The bill-number prefix as the native side will store it: trimmed and upper-cased. */
export const normalizeOrderPrefix = (value: string): string => value.trim().toUpperCase();

/** A plain-language problem with the form, or null when it can be sent. */
export const shopSettingsProblem = (settings: ShopSettings): string | null => {
  if (!settings.shopName.trim()) return 'Enter the shop name.';
  const labels = { shopName: 'Shop name', shopAddress: 'Address', shopPhone: 'Phone', receiptFooter: 'Receipt footer' } as const;
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const text = settings[key].trim();
    if (hasControlCharacter(text)) return `${labels[key]} cannot contain line breaks.`;
    if ([...text].length > SHOP_SETTINGS_LIMITS[key]) return `${labels[key]} must be ${SHOP_SETTINGS_LIMITS[key]} characters or fewer.`;
  }
  if (!PREFIX_PATTERN.test(normalizeOrderPrefix(settings.orderPrefix))) return 'The bill number prefix must be 1 to 6 letters or digits.';
  return null;
};

/** Any logged-in account: the counter prints these on every bill. */
export const getShopSettings = (): Promise<ShopSettings> => call('counter_get_shop_settings');
/** Admin only. Applies to bills of orders saved afterwards; saved bills and reprints keep what they were printed with. */
export const saveShopSettings = (settings: ShopSettings): Promise<ShopSettings> => call('counter_save_shop_settings', { settings });
