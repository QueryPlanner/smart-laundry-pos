/** Shop time is fixed India Standard Time (+05:30, no daylight saving); dates here are shop-local. */
const SHOP_OFFSET_MINUTES = 330;
const shopDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** Today's date in shop time as `YYYY-MM-DD`, whatever the computer's own time zone is. */
export const shopToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + SHOP_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

/** First day of the current shop-time month as `YYYY-MM-DD`. */
export const shopMonthStart = (now: Date = new Date()): string => `${shopToday(now).slice(0, 8)}01`;

/** "05 Jan 2026" for a stored timestamp or `YYYY-MM-DD` date; an em dash when there is none. */
export const formatShopDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value);
  return Number.isNaN(parsed.getTime()) ? '—' : shopDate.format(parsed);
};

/** `ready_for_pickup` -> "Ready for pickup". */
export const statusLabel = (status: string): string => {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A trimmed form value, or undefined when it is blank (the native side stores blank as nothing). */
export const orUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
