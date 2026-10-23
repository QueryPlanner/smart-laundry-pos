import { describe, expect, it } from 'vitest';
import { DISCOUNT_NOT_AMOUNT, DISCOUNT_PERCENTS, discountMinorOf, discountProblem, percentOff } from './manualDiscount';

describe('discountProblem and discountMinorOf', () => {
  it.each([['', 0], ['0', 0], ['50', 5000], [' 50.5 ', 5050], ['12.34', 1234]])('reads "%s" as %d paise with no problem', (text, minor) => {
    expect(discountProblem(text)).toBeNull();
    expect(discountMinorOf(text)).toBe(minor);
  });

  it.each(['abc', '-5', '5.123', '1,000', '₹50'])('refuses "%s" and counts it as nothing', text => {
    expect(discountProblem(text)).toBe(DISCOUNT_NOT_AMOUNT);
    expect(discountMinorOf(text)).toBe(0);
  });
});

describe('percentOff', () => {
  it('takes a percentage of the subtotal, rounded half up', () => {
    expect(percentOff(10000, 10, 10000)).toBe(1000);
    expect(percentOff(3998, 25, 3998)).toBe(1000);
    expect(percentOff(1001, 5, 1001)).toBe(50);
    expect(percentOff(1010, 5, 1010)).toBe(51);
    expect(percentOff(0, 10, 0)).toBe(0);
  });

  it('never takes more than what is still owed', () => {
    expect(percentOff(10000, 20, 1500)).toBe(1500);
  });

  it('offers 5, 10 and 20 percent', () => {
    expect([...DISCOUNT_PERCENTS]).toEqual([5, 10, 20]);
  });
});
