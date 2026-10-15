/** Convert a rupee input to integer paise without accepting floating-point ambiguity. */
export const parsePaymentAmountMinor = (value: string): number | null => {
  if (value.trim() === '') return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value) * 100;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
};
