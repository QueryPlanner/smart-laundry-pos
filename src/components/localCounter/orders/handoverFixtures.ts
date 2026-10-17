import type { CounterPiece, CounterSavedOrder } from '@/lib/localFirst/counter';

/** The `untaggedCounts` key of the untagged shirt-and-iron line in `checklistPieces`. */
export const UNTAGGED_SHIRT_IRON = 'g-shirt|Iron';

/** A piece with hand-over defaults: a tagged shirt, position 1 of 4. Override what a test needs. */
export const piece = (overrides: Partial<CounterPiece> & Pick<CounterPiece, 'id' | 'shortId'>): CounterPiece => ({
  garmentId: 'g-shirt', garment: 'Shirt', service: 'Wash + Iron', position: 1, total: 4,
  matched: false, packingMatched: false, collectionMatched: false, tagged: true,
  ...overrides,
});

/** Two tagged pieces (a shirt and a trouser) and two untagged shirts that are only ironed. Four pieces in all. */
export const checklistPieces = (): CounterPiece[] => [
  piece({ id: 'p1', shortId: '2610170001-1', position: 1 }),
  piece({ id: 'p2', shortId: '2610170001-2', position: 2, garmentId: 'g-trouser', garment: 'Trouser', service: 'Dry clean' }),
  piece({ id: 'u1', shortId: '2610170001-3', position: 3, service: 'Iron', tagged: false }),
  piece({ id: 'u2', shortId: '2610170001-4', position: 4, service: 'Iron', tagged: false }),
];

/** Every piece of `checklistPieces` ticked, the way a cashier leaves it before hand-over. */
export const allChecked = {
  checkedTaggedIds: ['p1', 'p2'],
  untaggedCounts: { [UNTAGGED_SHIRT_IRON]: 2 },
};

/** A ready order that is fully paid, with all four pieces. Override the status or money as needed. */
export const order = (overrides: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: '202610170001', customerName: 'Rita Joshi', customerPhone: '9876543210',
  receivedAt: '2026-10-17T09:00:00+05:30', promisedAt: '2026-10-17T17:00:00+05:30',
  status: 'ready', totalMinor: 4800, paidMinor: 4800, balanceMinor: 0,
  paymentStatus: 'paid', collectedAt: null, refundDueMinor: 0, payments: [],
  pieces: checklistPieces(), printJobs: [],
  ...overrides,
});

/** A ready order with a balance of ₹700.00 still to receive. */
export const owingOrder = (overrides: Partial<CounterSavedOrder> = {}): CounterSavedOrder =>
  order({ totalMinor: 70000, paidMinor: 0, balanceMinor: 70000, paymentStatus: 'unpaid', ...overrides });
