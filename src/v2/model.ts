/**
 * Prototype (Day, Rooms, All): the pure half. What a capture line
 * means, the three lanes of open loops, the Unfiled pile and a day's
 * timeline, all read from the existing snapshot. Nothing here is a new
 * field or op: a "decide" item is a task tagged `decide`, "waiting on" is
 * a blocked task or one assigned to someone else, and Unfiled is a General
 * note that mentions nobody.
 */
import { addDays, dayOf, parseDate } from '#shared/dates';
import { mentionedIds, namesToTokens } from '#shared/mentions';

import {
  blockedOf,
  type DateString,
  type Meeting,
  type Note,
  type Snapshot,
  type Task,
} from '#shared/types';

export const DECIDE_TAG = 'decide';

export const CAPTURE_KINDS = ['note', 'task', 'decide', 'wait'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const KIND_LABELS: Record<CaptureKind, string> = {
  note: 'Note',
  task: 'Task',
  decide: 'To decide',
  wait: 'Waiting on',
};

export interface Capture {
  kind: CaptureKind;
  /** The text with the filing words taken out, mentions as `@{id}`. */
  text: string;
  projectId: string | null;
  due: DateString | '';
  /** People the line mentions, in order. */
  people: string[];
}

/** Where the capture line is: a room presets its project or person. */
export interface CaptureContext {
  projectId?: string | null;
  personId?: string | null;
}

const TASK_PREFIX = /^(?:-\s*)?(?:\[\s?\]|todo:?|t:)\s+/i;
const DECIDE_PREFIX = /^(?:decide:?|\?)\s*/i;
const WAIT_PREFIX = /^(?:waiting on|wait(?:ing)?:?)\s+/i;
const DUE_WORD = /^(?:due|by|on)$/i;
const AMBIGUOUS = /^(?:sat|sun|wed|mon|tod|tom)$/i;

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The project a `#word` names: its name, letters and digits only, starts with it. */
function projectFor(word: string, state: Snapshot): string | null {
  const want = word.toLowerCase();
  const hits = Object.values(state.projects)
    .filter((p) => !p.archived)
    .filter((p) =>
      p.name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')
        .startsWith(want),
    );
  return hits.length === 1 ? (hits[0]?.id ?? null) : null;
}

/**
 * The first date in the words: a pair ("next fri") before a single word
 * ("fri", "+3d", "10/31"), with a "due"/"by" in front taken out with it.
 */
function findDate(
  words: string[],
  today: DateString,
): { due: DateString; rest: string[] } | null {
  for (let i = 0; i < words.length; i += 1) {
    for (const span of [2, 1]) {
      const chunk = words.slice(i, i + span).join(' ');
      if (span === 2 && i + 1 >= words.length) continue;
      if (/^now$/i.test(chunk)) continue;
      // Words that are usually just words, unless "due"/"by"/"on" says so.
      if (
        span === 1 &&
        AMBIGUOUS.test(chunk) &&
        !DUE_WORD.test(words[i - 1] ?? '')
      )
        continue;
      const day = parseDate(chunk, today);
      if (day) {
        const start = i > 0 && DUE_WORD.test(words[i - 1] ?? '') ? i - 1 : i;
        return {
          due: day,
          rest: [...words.slice(0, start), ...words.slice(i + span)],
        };
      }
    }
  }
  return null;
}

/**
 * What a typed line means. A plain line is a note. `[ ]`, `todo` or a
 * date makes a task; `decide` or a leading `?` something to decide;
 * `waiting on @Ana` a task blocked on Ana. `#proj` files it under a
 * project, `@Name` mentions someone. `force` is the kind the chip was
 * flipped to.
 */
export function parseCapture(
  input: string,
  state: Snapshot,
  today: DateString,
  context: CaptureContext = {},
  force?: CaptureKind,
): Capture {
  let text = input.trim();
  let kind: CaptureKind = 'note';
  if (WAIT_PREFIX.test(text)) {
    kind = 'wait';
    text = text.replace(WAIT_PREFIX, '');
  } else if (DECIDE_PREFIX.test(text) && /^(decide|\?)/i.test(text)) {
    kind = 'decide';
    text = text.replace(DECIDE_PREFIX, '');
  } else if (TASK_PREFIX.test(text)) {
    kind = 'task';
    text = text.replace(TASK_PREFIX, '');
  }

  let projectId: string | null = null;
  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (whole, lead, word) => {
    const id = projectFor(word, state);
    if (!id) return whole;
    projectId ??= id;
    return lead;
  });

  let due: DateString | '' = '';
  // A note keeps its words: only a task-like line gives up its date.
  const found = findDate(squash(text).split(' '), today);
  if (found && force !== 'note') {
    due = found.due;
    text = found.rest.join(' ');
    if (kind === 'note') kind = 'task';
  }

  text = namesToTokens(squash(text), state.people);
  const people = mentionedIds(text);

  if (force) kind = force;
  if (kind === 'note') due = '';
  if (!projectId && context.projectId) projectId = context.projectId;
  if (
    context.personId &&
    !people.includes(context.personId) &&
    state.people[context.personId]
  ) {
    people.push(context.personId);
    if (kind === 'note') text = `${text} @{${context.personId}}`;
  }
  return { kind, text, projectId, due, people };
}

