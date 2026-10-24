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

const WEEKDAYS: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  weds: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

/** `YYYY-MM-DD` for a year, month (1–12) and day, if that day exists. */
function makeDate(y: number, m: number, d: number): DateString | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Months later, kept to the last day of a shorter month (Jan 31 + 1m = Feb 28). */
function addMonths(day: DateString, n: number): DateString {
  const [y, m, d] = parts(day);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/**
 * What someone types into a date field, as a day (`''` for empty, `null`
 * when it cannot be read). Relative to `today`, the local date:
 *
 * - `today`, `tod`, `tomorrow`, `tmr`, `yesterday`
 * - a weekday (`fri`, `friday`): the next one, today included
 * - `next fri`: that weekday in next week (Monday to Sunday)
 * - `next week`: next Monday; `next month`: the 1st of next month
 * - `+3d`, `+2w`, `+1m`, `-1d` (and `3d`, `in 3 days`, `in 2 weeks`)
 * - `10/31` (the next time that day comes round), `10/31/2027`
 * - `2026-10-31`
 */
export function parseDate(
  input: string,
  today: DateString,
): DateString | '' | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === '') return '';

  if (text === 'today' || text === 'tod' || text === 'now') return today;
  if (text === 'tomorrow' || text === 'tmr' || text === 'tom') {
    return addDays(today, 1);
  }
  if (text === 'yesterday') return addDays(today, -1);
  if (text === 'next week') return addDays(endOfWeek(today), 1);
  if (text === 'next month') {
    const [y, m] = parts(addMonths(today, 1));
    return makeDate(y, m, 1);
  }

  const weekdayMatch = /^(next )?([a-z]+)$/.exec(text);
  const target = weekdayMatch ? WEEKDAYS[weekdayMatch[2] ?? ''] : undefined;
  if (weekdayMatch && target !== undefined) {
    if (weekdayMatch[1]) {
      // The same weekday in the week after this one.
      const nextMonday = addDays(endOfWeek(today), 1);
      return addDays(nextMonday, target);
    }
    return addDays(today, (target - weekday(today) + 7) % 7);
  }

  const relative =
    /^(?:in )?([+-])?(\d{1,3}) ?(d|day|days|w|wk|week|weeks|m|mo|month|months)$/.exec(
      text,
    );
  if (relative) {
    const sign = relative[1] === '-' ? -1 : 1;
    const n = sign * Number(relative[2]);
    const unit = relative[3]?.[0];
    if (unit === 'd') return addDays(today, n);
    if (unit === 'w') return addDays(today, 7 * n);
    return addMonths(today, n);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    if (us[3]) {
      const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
      return makeDate(y, m, d);
    }
    // The next time that day comes round: this year, or a later one (29
    // February can be up to four years off).
    const [y] = parts(today);
    for (let year = y; year <= y + 4; year += 1) {
      const day = makeDate(year, m, d);
      if (day !== null && day >= today) return day;
    }
    return null;
  }

  return null;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Fri 31 Oct", with the year when it is not `today`'s. */
export function formatDay(day: DateString, today: DateString): string {
  const [y, m, d] = parts(day);
  const [ty] = parts(today);
  const base = `${DAY_NAMES[weekday(day)]} ${d} ${MONTH_NAMES[m - 1]}`;
  return y === ty ? base : `${base} ${y}`;
}

/** "Today", "Tomorrow", "Yesterday", or `formatDay`. */
export function describeDay(day: DateString, today: DateString): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatDay(day, today);
}
