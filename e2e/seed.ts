import { addDays, localDate } from '../shared/dates';
import fixture from '../test/fixtures/export.json' with { type: 'json' };

/**
 * A populated tracker for specs that need one: the fictional export the
 * unit tests use, posted to `/api/import`. The repository is public and
 * never holds real data.
 *
 * The export's dates were written around {@link SEED_ANCHOR}. Every run
 * shifts them by the whole days between that anchor and today, so the seed
 * sits in the same place relative to today on any date: Echo Base's
 * shield review is always today, its first task always three days overdue.
 */

/** The day the export's dates were written around. */
export const SEED_ANCHOR = '2026-10-27';

/** Today on the local calendar (the runner and the browser share a zone). */
export function today(): string {
  return localDate(new Date());
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/**
 * `value` with every date (`YYYY-MM-DD`) and ISO timestamp in it moved
 * `days` days. A string is moved only when it is a date or a timestamp as
 * a whole, so text that mentions a date (a note body, a title) stays as it
 * is. A timestamp keeps its local time of day, across a DST change too.
 */
export function shiftDates<T>(value: T, days: number): T {
  if (typeof value === 'string') {
    if (DAY.test(value)) return addDays(value, days) as T;
    if (TIMESTAMP.test(value)) {
      const when = new Date(value);
      when.setDate(when.getDate() + days);
      return when.toISOString() as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => shiftDates(v, days)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]),
    ) as T;
  }
  return value;
}

export type Seed = typeof fixture;

/** The days the seed is shifted by in this test. */
let shift = daysBetween(SEED_ANCHOR, today());

/**
 * The seed for this test, shifted to today. A live binding: the fixtures
 * rebuild it before every test (`refreshSeed`), so a run that crosses
 * midnight moves it with the day. Clone it before changing it.
 */
export let SEED: Seed = shiftDates(fixture, shift);

/** Rebuild {@link SEED} for today. The fixtures call it before each test. */
export function refreshSeed() {
  shift = daysBetween(SEED_ANCHOR, today());
  SEED = shiftDates(fixture, shift);
}

/**
 * Where a day from the original export (`test/fixtures/export.json`) falls
 * in this test's seed. Assert seed dates through the app's formatters:
 * `formatDay(seedDay('2026-11-14'), today())`, never a literal.
 */
export function seedDay(day: string): string {
  return addDays(day, shift);
}

/**
 * A timestamp from the original export, shifted as the seed shifts it.
 */
export function seedTime(timestamp: string): string {
  return shiftDates(timestamp, shift);
}

/** Documents per collection in the seed, as the import reports them. */
export const SEED_COUNTS = {
  projects: Object.keys(fixture.projects).length,
  tasks: Object.keys(fixture.tasks).length,
  notes: Object.keys(fixture.notes).length,
  meetings: Object.keys(fixture.meetings).length,
  people: Object.keys(fixture.people).length,
  activity: Object.keys(fixture.activity).length,
  // The artifact's export has no settings.
  settings: 0,
  decisions: 0,
  orgs: 0,
  templates: 0,
};
