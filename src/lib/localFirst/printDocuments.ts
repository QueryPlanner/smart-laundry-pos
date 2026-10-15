/** Typed, deterministic payloads passed to the native spool adapter. */
export interface BillItemDocument {
  garment: string;
  service: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface BillDocument {
  orderNumber: string;
  createdAtIst: string;
  promisedAtIst: string;
  customerName: string;
  customerPhone: string;
  items: BillItemDocument[];
  subtotalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  physicalPieceCount: number;
}

export interface TagPieceDocument {
  pieceId: string;
  garment: string;
  service: string;
  position: number;
  total: number;
}

export interface TagDocument {
  orderNumber: string;
  pieces: TagPieceDocument[];
}

export type PrintDocument =
  | { kind: 'bill'; document: BillDocument }
  | { kind: 'tags'; document: TagDocument };

export interface SubmitDocumentRequest {
  printerId: string;
  document: PrintDocument;
}

/** Keep only printable text characters so customer data cannot inject controls. */
export function printableText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : character;
  }).join('').replace(/\s+/gu, ' ').trim();
}

function requireText(value: string, label: string): string {
  const cleaned = printableText(value);
  if (!cleaned) throw new Error(label + ' cannot be empty');
  return cleaned;
}

function requireMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + ' must be a non-negative integer in minor units');
  return value;
}

/** Build the stable customer bill payload from persisted order snapshots. */
export function createBillDocument(input: BillDocument): BillDocument {
  const items = input.items.map((item) => ({
    garment: requireText(item.garment, 'Garment'),
    service: requireText(item.service, 'Service'),
    quantity: requirePositiveCount(item.quantity, 'Quantity'),
    unitPriceMinor: requireMinor(item.unitPriceMinor, 'Unit price'),
    lineTotalMinor: requireMinor(item.lineTotalMinor, 'Line total'),
  }));
  const physicalPieceCount = requirePositiveCount(input.physicalPieceCount, 'Physical piece count');
  if (items.reduce((sum, item) => sum + item.quantity, 0) !== physicalPieceCount) {
    throw new Error('Bill quantities must equal the physical piece count');
  }
  return {
    orderNumber: requireText(input.orderNumber, 'Order number'),
    createdAtIst: requireText(input.createdAtIst, 'Created time'),
    promisedAtIst: requireText(input.promisedAtIst, 'Promised time'),
    customerName: requireText(input.customerName, 'Customer name'),
    customerPhone: printableText(input.customerPhone),
    items,
    subtotalMinor: requireMinor(input.subtotalMinor, 'Subtotal'),
    paidMinor: requireMinor(input.paidMinor, 'Paid amount'),
    balanceMinor: requireMinor(input.balanceMinor, 'Balance'),
    physicalPieceCount,
  };
}

/** Build one tag for each persisted physical piece, in stable order. */
export function createTagDocument(orderNumber: string, pieces: readonly TagPieceDocument[]): TagDocument {
  if (pieces.length === 0) throw new Error('At least one physical piece is required');
  const total = pieces.length;
  return {
    orderNumber: requireText(orderNumber, 'Order number'),
    pieces: pieces.map((piece, index) => {
      if (piece.position !== index + 1 || piece.total !== total) {
        throw new Error('Piece positions must be sequential and match the tag total');
      }
      return {
        pieceId: requireText(piece.pieceId, 'Piece ID'),
        garment: requireText(piece.garment, 'Garment'),
        service: requireText(piece.service, 'Service'),
        position: piece.position,
        total: piece.total,
      };
    }),
  };
}

function requirePositiveCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(label + ' must be a positive whole number');
  return value;
}

/** Preview-safe lines mirror the native adapter's content order. */
export function documentLines(document: PrintDocument): string[][] {
  if (document.kind === 'tags') {
    return document.document.pieces.map((piece) => [
      'Bill ' + document.document.orderNumber,
      piece.garment + ' / ' + piece.service,
      'Piece ' + piece.pieceId + ' (' + piece.position + '/' + piece.total + ')',
    ]);
  }
  const bill = document.document;
  return [[
    'SMART LAUNDRY',
    'Bill: ' + bill.orderNumber,
    'Date: ' + bill.createdAtIst,
    'Customer: ' + bill.customerName,
    'Phone: ' + bill.customerPhone,
    ...bill.items.flatMap((item) => [
      item.garment + ' / ' + item.service + '  x' + item.quantity,
      '  ' + formatMinor(item.unitPriceMinor) + '  ' + formatMinor(item.lineTotalMinor),
    ]),
    'Pieces: ' + bill.physicalPieceCount,
    'Subtotal: ' + formatMinor(bill.subtotalMinor),
    'Paid: ' + formatMinor(bill.paidMinor),
    'Balance: ' + formatMinor(bill.balanceMinor),
    'Ready by: ' + bill.promisedAtIst,
    'Thank you',
  ]];
}

function formatMinor(value: number): string {
  return '₹' + Math.floor(value / 100) + '.' + String(value % 100).padStart(2, '0');
}
