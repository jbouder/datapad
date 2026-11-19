/**
 * The capture line (#330), the pure half: what a typed line means, the
 * chips that say so, the ops that save it, the ops that undo it and the
 * toast that says where it went.
 *
 * A plain line is a note. `[ ]`, `todo` or a date makes it a task; a
 * leading `?`, `decide:` or a closing `?` something to decide; `waiting
 * on @Name` a task blocked on that person. `#word` files it under the one
 * project whose name (letters and digits only) starts with the word;
 * `@Name` mentions someone and, on a task or a decision, assigns it to
 * them. A room's context presets the project or the person.
 *
 * Settings → Capture (#343) changes three of those: a plain line can be a
 * task instead (`captureAs`), `@Name` can leave a task unassigned
 * (`mentionAssigns`), and a note in a room can go to Scratch rather than
 * the room (`roomNotes`). New tasks start at the space's default
 * priority. The defaults are in `DEFAULT_SETTINGS`.
 */
import { formatDay, parseDate } from './dates';
import { LIMITS } from './limits';
import { parseTime } from './meetings';
import { mentionedIds, namesToTokens } from './mentions';
import { orgByName } from './orgs';
import { planInlineAdd } from './people';
import type { BaseOp } from './protocol';
import { meId } from './select';
import { defaultAssignee, defaultDue, defaultPriority } from './tasks';
import {
  type DateString,
  type Project,
  type Snapshot,
  settingsOf,
  type TimeString,
} from './types';

/** The kinds the chip (click or Tab) cycles through. */
export const CAPTURE_KINDS = ['note', 'task', 'decide', 'wait'] as const;
/** What only a `/` command makes (#375). */
export const CREATE_KINDS = [
  'meeting',
  'milestone',
  'project',
  'person',
] as const;
export type CreateKind = (typeof CREATE_KINDS)[number];
export type CaptureKind = (typeof CAPTURE_KINDS)[number] | CreateKind;

export const KIND_LABELS: Record<CaptureKind, string> = {
  note: 'Note',
  task: 'Task',
  decide: 'To decide',
  wait: 'Waiting on',
  meeting: 'Meeting',
  milestone: 'Milestone',
  project: 'Project',
  person: 'Person',
};

/** The kind after `kind`, for the chip (click or Tab). */
export function nextKind(kind: CaptureKind): CaptureKind {
  const at = (CAPTURE_KINDS as readonly CaptureKind[]).indexOf(kind);
  return CAPTURE_KINDS[(at + 1) % CAPTURE_KINDS.length] ?? 'note';
}

export function isCreateKind(kind: CaptureKind): kind is CreateKind {
  return (CREATE_KINDS as readonly CaptureKind[]).includes(kind);
}

/**
 * The `/` words that set what a line makes, in both the capture line and
 * the note composer (#375). The composer's `COMMANDS` carry the same words.
 */
export const SLASH_KINDS: Readonly<Record<string, CaptureKind>> = {
  note: 'note',
  task: 'task',
  decide: 'decide',
  waiting: 'wait',
  meeting: 'meeting',
  milestone: 'milestone',
  project: 'project',
  person: 'person',
};

/** A leading `/word` naming one of `SLASH_KINDS`, and what follows it. */
const SLASH = /^\/([a-z]+)(?=\s|$)\s*/i;

/** The kind a leading `/word` names, and the text without it. */
export function slashKind(
  text: string,
): { kind: CaptureKind; rest: string } | null {
  const m = SLASH.exec(text);
  const kind = m ? SLASH_KINDS[(m[1] ?? '').toLowerCase()] : undefined;
  if (!m || !kind) return null;
  return { kind, rest: text.slice(m[0].length) };
}

/**
 * Where the line is: a room presets its project or person, a note its
 * project and meeting.
 */
