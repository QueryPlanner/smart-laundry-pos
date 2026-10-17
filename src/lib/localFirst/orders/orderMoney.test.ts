import { describe, expect, it } from 'vitest';
import {
  STAGES,
  handoverBlockers,
  handoverCta,
  moneyState,
  moveableStages,
  nextStage,
  rowAction,
  rupees,
  skipsStages,
  stageLabel,
} from './orderMoney';

const order = (status: string, totalMinor: number, balanceMinor: number) => ({ status, totalMinor, balanceMinor });
const handover = (status: string, balanceMinor: number, checkedPieces: number, totalPieces = 3) =>
  ({ status, balanceMinor, totalPieces, checkedPieces });

describe('STAGES', () => {
  it('lists the processing stages from received to collected in order', () => {
    expect(STAGES).toEqual(['received', 'washing', 'drying', 'ironing', 'quality_check', 'packing', 'ready', 'collected']);
  });
});

describe('stageLabel', () => {
  it.each([
    ['received', 'Received'],
    ['washing', 'Washing'],
    ['drying', 'Drying'],
    ['ironing', 'Ironing'],
    ['quality_check', 'Quality check'],
    ['packing', 'Packing'],
    ['ready', 'Ready for pickup'],
    ['collected', 'Collected'],
    ['cancelled', 'Cancelled'],
  ])('labels %s as %s', (status, label) => {
    expect(stageLabel(status)).toBe(label);
  });

  it('only replaces underscores in unknown statuses', () => {
    expect(stageLabel('in_queue')).toBe('in queue');
    expect(stageLabel('Mystery Stage')).toBe('Mystery Stage');
  });

  it('does not treat object prototype names as known statuses', () => {
    expect(stageLabel('constructor')).toBe('constructor');
    expect(stageLabel('toString')).toBe('toString');
  });
});

describe('rupees', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [1200, '₹12.00'],
    [123456, '₹1,234.56'],
    [10000000, '₹1,00,000.00'],
    [100000000, '₹10,00,000.00'],
    [-500, '-₹5.00'],
  ])('formats %i paise as %s in Indian grouping', (minor, text) => {
    expect(rupees(minor)).toBe(text);
  });
});

describe('moneyState', () => {
  it.each([
    ['cancelled wins even with a balance', order('cancelled', 2400, 2400), 'cancelled'],
    ['cancelled wins over no charge', order('cancelled', 0, 0), 'cancelled'],
    ['zero total is no charge', order('ready', 0, 0), 'no_charge'],
    ['a balance above zero is balance due', order('washing', 2400, 1200), 'balance_due'],
    ['a fully paid order is paid', order('ready', 2400, 0), 'paid'],
    ['an overpaid order is paid, not balance due', order('ready', 2400, -300), 'paid'],
    ['a collected order is paid', order('collected', 2400, 0), 'paid'],
  ])('%s', (_name, input, state) => {
    expect(moneyState(input)).toBe(state);
  });
});

describe('moveableStages and nextStage', () => {
  it.each([
    ['received', ['washing', 'drying', 'ironing', 'quality_check', 'packing', 'ready']],
    ['washing', ['drying', 'ironing', 'quality_check', 'packing', 'ready']],
    ['ironing', ['quality_check', 'packing', 'ready']],
    ['quality_check', ['packing', 'ready']],
    ['packing', ['ready']],
  ])('from %s can move to every later stage up to ready', (status, stages) => {
    expect(moveableStages(status)).toEqual(stages);
    expect(nextStage(status)).toBe(stages[0]);
  });

  it.each(['ready', 'collected', 'cancelled', 'mystery_stage'])('%s has no stage to move to', status => {
    expect(moveableStages(status)).toEqual([]);
    expect(nextStage(status)).toBeNull();
  });
});

describe('skipsStages', () => {
  it.each([
    ['washing', 'ready', true],
    ['received', 'collected', true],
    ['washing', 'ironing', true],
    ['washing', 'drying', false],
    ['washing', 'washing', false],
    ['ready', 'washing', false],
    ['mystery_stage', 'ready', false],
    ['washing', 'mystery_stage', false],
  ])('from %s to %s is %s', (from, to, skips) => {
    expect(skipsStages(from, to)).toBe(skips);
  });
});

describe('rowAction', () => {
  it.each([
    ['a collected order is viewed', order('collected', 2400, 0), { kind: 'view', label: 'View' }],
    ['a cancelled order is viewed even with a balance', order('cancelled', 2400, 2400), { kind: 'view', label: 'View' }],
    ['ready with a balance receives and hands over', order('ready', 2400, 1000), { kind: 'receive_and_handover', label: 'Receive ₹10.00 & hand over' }],
    ['ready and paid hands over', order('ready', 2400, 0), { kind: 'handover', label: 'Hand over' }],
    ['ready and overpaid hands over', order('ready', 2400, -100), { kind: 'handover', label: 'Hand over' }],
    ['an order in process is opened', order('ironing', 2400, 2400), { kind: 'open', label: 'Open' }],
    ['an unknown status is opened', order('mystery_stage', 0, 0), { kind: 'open', label: 'Open' }],
  ])('%s', (_name, input, action) => {
    expect(rowAction(input)).toEqual(action);
  });
});

