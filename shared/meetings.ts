import { type Clock, formatDay, formatTimeRange } from './dates';
import { LIMITS } from './limits';
import { tokensToNames } from './mentions';
import type { OpOf } from './protocol';
import {
  type DateString,
  type Meeting,
  type Snapshot,
  type TimeString,
  type Topic,
  topicsOf,
} from './types';

/**
 * The Meetings view's selection and the small rules meetings share: reading
 * a typed time, ordering, and the month grouping. Pure; pages memoize it.
 */

export interface MeetingFilters {
  /** `''` every project, `general` General only, or a project id. */
  project: string;
  /**
   * Find (#271): every word must appear in the title, the agenda note, a
   * topic's title or an attendee's name (mentions read as names).
   */
  q?: string;
}

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

/** "2:00–3:00 PM", "14:00", or `''` for an all-day meeting. */
export function timeRange(
  meeting: Pick<Meeting, 'time' | 'end'>,
  clock: Clock,
): string {
  if (!meeting.time) return '';
  return formatTimeRange(meeting.time, meeting.end, clock);
}

/** "Mon 27 Oct, 2:00–3:00 PM". */
export function describeWhen(
  meeting: Meeting,
  today: DateString,
  clock: Clock,
): string {
  const range = timeRange(meeting, clock);
  const day = formatDay(meeting.date, today);
  return range ? `${day}, ${range}` : day;
}

/** A meeting's words for Find: title, agenda, topics, attendees' names. */
function meetingText(meeting: Meeting, people: Snapshot['people']): string {
  return [
    meeting.title,
    meeting.note,
    ...topicsOf(meeting).map((t) => t.title),
    ...meeting.attendees.map((id) => people[id]?.name ?? ''),
  ]
    .map((text) => tokensToNames(text, people))
    .join('\n')
    .toLowerCase();
}

/**
 * Meetings for the Meetings view, soonest first. Unlike Focus's agenda,
 * the meetings of archived projects stay: they are shown under their
 * project. `people` names the attendees (and mentions) for Find.
 */
