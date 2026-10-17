import { describe, expect, it } from 'vitest';
import type { CounterPiece } from '../counter';
import { checkedCount, pickupPieceIds, resolveScan, splitPieces, untaggedIds, type UntaggedLine } from './pieceGroups';

const tagged = (id: string, position: number, shortId = `2610170001-${position}`, garmentId = 'shirt', garment = 'Shirt'): CounterPiece => ({
  id, shortId, garmentId, garment, service: 'Wash + Iron', position, total: 3,
  matched: false, packingMatched: false, collectionMatched: false, tagged: true,
});

const untagged = (id: string, position: number, garmentId = 'shirt', garment = 'Shirt', service = 'Iron'): CounterPiece => ({
  id, shortId: `2610170001-${position}`, garmentId, garment, service, position, total: 3,
  matched: false, packingMatched: false, collectionMatched: false, tagged: false,
});

const T1 = tagged('t1', 1, 'OK-1');
const T2 = tagged('t2', 2, 'OK-2');
const T3 = tagged('t3', 3, 'OK-3');
const U1 = untagged('u1', 4);
const U2 = untagged('u2', 5);
const U3 = untagged('u3', 6);
const JEANS = untagged('j1', 7, 'jeans', 'Jeans');
const SHIRT_DRY = untagged('d1', 8, 'shirt', 'Shirt', 'Dry');

const line = (pieces: CounterPiece[]): UntaggedLine => ({ key: 'x|y', garment: 'X', service: 'Y', pieces });

describe('splitPieces', () => {
  it('returns empty lists for no pieces', () => {
    expect(splitPieces([])).toEqual({ tagged: [], untaggedLines: [] });
  });

  it('keeps tagged pieces in their input order and leaves no untagged lines', () => {
    expect(splitPieces([T3, T1, T2])).toEqual({ tagged: [T3, T1, T2], untaggedLines: [] });
  });

  it('groups untagged pieces with the same garment and service into one line', () => {
    const result = splitPieces([U1, U2]);
    expect(result.tagged).toEqual([]);
    expect(result.untaggedLines).toEqual([{ key: 'shirt|Iron', garment: 'Shirt', service: 'Iron', pieces: [U1, U2] }]);
  });

  it('splits untagged pieces of the same garment by service text', () => {
    const result = splitPieces([U1, SHIRT_DRY]);
    expect(result.untaggedLines.map(l => l.key)).toEqual(['shirt|Iron', 'shirt|Dry']);
  });

  it('orders lines by first appearance even when pieces interleave', () => {
    const result = splitPieces([JEANS, U1, tagged('t9', 9), U2, SHIRT_DRY]);
    expect(result.tagged.map(p => p.id)).toEqual(['t9']);
    expect(result.untaggedLines.map(l => [l.key, l.pieces.map(p => p.id)])).toEqual([
      ['jeans|Iron', ['j1']],
      ['shirt|Iron', ['u1', 'u2']],
      ['shirt|Dry', ['d1']],
    ]);
  });
});

describe('untaggedIds', () => {
  const two = line([U1, U2]);

  it.each([
    ['zero picks nothing', 0, []],
    ['one picks the first piece', 1, ['u1']],
    ['the full line picks every piece', 2, ['u1', 'u2']],
    ['a count above the line size is clamped to the line', 9, ['u1', 'u2']],
    ['a negative count picks nothing', -4, []],
    ['a fractional count is floored', 1.9, ['u1']],
    ['an infinite count is clamped to the line', Infinity, ['u1', 'u2']],
    ['a NaN count picks nothing', Number.NaN, []],
  ])('%s', (_name, count, ids) => {
    expect(untaggedIds(two, count)).toEqual(ids);
  });

  it('picks nothing from an empty line whatever the count', () => {
    expect(untaggedIds(line([]), 5)).toEqual([]);
  });
});

