import { describe, expect, it } from 'vitest';
import type { CounterOrderLine } from '../counter';
import { finishesOrder, piecesGoing, pickupLabel, pickupState, remaining, rupees, suggestedPaymentMinor, waitingLineIds } from './pickup';

const line = (itemId: string, pieceCount: number, lineTotalMinor: number, handedOverCount = 0): CounterOrderLine => ({
  itemId, garment: 'Shirt', service: 'Iron', quantity: pieceCount, unitPriceMinor: lineTotalMinor / pieceCount, lineTotalMinor, pieceCount, handedOverCount,
});
// 3 shirts ironed (₹30) and 2 dry cleaned (₹200): ₹230 before any discount.
const iron = line('iron', 3, 3000);
const dry = line('dry', 2, 20000);

describe('rupees', () => {
  it('formats paise as Indian rupees', () => {
    expect(rupees(123456)).toBe('₹1,234.56');
  });
});

describe('pickupState', () => {
  it('reads cancelled and collected from the status, whatever the counts say', () => {
    expect(pickupState({ status: 'cancelled', pieceCount: 2, handedOverCount: 1 })).toBe('cancelled');
    expect(pickupState({ status: 'collected', pieceCount: 2, handedOverCount: 2 })).toBe('collected');
  });

  it('says part collected only when some, but not all, pieces have gone', () => {
    expect(pickupState({ status: 'received', pieceCount: 5, handedOverCount: 0 })).toBe('waiting');
    expect(pickupState({ status: 'received', pieceCount: 5, handedOverCount: 3 })).toBe('part');
    expect(pickupState({ status: 'ready', pieceCount: 5, handedOverCount: 5 })).toBe('waiting');
  });

  it('names every state in plain words', () => {
    expect(['waiting', 'part', 'collected', 'cancelled'].map(state => pickupLabel(state as never)))
      .toEqual(['Not collected', 'Part collected', 'Collected', 'Cancelled']);
  });
});

describe('lines still at the shop', () => {
  it('counts what is left of each line and never goes below zero', () => {
    expect(remaining(line('a', 3, 300, 1))).toBe(2);
    expect(remaining(line('a', 3, 300, 4))).toBe(0);
  });

  it('starts with every line that still has something to hand over', () => {
    expect(waitingLineIds([line('gone', 2, 200, 2), iron, dry])).toEqual(['iron', 'dry']);
  });

  it('counts the pieces leaving with the chosen lines and knows when they are the last', () => {
    const partly = line('dry', 2, 20000, 1);
    expect(piecesGoing([iron, partly], ['iron'])).toBe(3);
    expect(piecesGoing([iron, partly], ['dry'])).toBe(1);
    expect(finishesOrder([iron, partly], ['iron'])).toBe(false);
    expect(finishesOrder([iron, partly], ['iron', 'dry'])).toBe(true);
    expect(finishesOrder([line('gone', 1, 100, 1)], ['gone']), 'nothing leaves').toBe(false);
  });
});

describe('suggestedPaymentMinor', () => {
  const order = { totalMinor: 23000, balanceMinor: 23000, lines: [iron, dry] };

  it('asks for the share of the chosen lines', () => {
    expect(suggestedPaymentMinor(order, ['iron'])).toBe(3000);
  });

  it('spreads a discount over the lines in proportion', () => {
    // 10% off the whole bill: the ironing share is ₹27.
    expect(suggestedPaymentMinor({ ...order, totalMinor: 20700, balanceMinor: 20700 }, ['iron'])).toBe(2700);
  });

  it('counts only the pieces of a line that are still at the shop', () => {
    const half = { ...order, lines: [iron, line('dry', 2, 20000, 1)] };
    expect(suggestedPaymentMinor(half, ['dry'])).toBe(10000);
  });

  it('asks for the whole balance when the chosen lines are the last ones', () => {
    expect(suggestedPaymentMinor({ ...order, balanceMinor: 20000 }, ['iron', 'dry'])).toBe(20000);
  });

  it('never asks for more than the balance', () => {
    expect(suggestedPaymentMinor({ ...order, balanceMinor: 1000 }, ['iron'])).toBe(1000);
  });

  it('asks for nothing with nothing chosen, nothing owed, or a free bill', () => {
    expect(suggestedPaymentMinor(order, [])).toBe(0);
    expect(suggestedPaymentMinor({ ...order, balanceMinor: 0 }, ['iron'])).toBe(0);
    const free = { totalMinor: 0, balanceMinor: 100, lines: [line('a', 1, 0), line('b', 1, 0)] };
    expect(suggestedPaymentMinor(free, ['a'])).toBe(0);
    const pieceless = { totalMinor: 500, balanceMinor: 500, lines: [{ ...line('a', 1, 500), pieceCount: 0 }, line('b', 1, 500)] };
    expect(suggestedPaymentMinor(pieceless, ['a'])).toBe(0);
  });
});