export interface CaptureContext {
  projectId?: string | null;
  personId?: string | null;
  /** A meeting's note: tasks are its action items, notes its notes. */
  meetingId?: string | null;
  /** The note the line is in: a task made from it links back. */
  noteId?: string | null;
  /**
   * The line comes from a note in `projectId`: a note made from it stays
   * there, whatever Settings → Capture says about notes in rooms.
   */
  fromNote?: boolean;
}

export interface Capture {
  kind: CaptureKind;
  /** The text with the filing words taken out, mentions as `@{id}`. */
  text: string;
  projectId: string | null;
  /** A task's due day, a meeting's or a milestone's day; empty on a note. */
  due: DateString | '';
  /** A meeting's start time, or empty. */
  time: TimeString | '';
  /** A meeting's note: tasks are its action items. */
  meetingId: string | null;
  /** The note a task was made from (`sourceNoteId`). */
  noteId: string | null;
  /** The people the text mentions, in order. */
  people: string[];
  /** A task's or a decision's assignee (`''` for nobody). */
  assignee: string;
  /** Who a waiting-on task waits on; null when nobody is named. */
  waitingOn: string | null;
  /**
   * A note with no project and no one mentioned: it goes to Scratch.
   * Not `Note.scratch`, the old Notepad flag.
   */
  toScratch: boolean;
}

