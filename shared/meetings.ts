import { formatDay } from './dates';
import type { DateString, Meeting, Snapshot, TimeString } from './types';

/**
 * The Meetings view's selection and the small rules meetings share: reading
 * a typed time, ordering, and the month grouping. Pure; pages memoize it.
 */

export interface MeetingFilters {
  /** `''` every project, `general` General only, or a project id. */
  project: string;
}

export const DEFAULT_MEETING_FILTERS: MeetingFilters = { project: '' };

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
export function byWhen(a: Meeting, b: Meeting): number {
  return (
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    a.title.localeCompare(b.title)
  );
}

/** "14:00–15:00", "14:00", or `''` for an all-day meeting. */
export function timeRange(meeting: Pick<Meeting, 'time' | 'end'>): string {
  if (!meeting.time) return '';
  return meeting.end ? `${meeting.time}–${meeting.end}` : meeting.time;
}

/** "Mon 27 Oct, 14:00–15:00". */
export function describeWhen(meeting: Meeting, today: DateString): string {
  const range = timeRange(meeting);
  const day = formatDay(meeting.date, today);
  return range ? `${day}, ${range}` : day;
}

/**
 * Meetings for the Meetings view, soonest first. Unlike Focus's agenda,
 * the meetings of archived projects stay: they are shown under their
 * project.
 */
export function selectMeetings(
  meetings: Snapshot['meetings'],
  filters: MeetingFilters,
): Meeting[] {
  return Object.values(meetings)
    .filter((m) => {
      if (filters.project === 'general') return m.projectId === null;
      return !filters.project || m.projectId === filters.project;
    })
    .sort(byWhen);
}

/** One project's meetings (null = General), soonest first. */
export function projectMeetings(
  meetings: Snapshot['meetings'],
  projectId: string | null,
): Meeting[] {
  return Object.values(meetings)
    .filter((m) => m.projectId === projectId)
    .sort(byWhen);
}

export interface MeetingMonth {
  /** `YYYY-MM`. */
  month: string;
  meetings: Meeting[];
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
 * Meetings (already soonest first) split at `today`: upcoming ones (today
 * included) under their month, and the past newest first.
 */
export function splitByMonth(
  meetings: Meeting[],
  today: DateString,
): { upcoming: MeetingMonth[]; past: Meeting[] } {
  const upcoming: MeetingMonth[] = [];
  const past: Meeting[] = [];
  for (const m of meetings) {
    if (m.date < today) {
      past.push(m);
      continue;
    }
    const month = m.date.slice(0, 7);
    const last = upcoming[upcoming.length - 1];
    if (last?.month === month) last.meetings.push(m);
    else upcoming.push({ month, meetings: [m] });
  }
  past.reverse();
  return { upcoming, past };
}