describe('handoverCta', () => {
  it.each([
    ['a collected order is done', handover('collected', 0, 3), { kind: 'done', label: 'Handed over', disabled: true }],
    ['a cancelled order cannot be handed over', handover('cancelled', 2400, 0), { kind: 'not_ready', label: 'Order is cancelled', disabled: true }],
    ['an order still ironing is not ready', handover('ironing', 0, 3), { kind: 'not_ready', label: 'Order is Ironing', disabled: true }],
    ['quality check is named in plain words', handover('quality_check', 0, 3), { kind: 'not_ready', label: 'Order is Quality check', disabled: true }],
    ['an unknown status is not ready', handover('in_queue', 0, 3), { kind: 'not_ready', label: 'Order is in queue', disabled: true }],
    ['a balance with garments left to check asks to receive', handover('ready', 2400, 1), { kind: 'receive', label: 'Receive ₹24.00', disabled: false }],
    ['a balance with every garment checked receives and hands over', handover('ready', 2400, 3), { kind: 'receive_and_handover', label: 'Receive ₹24.00 & hand over', disabled: false }],
    ['a balance with more checked than exist still receives and hands over', handover('ready', 2400, 5), { kind: 'receive_and_handover', label: 'Receive ₹24.00 & hand over', disabled: false }],
    ['no balance with two garments left asks to check them', handover('ready', 0, 1), { kind: 'check_more', label: 'Check 2 more garments', disabled: true }],
    ['no balance with one garment left uses the singular', handover('ready', 0, 2), { kind: 'check_more', label: 'Check 1 more garment', disabled: true }],
    ['overpaid with nothing checked still asks to check', handover('ready', -500, 0), { kind: 'check_more', label: 'Check 3 more garments', disabled: true }],
    ['no balance and every garment checked hands over', handover('ready', 0, 3), { kind: 'handover', label: 'Hand over order', disabled: false }],
    ['overpaid and fully checked hands over', handover('ready', -500, 3), { kind: 'handover', label: 'Hand over order', disabled: false }],
    ['an empty ready order with no balance hands over', handover('ready', 0, 0, 0), { kind: 'handover', label: 'Hand over order', disabled: false }],
    ['an empty ready order with a balance receives and hands over', handover('ready', 500, 0, 0), { kind: 'receive_and_handover', label: 'Receive ₹5.00 & hand over', disabled: false }],
    ['a large balance is grouped in rupees', handover('ready', 10000000, 3), { kind: 'receive_and_handover', label: 'Receive ₹1,00,000.00 & hand over', disabled: false }],
  ])('%s', (_name, input, cta) => {
    expect(handoverCta(input)).toEqual(cta);
  });
});

describe('handoverBlockers', () => {
  it.each([
    ['a collected order is already handed over', handover('collected', 0, 3), ['Already handed over']],
    ['a collected order ignores any leftover balance', handover('collected', 2400, 0), ['Already handed over']],
    ['a cancelled order is blocked by cancellation only', handover('cancelled', 2400, 0), ['Order is cancelled']],
    ['an order still ironing lists not ready, balance and unchecked', handover('ironing', 2400, 0), [
      'Order is Ironing, not ready yet',
      '₹24.00 still to receive',
      '3 garments not checked',
    ]],
    ['a ready order with one garment left lists it in the singular', handover('ready', 0, 2), ['1 garment not checked']],
    ['a ready order with a balance and every garment checked lists the balance', handover('ready', 2400, 3), ['₹24.00 still to receive']],
    ['a ready order with a balance and no garments checked lists both', handover('ready', 2400, 0), ['₹24.00 still to receive', '3 garments not checked']],
    ['an order still in quality check lists not ready with no money or checks left', handover('quality_check', 0, 3), ['Order is Quality check, not ready yet']],
    ['an overpaid, fully checked, ready order blocks nothing', handover('ready', -500, 3), []],
    ['a paid, fully checked, ready order blocks nothing', handover('ready', 0, 3), []],
    ['more checked than exist does not block', handover('ready', 0, 9), []],
    ['a large balance is grouped in rupees', handover('ready', 10000000, 3), ['₹1,00,000.00 still to receive']],
  ])('%s', (_name, input, blockers) => {
    expect(handoverBlockers(input)).toEqual(blockers);
  });
});
