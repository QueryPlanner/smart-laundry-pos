const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "12.5" -> 1250 basis points (1/100 of a percent). Null unless 0 to 100 with up to two decimals. */
export const parsePercentBp = (value: string): number | null => {
  const match = PERCENT.exec(value.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints <= 10_000 ? basisPoints : null;
};

/** 1000 -> "10", 1250 -> "12.5", 5 -> "0.05". */
export const formatPercentBp = (basisPoints: number): string => {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  return fraction % 10 === 0 ? `${whole}.${fraction / 10}` : `${whole}.${String(fraction).padStart(2, '0')}`;
};
