import type { CounterPiece } from '../counter';

/**
 * Pure helpers for the pickup checklist. Tagged pieces are checked one by one (by scan or by hand).
 * Untagged pieces (plain ironing) have no tag, so they are checked as a count within their line.
 */

/** Untagged pieces of one garment and service, e.g. "3 Shirts, Iron". */
export interface UntaggedLine { key: string; garment: string; service: string; pieces: CounterPiece[] }

export type ScanResult =
  | { kind: 'empty' }
  | { kind: 'ok'; piece: CounterPiece }
  | { kind: 'duplicate'; piece: CounterPiece }
  | { kind: 'unknown' };

/** A position typed alone, such as "3" or "-3". */
const POSITION_ONLY = /^-?(\d+)$/;

/** Tagged pieces keep their input order. Untagged pieces form one line per garment and service, in first-seen order. */
export function splitPieces(pieces: CounterPiece[]): { tagged: CounterPiece[]; untaggedLines: UntaggedLine[] } {
  const tagged: CounterPiece[] = [];
  const lines = new Map<string, UntaggedLine>();
  for (const piece of pieces) {
    if (piece.tagged) {
      tagged.push(piece);
      continue;
    }
    const key = `${piece.garmentId}|${piece.service}`;
    const line = lines.get(key) ?? { key, garment: piece.garment, service: piece.service, pieces: [] };
    line.pieces.push(piece);
    lines.set(key, line);
  }
  return { tagged, untaggedLines: [...lines.values()] };
}

/** The ids of the first `count` pieces of a line. The count is floored and clamped to the line size. */
export function untaggedIds(line: UntaggedLine, count: number): string[] {
  const wanted = Math.min(Math.max(0, Math.floor(count)), line.pieces.length);
  return line.pieces.slice(0, wanted).map(piece => piece.id);
}

/**
 * Resolves what the cashier typed or scanned against the tagged pieces. A full short id matches
 * case-insensitively. A position typed alone matches only when exactly one tagged piece has it.
 */
export function resolveScan(input: string, tagged: CounterPiece[], checkedIds: string[]): ScanResult {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  const piece = findTagged(text, tagged);
  if (!piece) return { kind: 'unknown' };
  return checkedIds.includes(piece.id) ? { kind: 'duplicate', piece } : { kind: 'ok', piece };
}

/** How many pieces are checked for pickup. Same count as `pickupPieceIds`. */
export function checkedCount(pieces: CounterPiece[], checkedTaggedIds: string[], untaggedCounts: Record<string, number>): number {
  return pickupPieceIds(pieces, checkedTaggedIds, untaggedCounts).length;
}

/**
 * The ids to send for collection: checked tagged pieces (known, de-duplicated, in the order given),
 * then the first pieces of each untagged line in first-seen order.
 */
export function pickupPieceIds(pieces: CounterPiece[], checkedTaggedIds: string[], untaggedCounts: Record<string, number>): string[] {
  const { tagged, untaggedLines } = splitPieces(pieces);
  const taggedIds = new Set(tagged.map(piece => piece.id));
  const checked = [...new Set(checkedTaggedIds)].filter(id => taggedIds.has(id));
  const untagged = untaggedLines.flatMap(line => untaggedIds(line, untaggedCounts[line.key] ?? 0));
  return [...checked, ...untagged];
}

function findTagged(text: string, tagged: CounterPiece[]): CounterPiece | undefined {
  const lower = text.toLowerCase();
  const byShortId = tagged.find(piece => piece.shortId.toLowerCase() === lower);
  if (byShortId) return byShortId;

  const match = POSITION_ONLY.exec(text);
  if (!match) return undefined;
  const position = Number(match[1]);
  const samePosition = tagged.filter(piece => piece.position === position);
  return samePosition.length === 1 ? samePosition[0] : undefined;
}
