/**
 * A room's stream and its person filter (#334), as pure functions. The
 * stream is one list of everything attached to a room, newest first:
 * notes, tasks (once when added, again when done), meetings and
 * milestones. A project's room narrows it, and its lanes, to one person
 * with `?person=` (`projectKeep`); the person's room (#335) builds its
 * own from the same parts.
 *
 * Every `at` is on the local calendar (`YYYY-MM-DDTHH:MM`), so a meeting
 * at 14:00 and a note written at 14:05 fall in the order you lived them.
 */
import { dayOf } from './dates';
import { taskTouches } from './loops';
import { mentionedIds } from './mentions';
import { nextMilestone } from './milestones';
import { localTime } from './today';
import {
  type DateString,
  healthOf,
  type Meeting,
  type Milestone,
  milestonesOf,
  type Note,
  type Person,
  type Project,
  type ProjectHealth,
  type Snapshot,
  type Task,
} from './types';

export type StreamItem =
  | { kind: 'note'; key: string; at: string; note: Note }
  | {
      kind: 'task';
      key: string;
      at: string;
      task: Task;
      /** Added, or done (a done task is in the stream twice). */
      event: 'added' | 'done';
    }
  | { kind: 'meeting'; key: string; at: string; meeting: Meeting }
  | {
      kind: 'milestone';
      key: string;
      at: string;
      milestone: Milestone;
      projectId: string;
    };

/** A timestamp as a local `YYYY-MM-DDTHH:MM`. */
function localAt(timestamp: string): string {
  return `${dayOf(timestamp)}T${localTime(timestamp)}`;
}

/** What a stream is made of; each part already narrowed to the room. */
export interface StreamParts {
  notes: readonly Note[];
  tasks: readonly Task[];
  meetings: readonly Meeting[];
  milestones?: readonly { projectId: string; milestone: Milestone }[];
}

/** Kind order within one minute: the meeting, then the rest as Today has it. */
const KIND_ORDER: Record<string, number> = {
  meeting: 0,
  milestone: 1,
  note: 2,
  added: 3,
  done: 4,
};

function rank(item: StreamItem): number {
  return KIND_ORDER[item.kind === 'task' ? item.event : item.kind] ?? 9;
}

/**
 * The stream, newest first: a note at when it was written, a task when
 * it was added and (if done) when it was done, a meeting at its day and
 * time (an untimed one at the start of its day), a milestone at its day.
 * Upcoming meetings and milestones sit first (`splitStream` takes them
 * out). Ties go meeting, milestone, note, added, done, then by key.
 */
export function buildStream(parts: StreamParts): StreamItem[] {
  const out: StreamItem[] = [];
  for (const note of parts.notes) {
    out.push({
      kind: 'note',
      key: `note:${note.id}`,
      at: localAt(note.createdAt),
      note,
    });
  }
  for (const task of parts.tasks) {
    out.push({
      kind: 'task',
      key: `added:${task.id}`,
      at: localAt(task.createdAt),
      task,
      event: 'added',
    });
    if (task.status === 'done' && task.completedAt) {
      out.push({
        kind: 'task',
        key: `done:${task.id}`,
        at: localAt(task.completedAt),
        task,
        event: 'done',
      });
    }
  }
  for (const meeting of parts.meetings) {
    out.push({
      kind: 'meeting',
      key: `meeting:${meeting.id}`,
      at: `${meeting.date}T${meeting.time || '00:00'}`,
      meeting,
    });
  }
  for (const { projectId, milestone } of parts.milestones ?? []) {
    out.push({
      kind: 'milestone',
      key: `milestone:${milestone.id}`,
      at: `${milestone.date}T00:00`,
      milestone,
      projectId,
    });
  }
  return out.sort(
    (a, b) =>
      b.at.localeCompare(a.at) ||
      rank(a) - rank(b) ||
      a.key.localeCompare(b.key),
  );
}

/** Now on the local calendar, as a stream item's `at` reads. */
export function streamNow(when: number | Date): string {
  return localAt(new Date(when).toISOString());
}

/**
 * A stream split at `now` (`streamNow`): what is still to come (meetings
 * and milestones ahead), soonest first, and the rest, newest first. A
 * room shows the first as Coming up over the stream, so what you just
 * captured is on top of the stream.
 */