describe('resolveScan', () => {
  const tags = [T1, T2, T3];

  it.each([
    ['an empty string', '', 'empty'],
    ['whitespace only', '   ', 'empty'],
  ])('%s is empty', (_name, input, kind) => {
    expect(resolveScan(input, tags, [])).toEqual({ kind });
  });

  it.each([
    ['an exact short id', 'OK-2'],
    ['a lower-case short id', 'ok-2'],
    ['a short id with spaces around it', '  OK-2 \t'],
  ])('matches %s', (_name, input) => {
    expect(resolveScan(input, tags, [])).toEqual({ kind: 'ok', piece: T2 });
  });

  it.each([
    ['a position alone', '2'],
    ['a position with a leading dash', '-2'],
    ['a position with surrounding spaces', ' 2 '],
  ])('matches %s when only one tagged piece has it', (_name, input) => {
    expect(resolveScan(input, tags, [])).toEqual({ kind: 'ok', piece: T2 });
  });

  it('reports an already checked short id as a duplicate', () => {
    expect(resolveScan('OK-2', tags, ['t2'])).toEqual({ kind: 'duplicate', piece: T2 });
  });

  it('reports an already checked position as a duplicate', () => {
    expect(resolveScan('-2', tags, ['t2'])).toEqual({ kind: 'duplicate', piece: T2 });
  });

  it('ignores checked ids that belong to other pieces', () => {
    expect(resolveScan('OK-2', tags, ['t1', 'u1'])).toEqual({ kind: 'ok', piece: T2 });
  });

  it.each([
    ['a position no tagged piece has', '9'],
    ['position zero, which no piece has', '0'],
    ['an unknown short id', 'OK-9'],
    ['a decimal', '2.5'],
    ['a plus sign', '+2'],
    ['free text', 'shirt'],
  ])('reports %s as unknown', (_name, input) => {
    expect(resolveScan(input, tags, [])).toEqual({ kind: 'unknown' });
  });

  it('reports a position as unknown when two tagged pieces share it', () => {
    const clash = [T1, tagged('t1b', 1, 'OK-1B')];
    expect(resolveScan('1', clash, [])).toEqual({ kind: 'unknown' });
    expect(resolveScan('OK-1B', clash, [])).toEqual({ kind: 'ok', piece: clash[1] });
  });

  it('only matches tagged pieces, so an untagged piece is unknown', () => {
    expect(resolveScan(U1.shortId, tags, [])).toEqual({ kind: 'unknown' });
  });
});

describe('checkedCount and pickupPieceIds', () => {
  it('counts nothing for no pieces', () => {
    expect(checkedCount([], [], {})).toBe(0);
    expect(pickupPieceIds([], [], {})).toEqual([]);
  });

  it('counts checked tagged pieces once each and ignores unknown ids', () => {
    const pieces = [T1, T2, T3];
    expect(checkedCount(pieces, ['t1', 't1', 'ghost', 't3'], {})).toBe(2);
    expect(pickupPieceIds(pieces, ['t1', 't1', 'ghost', 't3'], {})).toEqual(['t1', 't3']);
  });

  it('keeps the order the checked tagged ids were given in', () => {
    expect(pickupPieceIds([T1, T2, T3], ['t3', 't1'], {})).toEqual(['t3', 't1']);
  });

  it('does not count an untagged piece id as a checked tagged piece', () => {
    expect(checkedCount([T1, U1], ['u1'], {})).toBe(0);
  });

  it('takes the untagged count from the first pieces of each line', () => {
    const pieces = [T1, U1, U2, JEANS];
    expect(pickupPieceIds(pieces, [], { 'shirt|Iron': 1, 'jeans|Iron': 1 })).toEqual(['u1', 'j1']);
    expect(checkedCount(pieces, [], { 'shirt|Iron': 1, 'jeans|Iron': 1 })).toBe(2);
  });

  it('clamps an untagged count to its line size', () => {
    expect(checkedCount([U1, U2], [], { 'shirt|Iron': 9 })).toBe(2);
  });

  it.each([
    ['a missing line key counts zero', {}, 0],
    ['a negative count counts zero', { 'shirt|Iron': -2 }, 0],
    ['a fractional count is floored', { 'shirt|Iron': 1.7 }, 1],
  ])('%s', (_name, counts, expected) => {
    expect(checkedCount([U1, U2], [], counts)).toBe(expected);
  });

  it('lists checked tagged pieces first, then untagged lines in first-seen order', () => {
    const pieces = [JEANS, U1, T1, U2, SHIRT_DRY, T2];
    const counts = { 'jeans|Iron': 1, 'shirt|Iron': 2, 'shirt|Dry': 1 };
    expect(pickupPieceIds(pieces, ['t2', 't1'], counts)).toEqual(['t2', 't1', 'j1', 'u1', 'u2', 'd1']);
  });

  it('agrees with checkedCount for every combination', () => {
    const pieces = [T1, T2, U1, U2, JEANS];
    const cases: Array<[string[], Record<string, number>]> = [
      [[], {}],
      [['t1'], { 'shirt|Iron': 1 }],
      [['t1', 't1', 't2', 'x'], { 'shirt|Iron': 2, 'jeans|Iron': 5 }],
      [['u1'], { 'shirt|Iron': -1 }],
    ];
    for (const [checked, counts] of cases) {
      expect(checkedCount(pieces, checked, counts)).toBe(pickupPieceIds(pieces, checked, counts).length);
    }
  });
});
