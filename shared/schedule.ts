/**
 * When is the next nightly backup? Holocron's `reset-time.ts` maths:
 * computed with Intl so daylight-saving changes in the configured zone are
 * handled without a date library.
 */

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ts: number, timeZone: string): Parts {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(ts)) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines report midnight as 24 with h23 on older ICU; normalize.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** The zone's UTC offset (ms) at an instant. */
function offsetAt(ts: number, timeZone: string): number {
  const p = zonedParts(ts, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The instant when `timeZone` reads `year-month-day hour:00:00`. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  // Subtract the offset in force at the guess, then correct once more in
  // case the first guess straddled a DST boundary.
  let ts = guess - offsetAt(guess, timeZone);
  ts = guess - offsetAt(ts, timeZone);
  return ts;
}

/**
 * The next time it is `hour:00` in `timeZone`, strictly after `now`.
 * Default: 3 AM in America/New_York.
 */
export function nextDailyAt(
  now: number,
  timeZone = 'America/New_York',
  hour = 3,
): number {
  const today = zonedParts(now, timeZone);
  const candidate = zonedTime(
    today.year,
    today.month,
    today.day,
    hour,
    timeZone,
  );
  if (candidate > now) {
    return candidate;
  }
  // Tomorrow in the zone: step the calendar day using UTC arithmetic on the
  // zone's own date parts, which sidesteps the local machine's zone.
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return zonedTime(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    hour,
    timeZone,
  );
}

/** The last time it was `hour:00` in `timeZone`, at or before `now`. */
export function lastDailyAt(
  now: number,
  timeZone = 'America/New_York',
  hour = 3,
): number {
  const next = nextDailyAt(now, timeZone, hour);
  // A day back from the next one, in the zone's calendar, not 24 hours.
  const p = zonedParts(next - 12 * 3_600_000, timeZone);
  return zonedTime(p.year, p.month, p.day, hour, timeZone);
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function zonedDay(ts: number, timeZone: string): string {
  const p = zonedParts(ts, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
