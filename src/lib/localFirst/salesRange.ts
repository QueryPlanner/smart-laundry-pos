import type { SalesBucket } from './insights';

/**
 * Date helpers for the Sales and Dashboard screens. The shop runs on India Standard Time
 * (+05:30, no daylight saving) whatever the computer's own zone is, so every calendar day and
 * range here is worked out in shop time and sent to the native queries as `YYYY-MM-DDTHH:MM`.
 */

export type SalesPreset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';
export interface LocalRange { from: string; to: string }

const SHOP_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOCAL_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (value: number): string => String(value).padStart(2, '0');

/** The widest range a graph may cover per bucket; the native side enforces the same limits. */
export const BUCKET_LIMIT_DAYS: Record<SalesBucket, number> = { hour: 31, day: 366, month: 3660 };
export const MAX_RANGE_DAYS = 3660;

const shopDayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const shopDateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});

/** Today's date in shop time, `YYYY-MM-DD`. */
export const shopDateOf = (now: Date): string => new Date(now.getTime() + SHOP_OFFSET_MS).toISOString().slice(0, 10);

/** `YYYY-MM-DD` shifted by whole days. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const startOfDay = (date: string): string => `${date}T00:00`;
const monthStart = (date: string): string => `${date.slice(0, 8)}01`;
const nextMonthStart = (date: string): string => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
};

/** The preset windows, all from shop-time midnight to shop-time midnight. */
export const presetRange = (preset: Exclude<SalesPreset, 'custom'>, now: Date): LocalRange => {
  const today = shopDateOf(now);
  const windows: Record<Exclude<SalesPreset, 'custom'>, [string, string]> = {
    today: [today, addDays(today, 1)],
    yesterday: [addDays(today, -1), today],
    last7: [addDays(today, -6), addDays(today, 1)],
    month: [monthStart(today), nextMonthStart(today)],
  };
  const [from, to] = windows[preset];
  return { from: startOfDay(from), to: startOfDay(to) };
};

/** The last `days` shop days ending with `today` (inclusive). */
export const lastDaysRange = (today: string, days: number): LocalRange => ({
  from: startOfDay(addDays(today, 1 - days)),
  to: startOfDay(addDays(today, 1)),
});

const localMs = (local: string): number => Date.parse(`${local}:00Z`);

export const spanDays = (range: LocalRange): number => (localMs(range.to) - localMs(range.from)) / DAY_MS;

/** Why a range cannot be queried, or null when it can. */
export const rangeProblem = (range: LocalRange): string | null => {
  if (!LOCAL_SHAPE.test(range.from) || !LOCAL_SHAPE.test(range.to) || Number.isNaN(localMs(range.from)) || Number.isNaN(localMs(range.to))) {
    return 'Choose a start and an end date and time.';
  }
  if (localMs(range.to) <= localMs(range.from)) return 'The end must be after the start.';
  if (spanDays(range) > MAX_RANGE_DAYS) return 'Choose a range of at most 10 years.';
  return null;
};

/** Hours for a day or two, days for up to about three months, months beyond that. */
export const autoBucket = (range: LocalRange): SalesBucket => {
  const span = spanDays(range);
  if (span <= 2) return 'hour';
  return span <= 92 ? 'day' : 'month';
};

/** Buckets that fit the range, so the switch never offers one the query would refuse. */
export const allowedBuckets = (range: LocalRange): SalesBucket[] =>
  (['hour', 'day', 'month'] as const).filter(bucket => spanDays(range) <= BUCKET_LIMIT_DAYS[bucket]);

export const splitLocal = (local: string): { date: string; time: string } => ({ date: local.slice(0, 10), time: local.slice(11, 16) });
export const joinLocal = (date: string, time: string): string => `${date}T${time}`;

const dayLabel = (date: string): string => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const hourLabel = (key: string): string => {
  const hour = Number(key.slice(11, 13));
  return `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`;
};

/** Full name of a graph bucket: "5 Mar, 2 pm", "5 Mar" or "Mar 2026". */
export const bucketLabel = (key: string, bucket: SalesBucket): string => {
  if (bucket === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return bucket === 'day' ? dayLabel(key) : `${dayLabel(key)}, ${hourLabel(key)}`;
};

/** Short axis label of a graph bucket. */
export const bucketTick = (key: string, bucket: SalesBucket): string => {
  if (bucket === 'month') return MONTHS[Number(key.slice(5, 7)) - 1];
  return bucket === 'day' ? dayLabel(key) : hourLabel(key);
};

/** "05 Mar 2026, 2:30 pm" for a stored timestamp, in shop time; an em dash when unreadable. */
export const formatShopDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? '—' : shopDateTimeFormat.format(parsed);
};

/** "05 Mar 2026" for a shop-local `YYYY-MM-DD` day. */
export const formatDay = (date: string): string => shopDayFormat.format(new Date(`${date}T00:00:00+05:30`));

/** "05 Mar 2026, 2:30 pm" for a shop-local `YYYY-MM-DDTHH:MM`. */
export const formatLocal = (local: string): string => formatShopDateTime(new Date(`${local}:00+05:30`).toISOString());

const STATUS_LABELS: Record<string, string> = {
  received: 'Received', washing: 'Washing', drying: 'Drying', ironing: 'Ironing', quality_check: 'Quality check',
  packing: 'Packing', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled',
};
const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', credit: 'Credit (older orders)', other: 'Other',
};

/** Readable status; an unknown value is shown as it is rather than hidden. */
export const statusText = (status: string): string => STATUS_LABELS[status] ?? status;
export const methodText = (method: string): string => METHOD_LABELS[method] ?? method;
