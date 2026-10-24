/**
 * The domain, exactly as in docs/SPEC.md § Data model: six collections, each
 * a flat map of id → document. Ids are client-generated random strings,
 * timestamps ISO 8601, dates `YYYY-MM-DD`, times `HH:MM` (24-hour, local).
 * An empty string means "not set" for dates, times and the assignee, as in
 * the artifact's export, so that export imports byte for byte.
 */

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The leader's judgement of how a project is going, separate from status. */
export const PROJECT_HEALTHS = ['none', 'green', 'yellow', 'red'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

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

/** What an org is to you. */
export const ORG_KINDS = ['client', 'internal', 'vendor', 'partner'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** Where a decision stands. */
export const DECISION_STATUSES = ['proposed', 'decided', 'revisited'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

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
  /** Client or org, free text: what shows, and what older exports carry. */
  org: string;
  /** The Org record `org` names, once orgs are organised (M7). */
  orgId?: string | null;
  status: ProjectStatus;
  /**
   * Green, yellow, red, or not judged. Absent on documents written before
   * it existed (and in the artifact's export): read it with `healthOf()`.
   */
  health?: ProjectHealth;
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

/** Why a task is not moving: waiting on someone (or something). */
export interface Blocked {
  /** The person it waits on; null for "waiting, not on anyone listed". */
  on: string | null;
  /** One line: what it waits for. */
  note: string;
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
  /**
   * Waiting on someone. Absent on documents written before it existed:
   * read it with `blockedOf()`.
   */
  blocked?: Blocked | null;
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

/** Why something was decided, kept so it can be found and cited later. */
export interface Decision {
  id: string;
  /** null = General. */
  projectId: string | null;
  title: string;
  /** Markdown with `@{personId}` mentions. */
  rationale: string;
  status: DecisionStatus;
  /** When it was decided; empty while proposed. */
  decidedAt: DateString | '';
  deciders: string[];
  links: Link[];
  /** Set when it was made from a note's line (`/decision`). */
  sourceNoteId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A client, an internal team, a vendor or a partner, with its contacts. */
export interface Org {
  id: string;
  name: string;
  kind: OrgKind;
  links: Link[];
  /** Markdown with `@{personId}` mentions. */
  notes: string;
  contacts: string[];
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One task a template starts a project with. */
export interface TemplateTask {
  title: string;
  priority: Priority;
  tags: string[];
}

/** A saved kickoff checklist, applied when a project is created. */
export interface Template {
  id: string;
  name: string;
  /** In order. */
  tasks: TemplateTask[];
  /** Added to the new project's tags. */
  defaultTags: string[];
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

/** A project's health, `none` when it was never set. */
export function healthOf(project: Pick<Project, 'health'>): ProjectHealth {
  return project.health ?? 'none';
}

/** A task's blocked flag, null when it is not blocked. */
export function blockedOf(task: Pick<Task, 'blocked'>): Blocked | null {
  return task.blocked ?? null;
}

/** The key of General's activity log. */
export const GENERAL = 'general';

/**
 * Your preferences that belong with your data (and so follow you to every
 * device), as one document keyed `SETTINGS_ID`. Theme and motion stay per
 * device, in localStorage.
 */
export interface Settings {
  /** The org a new project starts with. */
  defaultOrg: string;
}

export const SETTINGS_ID = 'user';

export const DEFAULT_SETTINGS: Settings = {
  defaultOrg: 'OpenTeams Internal',
};

/** The settings in effect: what is stored over the defaults. */
export function settingsOf(snapshot: Pick<Snapshot, 'settings'>): Settings {
  return { ...DEFAULT_SETTINGS, ...snapshot.settings[SETTINGS_ID] };
}

export interface Collections {
  projects: Project;
  tasks: Task;
  notes: Note;
  events: Event;
  people: Person;
  decisions: Decision;
  orgs: Org;
  templates: Template;
  activity: Activity;
  settings: Settings;
}

export type Collection = keyof Collections;

export const COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'events',
  'people',
  'decisions',
  'orgs',
  'templates',
  'activity',
  'settings',
] as const satisfies readonly Collection[];

/** The collections whose documents carry their own `id`. */
export type DocCollection = Exclude<Collection, 'activity' | 'settings'>;

export const DOC_COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'events',
  'people',
  'decisions',
  'orgs',
  'templates',
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
    decisions: {},
    orgs: {},
    templates: {},
    activity: {},
    settings: {},
  };
}

/** The JSON file Export writes and Import reads (the artifact's format). */
export type ExportFile = { exportedAt: Timestamp } & Snapshot;
