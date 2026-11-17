/**
 * Today (#331), the pure half: one day as a timeline, what is due, the
 * meeting coming up and the header's one line. Everything is on the
 * local calendar (`dates.ts`): a timestamp's day and `HH:MM` are where it
 * fell for the person reading. Archived projects' items are left out.
 */
import { addDays, dayOf } from './dates';
import { byLoop, isOpenLoop } from './loops';
import type {
  DateString,
  Meeting,
  Note,
  Snapshot,
  Task,
  TimeString,
} from './types';

export type DayEntry =
  | { kind: 'meeting'; at: TimeString | ''; meeting: Meeting }
  | { kind: 'done'; at: TimeString; task: Task }
  | { kind: 'added'; at: TimeString; task: Task }
  | { kind: 'note'; at: TimeString; note: Note };

const pad = (n: number) => String(n).padStart(2, '0');

/** The local `HH:MM` of a timestamp. */
export function localTime(when: string | number | Date): TimeString {
  const d = new Date(when);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Order within one minute: the meeting, then what was written and done. */
const KIND_ORDER: Record<DayEntry['kind'], number> = {
  meeting: 0,
  note: 1,
  added: 2,
  done: 3,
};

function inLiveProject(
  projectId: string | null,
  projects: Snapshot['projects'],
): boolean {
  return !(projectId && projects[projectId]?.archived);
}

/**
 * One day in time order: its meetings (untimed ones first, `at` empty),
 * the tasks added and the tasks done that day (one task can be both),
 * and the notes written that day, each at its local `HH:MM`.
 */
export function dayEntries(
  state: Pick<Snapshot, 'meetings' | 'tasks' | 'notes' | 'projects'>,
  day: DateString,
): DayEntry[] {
  const live = (projectId: string | null) =>
    inLiveProject(projectId, state.projects);
  const out: DayEntry[] = [];
  for (const meeting of Object.values(state.meetings)) {
    if (meeting.date === day && live(meeting.projectId)) {
      out.push({ kind: 'meeting', at: meeting.time, meeting });
    }
  }
  for (const task of Object.values(state.tasks)) {
    if (!live(task.projectId)) continue;
    if (dayOf(task.createdAt) === day) {
      out.push({ kind: 'added', at: localTime(task.createdAt), task });
    }
    if (task.completedAt && dayOf(task.completedAt) === day) {
      out.push({ kind: 'done', at: localTime(task.completedAt), task });
    }
  }
  for (const note of Object.values(state.notes)) {
    if (live(note.projectId) && dayOf(note.createdAt) === day) {
      out.push({ kind: 'note', at: localTime(note.createdAt), note });
    }
  }
  return out.sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      entryTitle(a).localeCompare(entryTitle(b)),
  );
}

function entryTitle(entry: DayEntry): string {
  if (entry.kind === 'meeting') return entry.meeting.title;
  if (entry.kind === 'note') return entry.note.createdAt;
  return entry.task.title;
}

/**
 * The open tasks due on `day` in live projects, by `byLoop`; on today,
 * the overdue ones too.
 */
export function dueOn(
  state: Pick<Snapshot, 'tasks' | 'projects'>,
  day: DateString,
  today: DateString,
): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.due && isOpenLoop(t, state.projects))
    .filter((t) => (day === today ? t.due <= day : t.due === day))
    .sort(byLoop);
}

/**
 * Whether a meeting is over at `now` on `today`: an earlier day, or
 * today with its end (or its start, without one) before now. An untimed
 * meeting today is never over.
 */
export function meetingPast(
  meeting: Pick<Meeting, 'date' | 'time' | 'end'>,
  today: DateString,
  now: TimeString,
): boolean {
  if (meeting.date !== today) return meeting.date < today;
  const last = meeting.end || meeting.time;
  return last !== '' && last < now;
}

/**
 * The next meeting from `now` (`HH:MM`) on `today`: one still going on
 * counts, as does an untimed one today. Within `days` days (today is the
 * first) when given. Archived projects' meetings are left out. The
 * earliest by date and time, untimed first on a day; null when none.
 */
export function nextMeeting(
  state: Pick<Snapshot, 'meetings' | 'projects'>,
  today: DateString,
  now: TimeString,
  days?: number,
): Meeting | null {
  const last = days ? addDays(today, days - 1) : null;
  let best: Meeting | null = null;
  for (const m of Object.values(state.meetings)) {
    if (m.date < today || (last && m.date > last)) continue;
    if (!inLiveProject(m.projectId, state.projects)) continue;
    if (meetingPast(m, today, now)) continue;
    if (
      !best ||
      (m.date.localeCompare(best.date) ||
        m.time.localeCompare(best.time) ||
        m.title.localeCompare(best.title)) < 0
    ) {
      best = m;
    }
  }
  return best;
}

export interface DayCounts {
  meetings: number;
  due: number;
  waiting: number;
  decide: number;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The header's line: "2 meetings, 3 due, 4 waiting on others, 1 to decide". */
export function dayLine(counts: DayCounts): string {
  return [
    plural(counts.meetings, 'meeting'),
    `${counts.due} due`,
    `${counts.waiting} waiting on others`,
    `${counts.decide} to decide`,
  ].join(', ');
}
