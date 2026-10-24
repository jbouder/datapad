import type { DateString } from './types';

/**
 * Calendar days as `YYYY-MM-DD`. Everything here is on the user's local
 * calendar: "today" changes at local midnight, and a week runs Monday to
 * Sunday. Pure apart from `localDate`, which reads the clock it is given.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of `when`. */
export function localDate(when: Date): DateString {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

function parts(day: DateString): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

/** `day` plus `n` days (negative goes back). */
export function addDays(day: DateString, n: number): DateString {
  const [y, m, d] = parts(day);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(day: DateString): number {
  const [y, m, d] = parts(day);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Sunday that ends `day`'s week (`day` itself on a Sunday). */
export function endOfWeek(day: DateString): DateString {
  return addDays(day, 6 - weekday(day));
}