export function selectMeetings(
  meetings: Snapshot['meetings'],
  filters: MeetingFilters,
  people: Snapshot['people'] = {},
): Meeting[] {
  const words = (filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(meetings)
    .filter((m) => {
      if (filters.project === 'general') {
        if (m.projectId !== null) return false;
      } else if (filters.project && m.projectId !== filters.project) {
        return false;
      }
      if (words.length === 0) return true;
      const text = meetingText(m, people);
      return words.every((w) => text.includes(w));
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

/* ---- topics -------------------------------------------------------------- */

/** "3 of 5 topics" (covered of all), or `''` for a meeting without any. */
export function topicCount(topics: readonly Topic[]): string {
  if (topics.length === 0) return '';
  const covered = topics.filter((t) => t.done).length;
  return `${covered} of ${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`;
}

/**
 * What is wrong with a new meeting's pending topics, or null: one longer
 * than a title may be, or more topics than a meeting holds (counting the
 * `existing` ones, carried forward, they are added after).
 */
export function checkTopicLines(
  lines: readonly string[],
  existing = 0,
): string | null {
  const long = lines.findIndex((l) => l.length > LIMITS.titleMax);
  if (long >= 0) {
    return `Line ${long + 1} is too long (${LIMITS.titleMax} characters at most)`;
  }
  if (existing + lines.length > LIMITS.topicsMax) {
    return existing > 0
      ? `A meeting has ${LIMITS.topicsMax} topics at most; it has ${existing}`
      : `A meeting has ${LIMITS.topicsMax} topics at most`;
  }
  return null;
}

/**
 * The titles as `addTopic` ops on the meeting, in order (each appends), to
 * go in the same batch as the meeting op. `newId` makes each topic's id.
 */
export function topicOps(
  meetingId: string,
  lines: readonly string[],
  newId: () => string,
): OpOf<'addTopic'>[] {
  return lines.map((title) => ({
    type: 'addTopic',
    meetingId,
    id: newId(),
    title,
  }));
}

/**
 * Undoing a deleted topic: the order to put it back in. Every id in
 * `current` (plus `restored`) once; those that were there before keep
 * their old order (`before`), any added since go at the end.
 */
export function restoredOrder(
  before: readonly string[],
  current: readonly string[],
  restored: string,
): string[] {
  const now = new Set([...current, restored]);
  const kept = before.filter((id) => now.has(id));
  const known = new Set(kept);
  return [...kept, ...current.filter((id) => !known.has(id))];
}

/* ---- carrying topics forward --------------------------------------------- */

/**
 * What places a meeting in its series and in time. A meeting being
 * written (not saved yet) has no id.
 */
export type MeetingKey = Pick<
  Meeting,
  'projectId' | 'title' | 'attendees' | 'date' | 'time'
> & { id?: string };

const titleKey = (title: string) => title.trim().toLowerCase();

/**
 * The same series: the same project, the same title (trimmed, any case)
 * and the same attendees (in any order). There is no recurrence model;
 * this is the whole of it.
 */
export function sameSeries(a: MeetingKey, b: MeetingKey): boolean {
  if (a.projectId !== b.projectId) return false;
  const title = titleKey(a.title);
  if (title === '' || title !== titleKey(b.title)) return false;
  const people = new Set(a.attendees);
  const others = new Set(b.attendees);
  return (
    people.size === others.size && [...people].every((id) => others.has(id))
  );
}

/** Earlier: by day, then time (an all-day meeting before a timed one). */
const earlier = (a: MeetingKey, b: MeetingKey) =>
  a.date < b.date || (a.date === b.date && a.time < b.time);

/**
 * The most recent earlier meeting of the same series as `meeting` (one
 * being written counts too), or null. Without a day there is nothing to
 * be earlier than.
 */
export function previousMeeting(
  meetings: Snapshot['meetings'],
  meeting: MeetingKey,
): Meeting | null {
  if (!meeting.date) return null;
  let found: Meeting | null = null;
  for (const m of Object.values(meetings)) {
    if (m.id === meeting.id || !earlier(m, meeting)) continue;
    if (!sameSeries(m, meeting)) continue;
    if (!found || byWhen(found, m) < 0) found = m;
  }
  return found;
}

/** The soonest later meeting of the same series as `meeting`, or null. */
export function nextMeeting(
  meetings: Snapshot['meetings'],
  meeting: Meeting,
): Meeting | null {
  let found: Meeting | null = null;
  for (const m of Object.values(meetings)) {
    if (m.id === meeting.id || !earlier(meeting, m)) continue;
    if (!sameSeries(m, meeting)) continue;
    if (!found || byWhen(m, found) < 0) found = m;
  }
  return found;
}

/**
 * The topics of `from` to carry to `to`: the uncovered ones, less any
 * `to` already has (by title, any case), so carrying twice adds nothing.
 */
export function topicsToCarry(
  from: Pick<Meeting, 'topics'>,
  to?: Pick<Meeting, 'topics'>,
): Topic[] {
  const there = new Set(to ? topicsOf(to).map((t) => titleKey(t.title)) : []);
  return topicsOf(from).filter((t) => !t.done && !there.has(titleKey(t.title)));
}

/**
 * Copies of `topics` (from the meeting `from`) as `addTopic` ops on
 * `meetingId`: new ids, uncovered, no outcome, and the day they were
 * first raised (a topic that was itself carried keeps its first day).
 */
export function carryOps(
  from: Pick<Meeting, 'date'>,
  topics: readonly Topic[],
  meetingId: string,
  newId: () => string,
): OpOf<'addTopic'>[] {
  return topics.map((t) => ({
    type: 'addTopic',
    meetingId,
    id: newId(),
    title: t.title,
    carriedFrom: t.carriedFrom ?? from.date,
  }));
}

/** The outcome a topic carried away from its meeting is left with. */
export const CARRIED_OUTCOME = 'Carried forward';

export type TopicOp =
  | OpOf<'addTopic'>
  | OpOf<'editTopic'>
  | OpOf<'toggleTopic'>
  | OpOf<'deleteTopic'>;

/**
 * Carrying an existing meeting's uncovered topics to `to`: copy them there
 * and mark them covered on `from` with the outcome "Carried forward". The
 * ops go in one batch; `undo` is the batch that takes it back.
 */
export function carryForward(
  from: Meeting,
  to: Meeting,
  newId: () => string,
): { ops: TopicOp[]; undo: TopicOp[]; count: number } {
  const topics = topicsToCarry(from, to);
  const added = carryOps(from, topics, to.id, newId);
  const ops: TopicOp[] = [...added];
  const undo: TopicOp[] = added.map((op) => ({
    type: 'deleteTopic',
    meetingId: to.id,
    id: op.id,
  }));
  for (const t of topics) {
    ops.push(
      { type: 'toggleTopic', meetingId: from.id, id: t.id, done: true },
      {
        type: 'editTopic',
        meetingId: from.id,
        id: t.id,
        patch: { outcome: CARRIED_OUTCOME },
      },
    );
    undo.push(
      { type: 'toggleTopic', meetingId: from.id, id: t.id, done: false },
      {
        type: 'editTopic',
        meetingId: from.id,
        id: t.id,
        patch: { outcome: t.outcome },
      },
    );
  }
  return { ops, undo, count: topics.length };
}

/** "2 topics" / "1 topic". */
export function topicsNoun(count: number): string {
  return `${count} ${count === 1 ? 'topic' : 'topics'}`;
}