const TASK_PREFIX = /^(?:[-*]\s*)?(?:\[\s?\]|todo:?)(?:\s+|$)/i;
const DECIDE_PREFIX = /^(?:decide:\s*|\?\s*)/i;
const DECIDE_SUFFIX = /\?\s*$/;
const WAIT_PREFIX = /^waiting (?:on|for)\s+/i;
const DUE_WORD = /^(?:due|by|on)$/i;
/** Words that are usually just words, unless due, by or on comes first. */
const AMBIGUOUS = /^(?:sat|sun|mon|wed|tod|tom)$/i;
/** A `#word`: letters and digits, after a space or at the start. */
const HASH = /(^|\s)#([\p{L}\p{N}]+)(?=$|[\s.,;:!?)])/gu;

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A project's name as a `#word` matches it: letters and digits, lower case. */
export function projectSlug(name: string): string {
  return name.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

/** The open projects a `#word` could mean, best first (an exact name wins). */
export function projectsFor(word: string, state: Snapshot): Project[] {
  const want = word.toLowerCase();
  const open = Object.values(state.projects).filter((p) => !p.archived);
  const exact = open.filter((p) => projectSlug(p.name) === want);
  if (exact.length > 0) return exact;
  return open
    .filter((p) => projectSlug(p.name).startsWith(want))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The project a `#word` no project is called would create: the word as its
 * name, in the default org (Settings → Orgs). Null when the word is too
 * short or a project, archived or not, already has that name.
 */
export function newProjectFor(
  word: string,
  state: Snapshot,
): { name: string; org: string; orgId?: string } | null {
  const want = projectSlug(word);
  if (want.length < 2 || want !== word.toLowerCase()) return null;
  const taken = Object.values(state.projects).some(
    (p) => projectSlug(p.name) === want,
  );
  if (taken) return null;
  const org = settingsOf(state).defaultOrg;
  const orgId = org ? orgByName(state.orgs, org)?.id : undefined;
  return { name: word, org, ...(orgId ? { orgId } : {}) };
}

/** The one project a `#word` names, or null for none or several. */
export function projectFor(word: string, state: Snapshot): string | null {
  const hits = projectsFor(word, state);
  return hits.length === 1 ? (hits[0]?.id ?? null) : null;
}

/**
 * The first date in the words: three words ("in 3 days"), then two ("next
 * fri"), then one ("fri", "+3d", "10/31"), with a due, by or on in front
 * taken out with it. Mentions and `#words` are never dates.
 */
function findDate(
  words: string[],
  today: DateString,
): { due: DateString; rest: string[] } | null {
  for (let i = 0; i < words.length; i += 1) {
    for (const span of [3, 2, 1]) {
      if (i + span > words.length) continue;
      const chunk = words.slice(i, i + span);
      if (chunk.some((w) => /^[@#]/.test(w))) continue;
      const text = chunk.join(' ').replace(/[.,;:!?]+$/, '');
      if (/^now$/i.test(text)) continue;
      const after = DUE_WORD.test(words[i - 1] ?? '');
      if (span === 1 && AMBIGUOUS.test(text) && !after) continue;
      const day = parseDate(text, today);
      if (day) {
        const start = after ? i - 1 : i;
        return {
          due: day,
          rest: [...words.slice(0, start), ...words.slice(i + span)],
        };
      }
    }
  }
  return null;
}

/** A time word: `10am`, `2:30pm`, `14:30`, `noon`; any time after `at`. */
const TIME_WORD = /^(?:\d{1,2}(?::\d{2})?(?:am|pm|a|p)|\d{1,2}:\d{2}|noon)$/i;

/** The first time in the words, with an `at` in front taken out with it. */
function findTime(
  words: string[],
): { time: TimeString; rest: string[] } | null {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const next = words[i + 1] ?? '';
    const after = /^at$/i.test(words[i - 1] ?? '');
    const start = after ? i - 1 : i;
    // "2 pm": the number and its half as one.
    if (/^\d{1,2}(?::\d{2})?$/.test(word) && /^(?:am|pm)$/i.test(next)) {
      const time = parseTime(`${word}${next}`);
      if (time) {
        return {
          time,
          rest: [...words.slice(0, start), ...words.slice(i + 2)],
        };
      }
    }
    if (!TIME_WORD.test(word) && !after) continue;
    const time = parseTime(word.replace(/[.,;:!?]+$/, ''));
    if (time) {
      return { time, rest: [...words.slice(0, start), ...words.slice(i + 1)] };
    }
  }
  return null;
}

/** Take the first `#word` that names one project out of the text. */
function takeProject(
  input: string,
  state: Snapshot,
): { text: string; projectId: string | null } {
  let projectId: string | null = null;
  const text = input.replace(HASH, (whole, lead: string, word: string) => {
    if (projectId) return whole;
    const id = projectFor(word, state);
    if (!id) return whole;
    projectId = id;
    return lead;
  });
  return { text, projectId };
}

/**
 * A line after `/meeting`, `/milestone`, `/project` or `/person` (#375).
 * A project's or a person's line is its name. A meeting reads a `#word`,
 * `@Name`s (its attendees), a day (today when none) and a time; a
 * milestone a `#word` and a day.
 */
function parseCreate(
  kind: CreateKind,
  input: string,
  state: Snapshot,
  today: DateString,
  context: CaptureContext,
): Capture {
  const base = {
    kind,
    due: '' as const,
    time: '' as const,
    people: [],
    assignee: '',
    waitingOn: null,
    meetingId: null,
    noteId: null,
    toScratch: false,
  };
  if (kind === 'project' || kind === 'person') {
    const name = squash(input).replace(/^@/, '');
    return { ...base, text: name, projectId: null };
  }
  const taken = takeProject(input, state);
  let projectId = taken.projectId;
  let text = namesToTokens(squash(taken.text), state.people);
  let due: DateString | '' = '';
  let time: TimeString | '' = '';
  if (kind === 'meeting') {
    const found = findTime(text.split(' '));
    if (found) {
      time = found.time;
      text = found.rest.join(' ');
    }
  }
  const found = findDate(text.split(' '), today);
  if (found) {
    due = found.due;
    text = found.rest.join(' ');
  }
  text = squash(text);
  if (!projectId && context.projectId && state.projects[context.projectId]) {
    projectId = context.projectId;
  }
  if (kind === 'milestone') return { ...base, text, projectId, due };
  const people = mentionedIds(text);
  const roomPerson =
    context.personId && state.people[context.personId]
      ? context.personId
      : null;
  if (roomPerson && !people.includes(roomPerson)) people.push(roomPerson);
  return { ...base, text, projectId, due: due || today, time, people };
}

/**
 * What a typed line means. `force` is the kind the chip was flipped to: a
 * forced note keeps its date words as text. A leading `/word`
 * (`SLASH_KINDS`) forces its kind the same way and goes from the text.
 */
export function parseCapture(
  input: string,
  state: Snapshot,
  today: DateString,
  context: CaptureContext = {},
  force?: CaptureKind,
): Capture {
  const settings = settingsOf(state);
  let text = squash(input);
  const slash = slashKind(text);
  if (slash) {
    text = slash.rest;
    force = slash.kind;
  }
  if (force && isCreateKind(force)) {
    return parseCreate(force, text, state, today, context);
  }
  let kind: CaptureKind = settings.captureAs;
  if (WAIT_PREFIX.test(text)) {
    kind = 'wait';
    text = text.replace(WAIT_PREFIX, '');
  } else if (DECIDE_PREFIX.test(text)) {
    kind = 'decide';
    text = text.replace(DECIDE_PREFIX, '');
  } else if (TASK_PREFIX.test(text)) {
    kind = 'task';
    text = text.replace(TASK_PREFIX, '');
  } else if (/^decide\b/i.test(text) || DECIDE_SUFFIX.test(text)) {
    kind = 'decide';
  }

  const taken = takeProject(text, state);
  let projectId = taken.projectId;
  text = taken.text;

  text = namesToTokens(squash(text), state.people);

  let due: DateString | '' = '';
  if (force !== 'note') {
    const found = findDate(text.split(' '), today);
    if (found) {
      due = found.due;
      text = found.rest.join(' ');
      if (kind === 'note') kind = 'task';
    }
  }
  text = squash(text);
  if (force) kind = force;
  // A task with no date in the line is due when Settings → Capture says.
  if (kind === 'note') due = '';
  else if (!due) due = defaultDue(state, today);

  const people = mentionedIds(text);
  const roomPerson =
    context.personId && state.people[context.personId]
      ? context.personId
      : null;
  // A note in a room can go to Scratch instead, unless a `#word` filed it.
  const roomFiles =
    kind !== 'note' || settings.roomNotes === 'room' || context.fromNote;
  if (
    !projectId &&
    roomFiles &&
    context.projectId &&
    state.projects[context.projectId]
  ) {
    projectId = context.projectId;
  }

  let assignee = '';
  let waitingOn: string | null = null;
  if (kind === 'wait') {
    waitingOn = people[0] ?? roomPerson;
    // "waiting on @Chewbacca the parts list": the chip says who.
    const lead = waitingOn ? `@{${waitingOn}}` : '';
    if (lead && text.startsWith(lead)) {
      text = text.slice(lead.length).trim();
    }
    assignee = defaultAssignee(state);
  } else if (kind === 'task' || kind === 'decide') {
    // `@Name` assigns unless Settings → Capture says it only mentions.
    const named = settings.mentionAssigns ? people[0] : undefined;
    assignee = named ?? roomPerson ?? defaultAssignee(state);
  } else if (roomPerson && !people.includes(roomPerson)) {
    // A note in a person's room mentions them, so it files there.
    text = text ? `${text} @{${roomPerson}}` : `@{${roomPerson}}`;
    people.push(roomPerson);
  }

  const meetingId =
    context.meetingId && state.meetings[context.meetingId]
      ? context.meetingId
      : null;
  const toScratch =
    kind === 'note' && !projectId && !meetingId && people.length === 0;
  return {
    kind,
    text,
    projectId,
    due,
    time: '',
    meetingId,
    noteId:
      context.noteId && state.notes[context.noteId] ? context.noteId : null,
    people,
    assignee,
    waitingOn,
    toScratch,
  };
}

/** Captured text as a task's title: mentions back to names. */
export function plainTitle(text: string, state: Snapshot): string {
  return text.replace(
    /@\{([^}]+)\}/g,
    (_, id: string) => state.people[id]?.name ?? 'someone',
  );
}

/** A task's, meeting's or milestone's title from a capture, within the limit. */
function titleOf(capture: Capture, state: Snapshot): string {
  const title = plainTitle(capture.text, state).trim();
  if (title) return title.slice(0, LIMITS.titleMax);
  const on = capture.waitingOn ? state.people[capture.waitingOn]?.name : '';
  return on ? `Hear back from ${on}` : '';
}

/** A project called `name` already, ignoring case. */
function projectNamed(name: string, state: Snapshot): boolean {
  const want = name.trim().toLowerCase();
  return Object.values(state.projects).some(
    (p) => p.name.trim().toLowerCase() === want,
  );
}

/** What stops a capture from saving, in words; null when nothing does. */
export function captureProblem(
  capture: Capture,
  state: Snapshot,
): string | null {
  const name = capture.text.trim();
  switch (capture.kind) {
    case 'project':
      if (!name) return null;
      if (name.length > LIMITS.nameMax) return 'Name too long';
      return projectNamed(name, state) ? 'Already a project' : null;
    case 'person': {
      const plan = planInlineAdd(state.people, name);
      if (plan.kind === 'existing') return 'Already in People';
      return plan.kind === 'tooLong' ? 'Name too long' : null;
    }
    case 'milestone':
      if (!capture.projectId) return 'Needs a #project';
      return capture.due ? null : 'Needs a date';
    default:
      return null;
  }
}

/** Whether there is something to save. */
export function canSave(capture: Capture, state: Snapshot): boolean {
  if (captureProblem(capture, state)) return false;
  switch (capture.kind) {
    case 'note':
    case 'project':
    case 'person':
      return capture.text.trim() !== '';
    default:
      return titleOf(capture, state) !== '';
  }
}

export interface CaptureChip {
  kind: 'kind' | 'project' | 'person' | 'date' | 'scratch' | 'problem';
  label: string;
}

/** What the line will become and where it will go, in words. */
export function captureChips(
  capture: Capture,
  state: Snapshot,
  today: DateString,
): CaptureChip[] {
  const name = (id: string) => state.people[id]?.name ?? 'someone';
  const me = meId(state.people);
  const chips: CaptureChip[] = [
    { kind: 'kind', label: KIND_LABELS[capture.kind] },
  ];
  if (capture.projectId) {
    const project = state.projects[capture.projectId];
    if (project) chips.push({ kind: 'project', label: project.name });
  }
  if (capture.waitingOn) {
    chips.push({
      kind: 'person',
      label: `waiting on ${name(capture.waitingOn)}`,
    });
  }
  if (capture.assignee && capture.kind !== 'wait') {
    const label =
      capture.assignee === me ? 'for you' : `for ${name(capture.assignee)}`;
    chips.push({ kind: 'person', label });
  }
  for (const id of capture.people) {
    if (id === capture.waitingOn || id === capture.assignee) continue;
    chips.push({ kind: 'person', label: `@${name(id)}` });
  }
  if (capture.due) {
    const day = formatDay(capture.due, today);
    const label =
      capture.kind === 'meeting'
        ? `${day}${capture.time ? ` at ${capture.time}` : ''}`
        : capture.kind === 'milestone'
          ? `By ${day}`
          : `Due ${day}`;
    chips.push({ kind: 'date', label });
  }
  if (capture.toScratch) chips.push({ kind: 'scratch', label: 'Scratch' });
  const problem = captureProblem(capture, state);
  if (problem) chips.push({ kind: 'problem', label: problem });
  return chips;
}

/**
 * The ops that save a capture, with `id` for the new document: a note, a
 * task (to decide or not), a task and its blocker in one batch, a
 * meeting, a milestone, a project or a person.
 */
export function captureOps(
  capture: Capture,
  state: Snapshot,
  id: string,
): BaseOp[] {
  const meeting = capture.meetingId ? { meetingId: capture.meetingId } : {};
  switch (capture.kind) {
    case 'note':
      return [
        {
          type: 'addNote',
          id,
          projectId: capture.projectId,
          body: capture.text.trim(),
          ...meeting,
        },
      ];
    case 'meeting':
      return [
        {
          type: 'addMeeting',
          id,
          projectId: capture.projectId,
          title: titleOf(capture, state),
          date: capture.due,
          ...(capture.time ? { time: capture.time } : {}),
          attendees: capture.people,
        },
      ];
    case 'milestone':
      return capture.projectId
        ? [
            {
              type: 'addMilestone',
              projectId: capture.projectId,
              id,
              title: titleOf(capture, state),
              date: capture.due,
            },
          ]
        : [];
    case 'project': {
      const org = settingsOf(state).defaultOrg;
      const orgId = org ? orgByName(state.orgs, org)?.id : undefined;
      return [
        {
          type: 'createProject',
          id,
          name: capture.text.trim(),
          org,
          ...(orgId ? { orgId } : {}),
        },
      ];
    }
    case 'person':
      return [{ type: 'addPerson', id, name: capture.text.trim() }];
  }
  const add: BaseOp = {
    type: 'addTask',
    id,
    projectId: capture.projectId,
    ...meeting,
    ...(capture.noteId ? { sourceNoteId: capture.noteId } : {}),
    title: titleOf(capture, state),
    priority: defaultPriority(state),
    due: capture.due,
    assignee: capture.assignee,
    ...(capture.kind === 'decide' ? { decide: true } : {}),
  };
  if (capture.kind !== 'wait') return [add];
  return [
    add,
    {
      type: 'setBlocked',
      id,
      blocked: { on: capture.waitingOn, note: '' },
    },
  ];
}

/**
 * The op that takes back what `captureOps` saved under `id`; a milestone
 * needs its project.
 */
export function undoCaptureOp(
  kind: CaptureKind,
  id: string,
  projectId: string | null = null,
): BaseOp {
  switch (kind) {
    case 'note':
      return { type: 'deleteNote', id };
    case 'meeting':
      return { type: 'deleteMeeting', id };
    case 'milestone':
      return { type: 'deleteMilestone', projectId: projectId ?? '', id };
    case 'project':
      return { type: 'deleteProject', id };
    case 'person':
      return { type: 'removePerson', id };
    default:
      return { type: 'deleteTask', id };
  }
}

/** The toast after saving: what it became and where it went. */
export function captureToast(capture: Capture, state: Snapshot): string {
  const project = capture.projectId
    ? state.projects[capture.projectId]?.name
    : undefined;
  const person = capture.people[0]
    ? state.people[capture.people[0]]?.name
    : undefined;
  const name = capture.text.trim();
  switch (capture.kind) {
    case 'project':
      return `Created ${name}`;
    case 'person':
      return `Added ${name} to People`;
    case 'meeting':
      return `Added a meeting to ${project ?? 'General'}`;
    case 'milestone':
      return `Added a milestone to ${project ?? 'the project'}`;
  }
  if (capture.kind === 'note') {
    if (project) return `Added a note to ${project}`;
    if (person) return `Added a note about ${person}`;
    return 'Added a note to Scratch';
  }
  const where = project ?? 'General';
  const meeting = capture.meetingId
    ? state.meetings[capture.meetingId]?.title
    : undefined;
  if (meeting && capture.kind === 'task') {
    return `Added an action item to ${meeting}`;
  }
  if (capture.kind === 'decide') return `Added to decide in ${where}`;
  if (capture.kind === 'wait') {
    const on = capture.waitingOn ? state.people[capture.waitingOn]?.name : '';
    return on
      ? `Waiting on ${on}, in ${where}`
      : `Added a waiting-on task to ${where}`;
  }
  return `Added a task to ${where}`;
}

/**
 * The `#word` being typed at `caret`, for the project menu: `#` then
 * letters and digits, starting the text or after a space.
 */
export function hashQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)#([\p{L}\p{N}]{0,30})$/u.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}

/** What a picked project puts in the line: `#` and its slug, as cased. */
export function projectWord(name: string): string {
  return `#${name.replace(/[^\p{L}\p{N}]/gu, '')}`;
}