export function splitStream(
  items: readonly StreamItem[],
  now: string,
): { upcoming: StreamItem[]; past: StreamItem[] } {
  const upcoming: StreamItem[] = [];
  const past: StreamItem[] = [];
  for (const item of items) (item.at > now ? upcoming : past).push(item);
  return { upcoming: upcoming.reverse(), past };
}

/** A note mentions the person. */
export function noteTouches(note: Pick<Note, 'body'>, personId: string) {
  return mentionedIds(note.body).includes(personId);
}

/** The person is at the meeting. */
export function meetingTouches(
  meeting: Pick<Meeting, 'attendees'>,
  personId: string,
): boolean {
  return meeting.attendees.includes(personId);
}

/**
 * Which tasks a project's room keeps: the project's, and with `person`
 * only those that touch them (`taskTouches`). For `lanesOf`.
 */
export function projectKeep(
  projectId: string,
  person?: string | null,
): (task: Task) => boolean {
  return (task) =>
    task.projectId === projectId && (!person || taskTouches(task, person));
}

/**
 * A project's stream: its notes (not `hidden`, the ones deleted a moment
 * ago with Undo still offered), tasks, meetings and milestones. With
 * `person`, only what touches them: tasks by `taskTouches`, notes that
 * mention them, meetings they attend; milestones name nobody, so they
 * drop out.
 */
export function projectStream(
  state: Pick<Snapshot, 'notes' | 'tasks' | 'meetings' | 'projects'>,
  projectId: string,
  person?: string | null,
  hidden: ReadonlySet<string> = new Set(),
): StreamItem[] {
  const project = state.projects[projectId];
  const notes = Object.values(state.notes).filter(
    (n) =>
      n.projectId === projectId &&
      !hidden.has(n.id) &&
      (!person || noteTouches(n, person)),
  );
  const keep = projectKeep(projectId, person);
  const tasks = Object.values(state.tasks).filter(keep);
  const meetings = Object.values(state.meetings).filter(
    (m) => m.projectId === projectId && (!person || meetingTouches(m, person)),
  );
  const milestones =
    project && !person
      ? milestonesOf(project).map((milestone) => ({ projectId, milestone }))
      : [];
  return buildStream({ notes, tasks, meetings, milestones });
}

/**
 * The people a project's room can be narrowed to: its members first (in
 * the project's order), then anyone its tasks touch (assigned, blocked
 * on, mentioned), by name. Each once; people who no longer exist are
 * left out.
 */
export function roomPeople(
  state: Pick<Snapshot, 'tasks' | 'people' | 'projects'>,
  projectId: string,
): Person[] {
  const project = state.projects[projectId];
  const seen = new Set<string>();
  const members: Person[] = [];
  for (const id of project?.members ?? []) {
    const p = state.people[id];
    if (p && !seen.has(id)) {
      seen.add(id);
      members.push(p);
    }
  }
  const touched: Person[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    const p = state.people[id];
    if (!p) return;
    seen.add(id);
    touched.push(p);
  };
  for (const task of Object.values(state.tasks)) {
    if (task.projectId !== projectId) continue;
    add(task.assignee);
    add(task.blocked?.on);
    for (const id of mentionedIds(task.desc)) add(id);
  }
  touched.sort((a, b) => a.name.localeCompare(b.name));
  return [...members, ...touched];
}

/** Health in a state line: the color as a word; empty when not judged. */
const HEALTH_WORDS: Record<ProjectHealth, string> = {
  none: '',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
};

/**
 * A project room's state line, as its parts: health (when judged),
 * status when not active, the target date, the next milestone and how
 * many loops are open. `day` formats a date for the reader.
 */
export function projectStateLine(
  project: Project,
  open: number,
  today: DateString,
  day: (date: DateString) => string,
): string[] {
  const health = HEALTH_WORDS[healthOf(project)];
  const next = nextMilestone(project, today);
  const parts: string[] = [];
  if (health) parts.push(health);
  if (project.archived) parts.push('Archived');
  if (project.status === 'paused') parts.push('Paused');
  if (project.status === 'done') parts.push('Done');
  if (project.targetDate) parts.push(`Target ${day(project.targetDate)}`);
  if (next) parts.push(`Next: ${next.title}, ${day(next.date)}`);
  parts.push(open === 0 ? 'Nothing open' : `${open} open`);
  return parts;
}