/** A task's title from captured text: mentions back to names. */
export function plainTitle(text: string, state: Snapshot): string {
  return text.replace(
    /@\{([^}]+)\}/g,
    (_, id: string) => state.people[id]?.name ?? 'someone',
  );
}

/* ---------- open loops ---------- */

export interface Lanes {
  mine: Task[];
  /** Grouped by who it waits on; `''` for nobody listed. */
  waiting: { personId: string; tasks: Task[] }[];
  decide: Task[];
}

/** Who an open task waits on, or null when it is yours to do. */
export function waitingOn(task: Task, me: string | null): string | null {
  const blocked = blockedOf(task);
  if (blocked) return blocked.on ?? '';
  if (task.assignee && task.assignee !== me) return task.assignee;
  return null;
}

function byDue(a: Task, b: Task): number {
  const ad = a.due || '9999';
  const bd = b.due || '9999';
  return ad === bd ? a.order - b.order : ad < bd ? -1 : 1;
}

/** Open tasks, split three ways, optionally only those `keep` passes. */
export function lanesOf(
  state: Snapshot,
  me: string | null,
  keep: (task: Task) => boolean = () => true,
): Lanes {
  const mine: Task[] = [];
  const decide: Task[] = [];
  const waiting = new Map<string, Task[]>();
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'open' || !keep(task)) continue;
    const project = task.projectId ? state.projects[task.projectId] : null;
    if (project?.archived) continue;
    if (task.tags.includes(DECIDE_TAG)) {
      decide.push(task);
      continue;
    }
    const on = waitingOn(task, me);
    if (on === null) mine.push(task);
    else waiting.set(on, [...(waiting.get(on) ?? []), task]);
  }
  return {
    mine: mine.sort(byDue),
    decide: decide.sort(byDue),
    waiting: [...waiting.entries()]
      .map(([personId, tasks]) => ({ personId, tasks: tasks.sort(byDue) }))
      .sort((a, b) => b.tasks.length - a.tasks.length),
  };
}

/* ---------- Unfiled ---------- */

/** A note with no home: General, on no meeting or task, mentioning nobody. */
export function isUnfiled(note: Note): boolean {
  return (
    note.projectId === null &&
    !note.meetingId &&
    !note.taskId &&
    !note.scratch &&
    mentionedIds(note.body).length === 0
  );
}

export function unfiledNotes(state: Snapshot): Note[] {
  return Object.values(state.notes)
    .filter(isUnfiled)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------- a person's room ---------- */

/** Everything that ties a task to a person. */
export function taskTouches(task: Task, personId: string): boolean {
  return (
    task.assignee === personId ||
    blockedOf(task)?.on === personId ||
    mentionedIds(task.desc).includes(personId)
  );
}

/* ---------- a day ---------- */

export type DayEntry =
  | { kind: 'meeting'; at: string; meeting: Meeting }
  | { kind: 'done'; at: string; task: Task }
  | { kind: 'added'; at: string; task: Task }
  | { kind: 'note'; at: string; note: Note };

/** `HH:MM` local for a timestamp. */
export function localTime(timestamp: string): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * One day, in time order: its meetings (untimed ones first), and what was
 * done, added and written that day. `at` is `HH:MM` local.
 */
export function dayEntries(
  state: Snapshot,
  day: DateString,
  keep: (projectId: string | null) => boolean = () => true,
): DayEntry[] {
  const out: DayEntry[] = [];
  for (const meeting of Object.values(state.meetings)) {
    if (meeting.date === day && keep(meeting.projectId)) {
      out.push({ kind: 'meeting', at: meeting.time || '00:00', meeting });
    }
  }
  for (const task of Object.values(state.tasks)) {
    if (!keep(task.projectId)) continue;
    if (task.completedAt && dayOf(task.completedAt) === day) {
      out.push({ kind: 'done', at: localTime(task.completedAt), task });
    } else if (dayOf(task.createdAt) === day) {
      out.push({ kind: 'added', at: localTime(task.createdAt), task });
    }
  }
  for (const note of Object.values(state.notes)) {
    if (note.scratch || !keep(note.projectId)) continue;
    if (dayOf(note.createdAt) === day) {
      out.push({ kind: 'note', at: localTime(note.createdAt), note });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Open tasks due on `day`, or overdue too when `day` is today. */
export function dueOn(
  state: Snapshot,
  day: DateString,
  today: DateString,
): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.status === 'open' && t.due)
    .filter((t) => (day === today ? t.due <= day : t.due === day))
    .sort(byDue);
}

/** The next meeting from now on, today or later. */
export function nextMeetingFrom(
  meetings: Meeting[],
  today: DateString,
  nowHHMM: string,
): Meeting | null {
  const later = meetings
    .filter(
      (m) =>
        m.date > today ||
        (m.date === today && (m.end || m.time || '23:59') >= nowHHMM),
    )
    .sort((a, b) =>
      a.date === b.date
        ? (a.time || '').localeCompare(b.time || '')
        : a.date.localeCompare(b.date),
    );
  return later[0] ?? null;
}

/** Monday to Sunday around `day`. */
export function weekOf(day: DateString): DateString[] {
  const d = new Date(`${day}T12:00:00`);
  const monday = addDays(day, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
