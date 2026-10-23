/**
 * The screens a person has been on, newest last, so the Back button can return to the one before.
 * Pure helpers: the shell owns the list and decides which screens may still be shown.
 */

/** Long enough for a busy hour at the counter; older entries are forgotten. */
export const MAX_TRAIL = 20;

/** The trail after moving from `from` to `to`. Staying on the same screen records nothing. */
export const pushTrail = <T>(trail: readonly T[], from: T, to: T): T[] =>
  from === to ? [...trail] : [...trail, from].slice(-MAX_TRAIL);

export interface BackStep<T> {
  /** The screen Back goes to. */
  target: T;
  /** The trail once Back has gone there. */
  rest: T[];
}

/**
 * The newest entry that `canShow` accepts, with the trail left after it. Entries that cannot be
 * shown (for example an order page whose order is no longer open) are skipped over, not kept.
 * `null` when nothing in the trail can be shown.
 */
export const backStep = <T>(trail: readonly T[], canShow: (page: T) => boolean): BackStep<T> | null => {
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    if (canShow(trail[index])) return { target: trail[index], rest: trail.slice(0, index) };
  }
  return null;
};
