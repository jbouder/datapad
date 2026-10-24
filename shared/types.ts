/**
 * The domain, exactly as in docs/SPEC.md § Data model: six collections, each
 * a flat map of id → document. Ids are client-generated random strings,
 * timestamps ISO 8601, dates `YYYY-MM-DD`, times `HH:MM` (24-hour, local).
 * An empty string means "not set" for dates, times and the assignee, as in
 * the artifact's export, so that export imports byte for byte.
 */

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITIES = ['none', 'low', 'med', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EVENT_TYPES = [
  'meeting',
  'milestone',
  'deadline',
  'demo',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A note's role for its event: prep (before) or debrief (after). */
export const NOTE_PHASES = ['pre', 'post'] as const;
export type NotePhase = (typeof NOTE_PHASES)[number];

/** ISO 8601, e.g. `2026-10-23T14:05:00.000Z`. */
export type Timestamp = string;
/** `YYYY-MM-DD`. */
export type DateString = string;
/** `HH:MM`, 24-hour, local. */
export type TimeString = string;

/**
 * An external thing attached to a project or task. `type` is free text,
 * suggested `link`, `meeting`, `issue`, `doc`, `pr`.
 */
export interface Link {
  type: string;
  url: string;
  label: string;
}

export interface Project {
  id: string;
  name: string;
  /** Client or org, free text. */
  org: string;
  status: ProjectStatus;
  priority: Priority;
  /** Empty: no target. */
  targetDate: DateString | '';
  tags: string[];
  /** Markdown. */
  desc: string;
  /** The one-line "current state" on the card. */
  state: string;
  members: string[];
  links: Link[];
  /** Archived projects leave default views but stay searchable. */
  archived: boolean;
  createdAt: Timestamp;
  /** Also bumps on task, note and event changes in the project. */
  updatedAt: Timestamp;
}

export interface Task {
  id: string;
  title: string;
  /** null = General. */
  projectId: string | null;
  status: TaskStatus;
  priority: Priority;
  due: DateString | '';
  /** Markdown with `@{personId}` mentions. */
  desc: string;
  tags: string[];
  /** A person id, or empty for unassigned. */
  assignee: string;
  links: Link[];
  /** Manual position among the project's open tasks. */
  order: number;
  /** Set when the task was made from a note. */
  sourceNoteId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** null while open. */
  completedAt: Timestamp | null;
}

export interface Note {
  id: string;
  /** null = General. */
  projectId: string | null;
  /** Markdown; mentions stored as `@{personId}`. */
  body: string;
  /** Pinned notes sort first within a project. */
  pinned: boolean;
  eventId: string | null;
  /** Prep or debrief note for `eventId`. */
  phase: NotePhase | null;
  createdAt: Timestamp;
  editedAt?: Timestamp;
}

export interface Event {
  id: string;
  /** null = General. */
  projectId: string | null;
  title: string;
  type: EventType;
  date: DateString;
  time: TimeString | '';
  end: TimeString | '';
  attendees: string[];
  /** A URL, or empty. */
  link: string;
  /** Short agenda or context, plain text. */
  note: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Person {
  id: string;
  /** Mention matching is by name. */
  name: string;
  role: string;
  /** At most one person is `me`; it enables the "Mine" filter. */
  me: boolean;
}

export interface ActivityEntry {
  t: Timestamp;
  text: string;
}

/**
 * One log per project, keyed by its id, plus one keyed `general`. Newest
 * first, capped at `LIMITS.activityMax`.
 */
export interface Activity {
  events: ActivityEntry[];
}

/** The key of General's activity log. */
export const GENERAL = 'general';

export interface Collections {
  projects: Project;
  tasks: Task;
  notes: Note;
  events: Event;
  people: Person;
  activity: Activity;
}

export type Collection = keyof Collections;

export const COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'events',
  'people',
  'activity',
] as const satisfies readonly Collection[];

/** The collections whose documents carry their own `id`. */
export type DocCollection = Exclude<Collection, 'activity'>;

export const DOC_COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'events',
  'people',
] as const satisfies readonly DocCollection[];

/** Everything one user has: every collection as a map by id. */
export type Snapshot = {
  [C in Collection]: Record<string, Collections[C]>;
};

export function emptySnapshot(): Snapshot {
  return {
    projects: {},
    tasks: {},
    notes: {},
    events: {},
    people: {},
    activity: {},
  };
}

/** The JSON file Export writes and Import reads (the artifact's format). */
export type ExportFile = { exportedAt: Timestamp } & Snapshot;
