import { describe, expect, it } from 'vitest';
import { parsePaymentAmountMinor } from './payment';

describe('parsePaymentAmountMinor', () => {
  it('reads every paise amount from 0.00 to 1,000.00 exactly (no float rounding)', () => {
    for (let paise = 0; paise <= 100_000; paise += 1) {
      const text = `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
      expect(parsePaymentAmountMinor(text), text).toBe(paise);
    }
  });

  it('accepts whole rupees, one decimal, surrounding spaces and an empty field', () => {
    expect(parsePaymentAmountMinor('19.99')).toBe(1999);
    expect(parsePaymentAmountMinor('1.15')).toBe(115);
    expect(parsePaymentAmountMinor('15.5')).toBe(1550);
    expect(parsePaymentAmountMinor(' 40 ')).toBe(4000);
    expect(parsePaymentAmountMinor('007')).toBe(700);
    expect(parsePaymentAmountMinor('')).toBe(0);
    expect(parsePaymentAmountMinor('   ')).toBe(0);
  });

  it('rejects negative, non-numeric, exponent, extra-decimal, signed and oversized input', () => {
    for (const value of ['-1', '+1', 'NaN', 'Infinity', '1.001', '1e4', '.5', '5.', '1,000', '₹5', '1 2', '90071992547409.92', '1234567890123']) {
      expect(parsePaymentAmountMinor(value), value).toBeNull();
    }
  });

  it('keeps the largest accepted amount a safe integer', () => {
    expect(Number.isSafeInteger(parsePaymentAmountMinor('999999999999.99')!)).toBe(true);
  });
});
