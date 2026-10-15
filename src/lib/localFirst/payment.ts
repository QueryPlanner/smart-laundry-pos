const RUPEES = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/**
 * Convert a rupee input such as "19.99" to integer paise by reading the digits, never by
 * multiplying a float (19.99 * 100 is 1998.9999999999998). Returns null for anything that is not
 * a plain non-negative amount with at most two decimals; an empty field means zero.
 */
export const parsePaymentAmountMinor = (value: string): number | null => {
  const text = value.trim();
  if (text === '') return 0;
  const match = RUPEES.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
};
