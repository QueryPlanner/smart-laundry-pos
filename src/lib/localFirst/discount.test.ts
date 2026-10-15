import { describe, expect, it } from 'vitest';
import { formatPercentBp, parsePercentBp } from './discount';

describe('discount percentages', () => {
  it('parses percentages into basis points', () => {
    expect(parsePercentBp('0')).toBe(0);
    expect(parsePercentBp('10')).toBe(1000);
    expect(parsePercentBp('12.5')).toBe(1250);
    expect(parsePercentBp('0.05')).toBe(5);
    expect(parsePercentBp(' 100 ')).toBe(10_000);
    expect(parsePercentBp('100.00')).toBe(10_000);
  });

  it('rejects empty, negative, over 100, over-precise or non-numeric input', () => {
    for (const value of ['', ' ', '-5', '100.01', '101', '1000', '1.234', 'ten', '5%', '.5', '1e1']) {
      expect(parsePercentBp(value), value).toBeNull();
    }
  });

  it('formats basis points without trailing zeros and round-trips every value', () => {
    expect(formatPercentBp(1000)).toBe('10');
    expect(formatPercentBp(1250)).toBe('12.5');
    expect(formatPercentBp(5)).toBe('0.05');
    expect(formatPercentBp(0)).toBe('0');
    expect(formatPercentBp(10_000)).toBe('100');
    for (let bp = 0; bp <= 10_000; bp += 1) expect(parsePercentBp(formatPercentBp(bp)), String(bp)).toBe(bp);
  });
});
