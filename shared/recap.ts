import { addDays, dayOf, weekday } from './dates';
import { byWhen } from './meetings';
import {
  type AssigneeFilter,
  matchesAssignee,
  meId,
  notesOfMeeting,
  tasksOfMeeting,
} from './select';
import {
  type ActivityEntry,
  type DateString,
  GENERAL,
  type Meeting,
  type Note,
  type Project,
  type Snapshot,
  type Task,
  type Timestamp,
  topicsOf,
} from './types';

/**
 * Focus's Since yesterday (#258): what happened on the last working day,
 * computed from the documents' own timestamps, with no model. Pure: the
 * day comes in as `today` (the owner's local date). Brief me (#259) and
 * MCP's `get_recap` (#260) are built on it.
 */

/** The days the recap covers, both ends included, in the owner's day. */
export interface RecapWindow {
  from: DateString;
  to: DateString;
  /** "Yesterday" for one day, "Since Friday" across a weekend. */
  label: 'Yesterday' | 'Since Friday';
}

/**
 * The previous working day: yesterday on Tuesday to Friday (and on
 * Saturday, when yesterday was Friday); Friday through Sunday on Monday;
 * Friday through Saturday on Sunday.
 */
export function recapWindow(today: DateString): RecapWindow {
  const day = weekday(today);
  const to = addDays(today, -1);
  // Monday goes back to Friday (3 days), Sunday to Friday (2).
  const back = day === 0 ? 3 : day === 6 ? 2 : 1;
  const from = addDays(today, -back);
  return { from, to, label: from === to ? 'Yesterday' : 'Since Friday' };
}

/** The section's title: "Since yesterday", or "Since Friday". */
export function recapTitle(window: RecapWindow): string {
  return window.label === 'Yesterday' ? 'Since yesterday' : window.label;
}

/** Things under one project (null: General). */
export interface RecapGroup<T> {
  project: Project | null;
  items: T[];
}

/** A meeting held in the window and what came of it. */
export interface RecapMeeting {
  meeting: Meeting;
  topics: number;
  /** Topics covered. */
  covered: number;
  /** Every action item it produced, open first (`tasksOfMeeting`). */
  actionItems: Task[];
  /** Its notes, newest first. */
  notes: Note[];
}

/** One project's activity lines, newest first, after the cap. */
export interface RecapActivity extends RecapGroup<ActivityEntry> {
  /** Lines in the window beyond `RECAP_ACTIVITY_CAP`. */
  more: number;
}

export interface Recap {
  window: RecapWindow;
  /** Tasks closed in the window, by project, newest first. */
  closed: RecapGroup<Task>[];
  /** Tasks created in the window, newest first. */
  added: Task[];
  /** Meetings dated in the window, in the order they were held. */
  meetings: RecapMeeting[];
  /** Notes written in the window, by project, newest first. */
  notes: RecapGroup<Note>[];
  /** What else the activity logs say, by project. */
  activity: RecapActivity[];
}

/** Activity lines kept per project. */
export const RECAP_ACTIVITY_CAP = 5;
/** Added lists its titles up to this many; past it, only the count. */
export const RECAP_ADDED_TITLES = 5;

/**
 * Activity lines the recap already shows another way: a task added or
 * closed (Added, Closed), an action item added (Added, and its meeting),
 * a note written (Notes written).
 */
const COVERED = [
  /^Added task "/,
  /^Added action item "/,
  /^Closed "/,
  /^Added a note/,
  /^Saved a summary as a note$/,
];

/** By project name, General last. */
function byProject<T>(
  groups: Map<string, T[]>,
  projects: Snapshot['projects'],
) {
  return [...groups]
    .map(([key, items]) => ({
      project: key === GENERAL ? null : (projects[key] ?? null),
      items,
    }))
    .sort(
      (a, b) =>
        Number(a.project === null) - Number(b.project === null) ||
        (a.project?.name ?? '').localeCompare(b.project?.name ?? ''),
    );
}

function push<T>(groups: Map<string, T[]>, key: string | null, item: T) {
  const k = key ?? GENERAL;
  groups.set(k, [...(groups.get(k) ?? []), item]);
}

/**
 * The recap for `today`'s window. Archived projects (and what is in them)
 * are left out; `assignee` narrows Closed and Added, as it narrows Due.
 */
