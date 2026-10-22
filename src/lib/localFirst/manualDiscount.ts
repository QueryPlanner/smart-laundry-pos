import { parsePaymentAmountMinor } from './payment';

/** The one-tap percentages beside the discount box. */
export const DISCOUNT_PERCENTS = [5, 10, 20] as const;

export const DISCOUNT_NOT_AMOUNT = 'Enter the discount as an amount such as 50 or 50.50.';

/** Why the typed discount cannot be used, or null when it can. An empty box means no discount. */
export const discountProblem = (text: string): string | null =>
  parsePaymentAmountMinor(text) === null ? DISCOUNT_NOT_AMOUNT : null;

/** The typed discount in paise, 0 when the box is empty or cannot be read (see `discountProblem`). */
export const discountMinorOf = (text: string): number => parsePaymentAmountMinor(text) ?? 0;

/**
 * Paise taken off for `percent` of the subtotal, rounded half up, but never more than `maxMinor`: what the
 * customer still owes before this discount, so a percentage can never push the total below zero.
 */
export const percentOff = (subtotalMinor: number, percent: number, maxMinor: number): number =>
  Math.min(Math.floor((subtotalMinor * percent + 50) / 100), maxMinor);
