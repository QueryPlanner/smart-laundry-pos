import type { CounterOrderSummary } from '../counter';
import { addDays, formatDay, shopDateOf } from '../salesRange';

/** "Today", "Yesterday", or the date, for a shop-local `YYYY-MM-DD` day. */
export const dayHeading = (date: string, today: string): string => {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatDay(date);
};

export interface DayGroup {
  /** Shop-local `YYYY-MM-DD`. */
  date: string;
  heading: string;
  orders: CounterOrderSummary[];
}

/**
 * Splits a newest-first list into runs of orders received on the same shop day, each with its heading.
 * The list keeps its order: only neighbours on the same day share a group.
 */
export const groupByDay = (orders: CounterOrderSummary[], today: string): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const order of orders) {
    const date = shopDateOf(new Date(order.receivedAt));
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.orders.push(order);
    else groups.push({ date, heading: dayHeading(date, today), orders: [order] });
  }
  return groups;
};