export function buildRecap(
  snapshot: Pick<
    Snapshot,
    'projects' | 'tasks' | 'notes' | 'meetings' | 'people' | 'activity'
  >,
  today: DateString,
  assignee: AssigneeFilter = { kind: 'anyone' },
): Recap {
  const window = recapWindow(today);
  const { projects } = snapshot;
  const inWindow = (timestamp: Timestamp) => {
    const day = dayOf(timestamp);
    return day >= window.from && day <= window.to;
  };
  const kept = (projectId: string | null) =>
    projectId === null || !projects[projectId]?.archived;
  const me = meId(snapshot.people);

  const closed = new Map<string, Task[]>();
  const added: Task[] = [];
  for (const t of Object.values(snapshot.tasks)) {
    if (!kept(t.projectId) || !matchesAssignee(t, assignee, me)) continue;
    if (t.status === 'done' && t.completedAt && inWindow(t.completedAt)) {
      push(closed, t.projectId, t);
    }
    if (inWindow(t.createdAt)) added.push(t);
  }
  for (const list of closed.values()) {
    list.sort((a, b) =>
      (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
    );
  }
  added.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );

  const meetings: RecapMeeting[] = Object.values(snapshot.meetings)
    .filter(
      (m) => m.date >= window.from && m.date <= window.to && kept(m.projectId),
    )
    .sort(byWhen)
    .map((meeting) => {
      const topics = topicsOf(meeting);
      const items = tasksOfMeeting(snapshot.tasks, meeting.id);
      return {
        meeting,
        topics: topics.length,
        covered: topics.filter((t) => t.done).length,
        actionItems: [...items.open, ...items.done],
        notes: notesOfMeeting(snapshot.notes, meeting.id),
      };
    });

  const notes = new Map<string, Note[]>();
  for (const n of Object.values(snapshot.notes)) {
    if (n.scratch || !kept(n.projectId) || !inWindow(n.createdAt)) continue;
    push(notes, n.projectId, n);
  }
  for (const list of notes.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const activity: RecapActivity[] = [];
  for (const [key, log] of Object.entries(snapshot.activity)) {
    const project = key === GENERAL ? null : projects[key];
    if (project === undefined || project?.archived) continue;
    const lines = log.events.filter(
      (e) => inWindow(e.t) && !COVERED.some((re) => re.test(e.text)),
    );
    if (lines.length === 0) continue;
    activity.push({
      project,
      items: lines.slice(0, RECAP_ACTIVITY_CAP),
      more: Math.max(0, lines.length - RECAP_ACTIVITY_CAP),
    });
  }
  activity.sort(
    (a, b) =>
      Number(a.project === null) - Number(b.project === null) ||
      (a.project?.name ?? '').localeCompare(b.project?.name ?? ''),
  );

  return {
    window,
    closed: byProject(closed, projects),
    added,
    meetings,
    notes: byProject(notes, projects),
    activity,
  };
}

/** How many of each the recap holds. */
export interface RecapCounts {
  closed: number;
  added: number;
  meetings: number;
  notes: number;
  /** Activity lines, the ones past the cap included. */
  activity: number;
}

export function recapCounts(recap: Recap): RecapCounts {
  const sum = (groups: { items: unknown[] }[]) =>
    groups.reduce((n, g) => n + g.items.length, 0);
  return {
    closed: sum(recap.closed),
    added: recap.added.length,
    meetings: recap.meetings.length,
    notes: sum(recap.notes),
    activity: recap.activity.reduce((n, g) => n + g.items.length + g.more, 0),
  };
}

/** Nothing happened in the window (that the filter shows). */
export function recapEmpty(recap: Recap): boolean {
  const c = recapCounts(recap);
  return c.closed + c.added + c.meetings + c.notes + c.activity === 0;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The header line: "Yesterday: 4 closed · 2 added · 2 meetings · 3
 * notes", each part only when it is not zero. With none of those, the
 * activity lines' count ("Since Friday: 2 updates"); `''` when empty.
 */
export function recapLine(recap: Recap): string {
  const c = recapCounts(recap);
  const parts = [
    c.closed > 0 && `${c.closed} closed`,
    c.added > 0 && `${c.added} added`,
    c.meetings > 0 && plural(c.meetings, 'meeting'),
    c.notes > 0 && plural(c.notes, 'note'),
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0 && c.activity > 0) {
    parts.push(plural(c.activity, 'update'));
  }
  return parts.length === 0
    ? ''
    : `${recap.window.label}: ${parts.join(' · ')}`;
}

/**
 * A held meeting's one line: "3 of 4 topics covered · 2 action items · 1
 * note", each part only when it is not zero; `''` when none is.
 */
export function recapMeetingLine(m: RecapMeeting): string {
  const parts: string[] = [];
  if (m.topics > 0) {
    parts.push(`${m.covered} of ${plural(m.topics, 'topic')} covered`);
  }
  if (m.actionItems.length > 0) {
    parts.push(plural(m.actionItems.length, 'action item'));
  }
  if (m.notes.length > 0) parts.push(plural(m.notes.length, 'note'));
  return parts.join(' · ');
}
