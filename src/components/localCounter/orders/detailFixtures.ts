import { vi } from 'vitest';
import type { CounterPayment, CounterPiece, CounterSavedOrder } from '@/lib/localFirst/counter';
import type { MoneyForm, OrderDetailPageProps } from './OrderDetailPage';

/** Test-only builders for the order detail screen. Every callback is a fresh `vi.fn()` that a test can assert on. */

export const detailPiece = (n: number, over: Partial<CounterPiece> = {}): CounterPiece => ({
  id: `p-${n}`, shortId: `2610170001-${n}`, garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron',
  position: n, total: 3, matched: false, packingMatched: false, collectionMatched: false, tagged: true, ...over,
});

export const detailPayment = (over: Partial<CounterPayment> = {}): CounterPayment => ({
  id: 'pay-1', at: '2026-10-15T06:00:00Z', method: 'cash', amountMinor: 1000, reference: null, kind: 'advance', voided: false, ...over,
});

export const detailOrder = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: '202610170001', customerName: 'Rita Mehta', customerPhone: '9876543210', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'ready', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, paymentStatus: 'unpaid', collectedAt: null,
  refundDueMinor: 0, payments: [], pieces: [detailPiece(1), detailPiece(2), detailPiece(3)], printJobs: [], ...over,
});

export const detailMoneyForm = (over: Partial<MoneyForm> = {}): MoneyForm => ({
  amount: '', onAmount: vi.fn(), partial: false, onPartial: vi.fn(), method: 'cash', onMethod: vi.fn(),
  reference: '', onReference: vi.fn(), error: '', onReceive: vi.fn(), busy: false, ...over,
});

export const detailProps = (over: Partial<OrderDetailPageProps> = {}): OrderDetailPageProps => ({
  order: detailOrder(), customer: { name: 'Rita Mehta', phone: '9876543210' }, isAdmin: true, busy: false,
  backLabel: 'Orders', onBack: vi.fn(), onMoveStage: vi.fn(), onHandover: vi.fn(), money: detailMoneyForm(),
  packingSlot: null, onCancel: vi.fn(), onTrash: vi.fn(), onRequestTrash: vi.fn(), onReprintBill: vi.fn(), onPreviewBill: vi.fn(), onReprintTags: vi.fn(), onOpenPrints: vi.fn(), ...over,
});
