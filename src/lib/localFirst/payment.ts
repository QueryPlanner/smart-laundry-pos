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

/** The "Half" quick amount: the floor of half the total, in paise. */
export const halfOf = (totalMinor: number): number => Math.floor(totalMinor / 2);

/**
 * Format paise as a plain rupee string such as "240.50" (no currency symbol). Uses integer
 * remainder and division only, so the text is exact for every safe integer.
 */
export const rupeesText = (minor: number): string => {
  const paise = minor % 100;
  const rupees = (minor - paise) / 100;
  return `${rupees}.${String(paise).padStart(2, '0')}`;
};

export const ADVANCE_NOT_AMOUNT = 'Enter the advance as an amount such as 240 or 240.50.';
export const ADVANCE_ABOVE_TOTAL = 'The advance cannot be more than the amount to collect.';

/** The message explaining why an advance cannot be saved, or null when it can. An empty field is valid (nothing now). */
export const advanceProblem = (text: string, totalMinor: number): string | null => {
  const amountMinor = parsePaymentAmountMinor(text);
  if (amountMinor === null) return ADVANCE_NOT_AMOUNT;
  if (amountMinor > totalMinor) return ADVANCE_ABOVE_TOTAL;
  return null;
};

/**
 * The advance to send with a save, in paise: 0 for "nothing now", and always 0 for an order with nothing to
 * pay. It throws the explanation when the text cannot be sent, so an order is never saved quietly without
 * the money the cashier typed.
 */
export const advanceToSend = (text: string, totalMinor: number): number => {
  if (totalMinor === 0) return 0;
  const problem = advanceProblem(text, totalMinor);
  if (problem) throw new Error(problem);
  return parsePaymentAmountMinor(text) as number;
};
