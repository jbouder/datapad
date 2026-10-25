import { formatDay } from './dates';
import type {
  DateString,
  Event,
  EventType,
  Snapshot,
  TimeString,
} from './types';

/**
 * The Events view's selection and the small rules events share: reading a
 * typed time, ordering, and the month grouping. Pure; pages memoize it.
 */

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  meeting: 'Meeting',
  milestone: 'Milestone',
  deadline: 'Deadline',
  demo: 'Demo',
  other: 'Other',
};

export interface EventFilters {
  /** `''` every project, `general` General only, or a project id. */
  project: string;
  /** `''` every type. */
  type: EventType | '';
}

export const DEFAULT_EVENT_FILTERS: EventFilters = { project: '', type: '' };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * What someone types into a time field, as `HH:MM` (`''` for empty, `null`
 * when it cannot be read): `9`, `9:30`, `9.30`, `930`, `0930`, `14`,
 * `1430`, `2pm`, `2:30 pm`, `12am`, `noon`, `midnight`.
 */
export function parseTime(input: string): TimeString | '' | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (text === '') return '';
  if (text === 'noon') return '12:00';
  if (text === 'midnight') return '00:00';
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3]?.[0];
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    if (half === 'a' && hours === 12) hours = 0;
    if (half === 'p' && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Soonest first: by day, then time (all-day before timed), then title. */
export function byWhen(a: Event, b: Event): number {
  return (
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    a.title.localeCompare(b.title)
  );
}

/** "14:00–15:00", "14:00", or `''` for an all-day event. */
export function timeRange(event: Pick<Event, 'time' | 'end'>): string {
  if (!event.time) return '';
  return event.end ? `${event.time}–${event.end}` : event.time;
}

/** "Mon 27 Oct, 14:00–15:00". */
export function describeWhen(event: Event, today: DateString): string {
  const range = timeRange(event);
  const day = formatDay(event.date, today);
  return range ? `${day}, ${range}` : day;
}

/**
 * Events for the Events view, soonest first. Unlike Focus's agenda, the
 * events of archived projects stay: they are shown under their project.
 */
export function selectEvents(
  events: Snapshot['events'],
  filters: EventFilters,
): Event[] {
  return Object.values(events)
    .filter((e) => {
      if (filters.project === 'general') {
        if (e.projectId !== null) return false;
      } else if (filters.project && e.projectId !== filters.project) {
        return false;
      }
      return !filters.type || e.type === filters.type;
    })
    .sort(byWhen);
}

/** One project's events (null = General), soonest first. */
export function projectEvents(
  events: Snapshot['events'],
  projectId: string | null,
): Event[] {
  return Object.values(events)
    .filter((e) => e.projectId === projectId)
    .sort(byWhen);
}

export interface EventMonth {
  /** `YYYY-MM`. */
  month: string;
  events: Event[];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "October 2026" for `2026-10`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Events (already soonest first) split at `today`: upcoming ones (today
 * included) under their month, and the past newest first.
 */
export function splitByMonth(
  events: Event[],
  today: DateString,
): { upcoming: EventMonth[]; past: Event[] } {
  const upcoming: EventMonth[] = [];
  const past: Event[] = [];
  for (const e of events) {
    if (e.date < today) {
      past.push(e);
      continue;
    }
    const month = e.date.slice(0, 7);
    const last = upcoming[upcoming.length - 1];
    if (last?.month === month) last.events.push(e);
    else upcoming.push({ month, events: [e] });
  }
  past.reverse();
  return { upcoming, past };
}
