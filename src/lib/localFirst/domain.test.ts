import { describe, expect, it } from 'vitest';
import { calculateLineTotal, calculateOrderTotals, formatOrderNumber, getOrderType, getPaymentStatus, roundMoney } from './domain';

describe('local laundry pricing rules', () => {
  it('calculates piece, weight, and combined line totals', () => {
    expect(calculateLineTotal({ service_type: 'piece', quantity: 3, weight_kg: 0, rate: 40 })).toBe(120);
    expect(calculateLineTotal({ service_type: 'weight', quantity: 0, weight_kg: 8, rate: 80 })).toBe(640);
    expect(calculateLineTotal({ service_type: 'combined', quantity: 2, weight_kg: 1.5, rate: 50 })).toBe(175);
  });

  it('allows zero quantities in draft previews for every service type', () => {
    expect(calculateLineTotal({ service_type: 'piece', quantity: 0, weight_kg: 0, rate: 40 })).toBe(0);
    expect(calculateLineTotal({ service_type: 'weight', quantity: 0, weight_kg: 0, rate: 40 })).toBe(0);
    expect(calculateLineTotal({ service_type: 'combined', quantity: 0, weight_kg: 0, rate: 40 })).toBe(0);
  });

  it('treats absent draft quantities and weights as zero', () => {
    expect(calculateLineTotal({
      service_type: 'piece',
      quantity: undefined as never,
      weight_kg: null as never,
      rate: 20,
    })).toBe(0);
  });

  it('allows a zero rate for free services', () => {
    expect(calculateLineTotal({ service_type: 'piece', quantity: 3, weight_kg: 0, rate: 0 })).toBe(0);
  });

  it('rejects non-finite or negative quantities, weights, and rates', () => {
    const validItem = { service_type: 'piece' as const, quantity: 1, weight_kg: 0, rate: 40 };

    expect(() => calculateLineTotal({ ...validItem, quantity: Number.NaN })).toThrow(RangeError);
    expect(() => calculateLineTotal({ ...validItem, quantity: -1 })).toThrow(RangeError);
    expect(() => calculateLineTotal({ ...validItem, weight_kg: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => calculateLineTotal({ ...validItem, weight_kg: -0.1 })).toThrow(RangeError);
    expect(() => calculateLineTotal({ ...validItem, rate: Number.NEGATIVE_INFINITY })).toThrow(RangeError);
    expect(() => calculateLineTotal({ ...validItem, rate: -1 })).toThrow(RangeError);
  });

  it('rejects unsupported service types instead of treating them as piece pricing', () => {
    const malformedItem = {
      service_type: 'bundle' as never,
      quantity: 2,
      weight_kg: 0,
      rate: 40,
    };

    expect(() => calculateLineTotal(malformedItem)).toThrow('Unsupported service type.');
    expect(() => getOrderType([{ service_type: 'bundle' as never }])).toThrow('Unsupported service type.');
  });

  it('caps discounts at the subtotal', () => {
    const totals = calculateOrderTotals([
      { item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 2, weight_kg: 0, rate: 50 },
    ], 'fixed', 200);

    expect(totals.subtotal).toBe(100);
    expect(totals.discountAmount).toBe(100);
    expect(totals.totalAmount).toBe(0);
  });

  it('keeps percentage discounts capped at the subtotal', () => {
    const totals = calculateOrderTotals([
      { item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 2, weight_kg: 0, rate: 50 },
    ], 'percentage', 125);

    expect(totals).toEqual({ subtotal: 100, discountAmount: 100, totalAmount: 0 });
  });

  it('rejects invalid discounts and totals before they can be persisted', () => {
    const item = { item_name: 'Shirt', service_name: 'Wash', service_type: 'piece' as const, quantity: 1, weight_kg: 0, rate: 50 };

    expect(() => calculateOrderTotals([item], 'fixed', Number.NaN)).toThrow(RangeError);
    expect(() => calculateOrderTotals([item], 'fixed', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => calculateOrderTotals([item], 'fixed', -1)).toThrow(RangeError);
    expect(() => calculateOrderTotals([item], 'other' as never, 0)).toThrow('Unsupported discount type.');
    expect(() => calculateLineTotal({ service_type: 'piece', quantity: 1, weight_kg: 0, rate: Number.MAX_VALUE })).toThrow(RangeError);
  });

  it('rounds finite money values and rejects non-finite or unrepresentable results', () => {
    expect(roundMoney(12.345)).toBe(12.35);
    expect(roundMoney(-12.346)).toBe(-12.35);
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => roundMoney(Number.MAX_VALUE)).toThrow(RangeError);
  });

  it('accepts the safe-cent boundary and rejects the next cent value', () => {
    const largestSafeCentAmount = Number.MAX_SAFE_INTEGER / 100;

    expect(roundMoney(largestSafeCentAmount)).toBe(largestSafeCentAmount);
    expect(() => roundMoney((Number.MAX_SAFE_INTEGER + 1) / 100)).toThrow('safe cent precision');
  });

  it('rejects finite line products with unsafe cents and arithmetic overflow', () => {
    expect(() => calculateLineTotal({
      service_type: 'piece', quantity: 1e18, weight_kg: 0, rate: 100,
    })).toThrow('safe cent precision');
    expect(() => calculateLineTotal({
      service_type: 'piece', quantity: Number.MAX_VALUE, weight_kg: 0, rate: 2,
    })).toThrow('Money amount must be a finite number.');
  });

  it('calculates percentage discounts and order types', () => {
    const totals = calculateOrderTotals([
      { item_name: 'Laundry', service_name: 'Wash', service_type: 'weight', quantity: 0, weight_kg: 10, rate: 80 },
    ], 'percentage', 12.5);

    expect(totals).toEqual({ subtotal: 800, discountAmount: 100, totalAmount: 700 });
    expect(getOrderType([{ service_type: 'piece' }])).toBe('piece');
    expect(getOrderType([{ service_type: 'weight' }])).toBe('weight');
    expect(getOrderType([{ service_type: 'piece' }, { service_type: 'weight' }])).toBe('combined');
    expect(getOrderType([])).toBe('piece');
  });

  it('derives payment status from the ledger total', () => {
    expect(getPaymentStatus(800, 0)).toBe('unpaid');
    expect(getPaymentStatus(800, 300)).toBe('partially_paid');
    expect(getPaymentStatus(800, 800)).toBe('paid');
    expect(getPaymentStatus(800, 900)).toBe('overpaid');
  });

  it('marks a zero-total order paid at zero and overpaid after a positive payment', () => {
    expect(getPaymentStatus(0, 0)).toBe('paid');
    expect(getPaymentStatus(0, 1)).toBe('overpaid');
  });

  it('rejects non-finite and negative totals or payment amounts', () => {
    expect(() => getPaymentStatus(Number.NaN, 0)).toThrow(RangeError);
    expect(() => getPaymentStatus(100, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => getPaymentStatus(-1, 0)).toThrow(RangeError);
    expect(() => getPaymentStatus(100, -1)).toThrow(RangeError);
  });

  it('formats a stable human-readable order number', () => {
    expect(formatOrderNumber('LA', 2026, 125)).toBe('LA-2026-00125');
    expect(formatOrderNumber('', 2026, 1)).toBe('LA-2026-00001');
  });
});
