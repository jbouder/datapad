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
 * (`mentionAssigns`), and a note in a room can go to Unfiled rather than
 * the room (`roomNotes`). New tasks start at the space's default
 * priority. The defaults are in `DEFAULT_SETTINGS`.
 */
import { formatDay, parseDate } from './dates';
import { LIMITS } from './limits';
import { mentionedIds, namesToTokens } from './mentions';
import type { BaseOp } from './protocol';
import { meId } from './select';
import { defaultAssignee, defaultPriority } from './tasks';
import {
  type DateString,
  type Project,
  type Snapshot,
  settingsOf,
} from './types';

export const CAPTURE_KINDS = ['note', 'task', 'decide', 'wait'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const KIND_LABELS: Record<CaptureKind, string> = {
  note: 'Note',
  task: 'Task',
  decide: 'To decide',
  wait: 'Waiting on',
};

/** The kind after `kind`, for the chip (click or Tab). */
export function nextKind(kind: CaptureKind): CaptureKind {
  const at = CAPTURE_KINDS.indexOf(kind);
  return CAPTURE_KINDS[(at + 1) % CAPTURE_KINDS.length] ?? 'note';
}

/** Where the capture line is: a room presets its project or person. */
export interface CaptureContext {
  projectId?: string | null;
  personId?: string | null;
}

export interface Capture {
  kind: CaptureKind;
  /** The text with the filing words taken out, mentions as `@{id}`. */
  text: string;
  projectId: string | null;
  /** A task's due day; always empty on a note. */
  due: DateString | '';
  /** The people the text mentions, in order. */
  people: string[];
  /** A task's or a decision's assignee (`''` for nobody). */
  assignee: string;
  /** Who a waiting-on task waits on; null when nobody is named. */
  waitingOn: string | null;
  /** A note with no project and no one mentioned: it goes to Unfiled. */
  unfiled: boolean;
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

/**
 * What a typed line means. `force` is the kind the chip was flipped to: a
 * forced note keeps its date words as text.
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

  let projectId: string | null = null;
  text = text.replace(HASH, (whole, lead: string, word: string) => {
    if (projectId) return whole;
    const id = projectFor(word, state);
    if (!id) return whole;
    projectId = id;
    return lead;
  });

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
  if (kind === 'note') due = '';

  const people = mentionedIds(text);
  const roomPerson =
    context.personId && state.people[context.personId]
      ? context.personId
      : null;
  // A note in a room can go to Unfiled instead, unless a `#word` filed it.
  const roomFiles = kind !== 'note' || settings.roomNotes === 'room';
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

  const unfiled = kind === 'note' && !projectId && people.length === 0;
  return { kind, text, projectId, due, people, assignee, waitingOn, unfiled };
}

/** Captured text as a task's title: mentions back to names. */
export function plainTitle(text: string, state: Snapshot): string {
  return text.replace(
    /@\{([^}]+)\}/g,
    (_, id: string) => state.people[id]?.name ?? 'someone',
  );
}

/** A task's title from a capture, within the limit. */
function titleOf(capture: Capture, state: Snapshot): string {
  const title = plainTitle(capture.text, state).trim();
  if (title) return title.slice(0, LIMITS.titleMax);
  const on = capture.waitingOn ? state.people[capture.waitingOn]?.name : '';
  return on ? `Hear back from ${on}` : '';
}

/** Whether there is something to save. */
export function canSave(capture: Capture, state: Snapshot): boolean {
  return capture.kind === 'note'
    ? capture.text.trim() !== ''
    : titleOf(capture, state) !== '';
}

export interface CaptureChip {
  kind: 'kind' | 'project' | 'person' | 'date' | 'unfiled';
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
    chips.push({ kind: 'date', label: `Due ${formatDay(capture.due, today)}` });
  }
  if (capture.unfiled) chips.push({ kind: 'unfiled', label: 'Unfiled' });
  return chips;
}

/**
 * The ops that save a capture, with `id` for the new document: a note, a
 * task (to decide or not), or a task and its blocker in one batch.
 */
export function captureOps(
  capture: Capture,
  state: Snapshot,
  id: string,
): BaseOp[] {
  if (capture.kind === 'note') {
    return [
      {
        type: 'addNote',
        id,
        projectId: capture.projectId,
        body: capture.text.trim(),
      },
    ];
  }
  const add: BaseOp = {
    type: 'addTask',
    id,
    projectId: capture.projectId,
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

/** The op that takes back what `captureOps` saved under `id`. */
export function undoCaptureOp(kind: CaptureKind, id: string): BaseOp {
  return kind === 'note'
    ? { type: 'deleteNote', id }
    : { type: 'deleteTask', id };
}

/** The toast after saving: what it became and where it went. */
export function captureToast(capture: Capture, state: Snapshot): string {
  const project = capture.projectId
    ? state.projects[capture.projectId]?.name
    : undefined;
  const person = capture.people[0]
    ? state.people[capture.people[0]]?.name
    : undefined;
  if (capture.kind === 'note') {
    if (project) return `Added a note to ${project}`;
    if (person) return `Added a note about ${person}`;
    return 'Added a note to Unfiled';
  }
  const where = project ?? 'General';
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
