import { describe, expect, it } from 'vitest';
import { createBillDocument, createTagDocument, documentLines, printableText, type BillDocument } from './printDocuments';

const bill: BillDocument = {
  orderNumber: 'SL-103', createdAtIst: '15 Oct 2026 10:30 IST', promisedAtIst: '17 Oct 2026 17:00 IST',
  customerName: 'Asha Patil', customerPhone: '9876543210',
  items: [{ garment: 'Kurta', service: 'Wash + Iron', quantity: 1, unitPriceMinor: 4500, lineTotalMinor: 4500 }],
  subtotalMinor: 4500, paidMinor: 1000, balanceMinor: 3500, physicalPieceCount: 1,
};

describe('native print document contracts', () => {
  it('creates deterministic bill content with exact persisted amounts, promise and count', () => {
    const document = { kind: 'bill' as const, document: createBillDocument(bill) };
    expect(documentLines(document)).toEqual([[
      'SMART LAUNDRY', 'Bill: SL-103', 'Date: 15 Oct 2026 10:30 IST', 'Customer: Asha Patil', 'Phone: 9876543210',
      'Kurta / Wash + Iron  x1', '  ₹45.00  ₹45.00', 'Pieces: 1', 'Subtotal: ₹45.00', 'Paid: ₹10.00',
      'Balance: ₹35.00', 'Ready by: 17 Oct 2026 17:00 IST', 'Thank you',
    ]]);
  });

  it('emits exactly one internal tag per physical piece and excludes personal or promise data', () => {
    const tags = createTagDocument('SL-103', [
      { pieceId: 'piece-001', garment: 'Kurta', service: 'Wash + Iron', position: 1, total: 2 },
      { pieceId: 'piece-002', garment: 'Shirt', service: 'Wash', position: 2, total: 2 },
    ]);
    const lines = documentLines({ kind: 'tags', document: tags });
    expect(lines).toEqual([
      ['Bill SL-103', 'Kurta / Wash + Iron', 'Piece piece-001 (1/2)'],
      ['Bill SL-103', 'Shirt / Wash', 'Piece piece-002 (2/2)'],
    ]);
    expect(Object.keys(tags)).toEqual(['orderNumber', 'pieces']);
    expect(JSON.stringify(tags).toLowerCase()).not.toMatch(/customer|phone|promise|due|barcode|qr/);
  });

  it('removes control characters before customer text reaches print output', () => {
    expect(printableText('Asha\u001b[2J\nPatil')).toBe('Asha [2J Patil');
    expect(() => createBillDocument({ ...bill, customerName: '  \n ' })).toThrow('Customer name cannot be empty');
  });

  it('rejects non-whole quantities, mismatched physical count and non-sequential tags', () => {
    expect(() => createBillDocument({ ...bill, items: [{ ...bill.items[0], quantity: 1.5 }] })).toThrow('Quantity must be a positive whole number');
    expect(() => createBillDocument({ ...bill, physicalPieceCount: 2 })).toThrow('Bill quantities must equal the physical piece count');
    expect(() => createTagDocument('SL-103', [{ pieceId: 'p1', garment: 'Shirt', service: 'Wash', position: 2, total: 1 }])).toThrow('Piece positions must be sequential');
  });

  it('rejects unsafe or negative minor-unit money values', () => {
    expect(() => createBillDocument({ ...bill, paidMinor: -1 })).toThrow('Paid amount must be a non-negative integer');
    expect(() => createBillDocument({ ...bill, subtotalMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow('Subtotal must be a non-negative integer');
  });
});
