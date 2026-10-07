import type {
  DiscountType,
  OrderItemInput,
  PaymentStatus,
} from './types';

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
}

const assertFinite = (label: string, value: number): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
};

const assertNonNegative = (label: string, value: number): void => {
  assertFinite(label, value);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
};

export const roundMoney = (value: number): number => {
  assertFinite('Money amount', value);
  const cents = Math.round((value + Number.EPSILON) * 100);
  const rounded = cents / 100;
  assertFinite('Rounded money amount', rounded);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Rounded money amount must have safe cent precision.');
  }
  return rounded;
};

export const calculateLineTotal = (item: Pick<OrderItemInput, 'service_type' | 'quantity' | 'weight_kg' | 'rate'>): number => {
  if (item.service_type !== 'piece' && item.service_type !== 'weight' && item.service_type !== 'combined') {
    throw new TypeError('Unsupported service type.');
  }

  const quantity = Number(item.quantity ?? 0);
  const weight = Number(item.weight_kg ?? 0);
  const rate = Number(item.rate);
  assertNonNegative('Quantity', quantity);
  assertNonNegative('Weight', weight);
  assertNonNegative('Rate', rate);

  if (item.service_type === 'weight') return roundMoney(weight * rate);
  if (item.service_type === 'combined') return roundMoney((quantity + weight) * rate);
  return roundMoney(quantity * rate);
};

export const calculateOrderTotals = (
  items: OrderItemInput[],
  discountType: DiscountType = 'fixed',
  discountValue = 0,
): OrderTotals => {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + calculateLineTotal(item), 0));
  if (discountType !== 'fixed' && discountType !== 'percentage') {
    throw new TypeError('Unsupported discount type.');
  }
  assertNonNegative('Discount amount', discountValue);
  const rawDiscount = discountType === 'percentage'
    ? subtotal * (Math.min(100, discountValue) / 100)
    : discountValue;
  const discountAmount = roundMoney(Math.min(subtotal, rawDiscount));

  return {
    subtotal,
    discountAmount,
    totalAmount: roundMoney(Math.max(0, subtotal - discountAmount)),
  };
};

export const getPaymentStatus = (totalAmount: number, paidAmount: number): PaymentStatus => {
  assertNonNegative('Order total', totalAmount);
  assertNonNegative('Paid amount', paidAmount);
  const total = roundMoney(totalAmount);
  const paid = roundMoney(paidAmount);

  if (paid > total) return 'overpaid';
  if (paid === total) return 'paid';
  if (paid <= 0) return 'unpaid';
  return 'partially_paid';
};

export const getOrderType = (items: Pick<OrderItemInput, 'service_type'>[]): 'piece' | 'weight' | 'combined' => {
  if (items.some(item => item.service_type !== 'piece' && item.service_type !== 'weight' && item.service_type !== 'combined')) {
    throw new TypeError('Unsupported service type.');
  }

  const hasPiece = items.some(item => item.service_type === 'piece' || item.service_type === 'combined');
  const hasWeight = items.some(item => item.service_type === 'weight' || item.service_type === 'combined');
  if (hasPiece && hasWeight) return 'combined';
  return hasWeight ? 'weight' : 'piece';
};

export const formatOrderNumber = (prefix: string, year: number, sequence: number): string => (
  `${prefix || 'LA'}-${year}-${String(sequence).padStart(5, '0')}`
);
