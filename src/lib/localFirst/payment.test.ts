import { describe, expect, it } from 'vitest';
import { ADVANCE_ABOVE_TOTAL, ADVANCE_NOT_AMOUNT, advanceProblem, halfOf, parsePaymentAmountMinor, rupeesText } from './payment';

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

describe('halfOf', () => {
  it('takes the floor of half the total, in paise', () => {
    expect(halfOf(0)).toBe(0);
    expect(halfOf(1)).toBe(0);
    expect(halfOf(1200)).toBe(600);
    expect(halfOf(1201)).toBe(600);
    expect(halfOf(999_999)).toBe(499_999);
  });
});

describe('rupeesText', () => {
  it('formats paise as a plain rupee string with two decimals and no currency symbol', () => {
    expect(rupeesText(0)).toBe('0.00');
    expect(rupeesText(5)).toBe('0.05');
    expect(rupeesText(50)).toBe('0.50');
    expect(rupeesText(1200)).toBe('12.00');
    expect(rupeesText(24050)).toBe('240.50');
    expect(rupeesText(100_000)).toBe('1000.00');
  });

  it('round-trips through parsePaymentAmountMinor for every amount from 0.00 to 1,000.00', () => {
    for (let paise = 0; paise <= 100_000; paise += 1) {
      expect(parsePaymentAmountMinor(rupeesText(paise)), String(paise)).toBe(paise);
    }
  });

  it('stays exact for large amounts where float division would round', () => {
    expect(rupeesText(99_999_999_999_999)).toBe('999999999999.99');
    expect(rupeesText(Number.MAX_SAFE_INTEGER - 1)).toBe('90071992547409.90');
  });
});

describe('advanceProblem', () => {
  it('accepts an empty field, which means nothing paid now', () => {
    expect(advanceProblem('', 1200)).toBeNull();
    expect(advanceProblem('   ', 0)).toBeNull();
  });

  it('accepts an advance from nothing up to and including the whole total', () => {
    expect(advanceProblem('0', 1200)).toBeNull();
    expect(advanceProblem('0.50', 1200)).toBeNull();
    expect(advanceProblem('12', 1200)).toBeNull();
  });

  it('explains text that is not an amount: decimals beyond paise, letters and negatives', () => {
    for (const text of ['12.345', 'abc', '-5', '1,000', '₹5']) {
      expect(advanceProblem(text, 1200), text).toBe(ADVANCE_NOT_AMOUNT);
    }
  });

  it('refuses an advance above the total, including any advance when the total is zero', () => {
    expect(advanceProblem('12.01', 1200)).toBe(ADVANCE_ABOVE_TOTAL);
    expect(advanceProblem('0.01', 0)).toBe(ADVANCE_ABOVE_TOTAL);
  });
});
