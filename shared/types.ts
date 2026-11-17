/**
 * The domain, exactly as in docs/SPEC.md § Data model: the collections, each
 * a flat map of id → document. Ids are client-generated random strings,
 * timestamps ISO 8601, dates `YYYY-MM-DD`, times `HH:MM` (24-hour, local).
 * An empty string means "not set" for dates, times and the assignee, as in
 * the artifact's export, so that export imports byte for byte.
 */

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The leader's judgment of how a project is going, separate from status. */
export const PROJECT_HEALTHS = ['none', 'green', 'yellow', 'red'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const PRIORITIES = ['none', 'low', 'med', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** What an org is to you. */
export const ORG_KINDS = ['client', 'internal', 'vendor', 'partner'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** Where a decision stands. */
export const DECISION_STATUSES = ['proposed', 'decided', 'revisited'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** A note's role for its meeting: prep (before) or debrief (after). */
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

/**
 * A dated marker on a project: a launch, a review, a handover. It lives on
 * the project document, so it goes wherever the project goes. A deadline is
 * the project's `targetDate`, not a milestone.
 */
export interface Milestone {
  id: string;
  title: string;
  date: DateString;
}

export interface Project {
  id: string;
  name: string;
  /** Client or org, free text: what shows, and what older exports carry. */
  org: string;
  /** The Org record `org` names, once orgs are organized (M7). */
  orgId?: string | null;
  status: ProjectStatus;
  /**
   * Green, yellow, red, or not judged. Absent on documents written before
   * it existed (and in the artifact's export): read it with `healthOf()`.
   */
  health?: ProjectHealth;
  priority: Priority;
  /**
   * When the work began (or begins). Empty or absent (older documents): not
   * set, and the timeline starts the bar at `createdAt`.
   */
  startDate?: DateString | '';
  /** Empty: no target. */
  targetDate: DateString | '';
  tags: string[];
  /** Markdown. */
  desc: string;
  /**
   * The one-line "current state". Retired: nothing shows, searches or
   * summarizes it any more, but old data and old clients' `setState` ops
   * still carry it, so it is kept.
   */
  state: string;
  members: string[];
  links: Link[];
  /**
   * By date, then title. Absent on documents written before milestones
   * moved onto the project: read it with `milestonesOf()`.
   */
  milestones?: Milestone[];
  /** Archived projects leave default views but stay searchable. */
  archived: boolean;
  createdAt: Timestamp;
  /** Also bumps on task, note, meeting and milestone changes in the project. */
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
   * An action item from this meeting. Absent on tasks written before it
   * existed, and on tasks from no meeting: read it as null. Kept when the
   * task moves to another project; cleared when the meeting is deleted.
   */
  meetingId?: string | null;
  /**
   * Waiting on someone. Absent on documents written before it existed:
   * read it with `blockedOf()`.
   */
  blocked?: Blocked | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** null while open. */
  completedAt: Timestamp | null;
  /**
   * Something to decide (#328), not just to do. Absent on documents
   * written before it existed: read it with `decideOf()`.
   */
  decide?: boolean;
}

export interface Note {
  id: string;
  /** null = General. */
  projectId: string | null;
  /** Markdown; mentions stored as `@{personId}`. */
  body: string;
  /** Pinned notes sort first within a project. */
  pinned: boolean;
  meetingId: string | null;
  /** Prep or debrief note for `meetingId`. */
  phase: NotePhase | null;
  /**
   * A running note on a task (never with `meetingId`); `projectId` is the
   * task's. Absent on notes written before it existed: read it as null.
   */
  taskId?: string | null;
  /**
   * The space's Notepad (#218): its one running note, written in place on
   * Notes and saved as you type (`writeNotepad`). General, never on a
   * meeting or task. Absent on every other note: read it as false.
   * Retired in format 3 (#328): the migration clears it, so the Notepad
   * is an ordinary General note; only an old client's `writeNotepad`
   * still sets it.
   */
  scratch?: boolean;
  createdAt: Timestamp;
  editedAt?: Timestamp;
}

/** Something you attend: attendees, a link, an agenda, prep and debrief notes. */
export interface Meeting {
  id: string;
  /** null = General. */
  projectId: string | null;
  title: string;
  date: DateString;
  time: TimeString | '';
  end: TimeString | '';
  attendees: string[];
  /** A URL, or empty. */
  link: string;
  /** Short agenda or context, plain text. */
  note: string;
  /**
   * The agenda as discrete items, in order. Absent on documents written
   * before topics: read it with `topicsOf()`.
   */
  topics?: Topic[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One thing to raise in a meeting: covered or not, and what came of it. */
export interface Topic {
  id: string;
  title: string;
  /** Covered. */
  done: boolean;
  /** One line on what came of it, or empty. */
  outcome: string;
  /**
   * Carried forward: the day of the meeting it was first raised in (it
   * keeps that day as it rolls on). Absent on a topic raised here.
   */
  carriedFrom?: DateString;
}

/**
 * Why something was decided. Retired (#183): nothing shows, searches,
 * digests or summarizes decisions any more, but old data, exports and old
 * clients' decision ops still carry them, so the collection is kept.
 */
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
  /** Set when it was made from a note's line (the retired `/decision`). */
  sourceNoteId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** What a whiteboard item is. */
export const BOARD_KINDS = ['sticky', 'text', 'rect', 'arrow', 'ink'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

/** A whiteboard item's color: a token, never a literal. */
export const BOARD_COLORS = [
  'neutral',
  'accent',
  'ok',
  'warn',
  'danger',
] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

/** The space's own whiteboard; any other board id is a project's id. */
export const GENERAL_BOARD = 'general';

/**
 * One thing on a whiteboard: a sticky note, free text, a rectangle, an
 * arrow or an ink stroke. A board has no document of its own: `boardId`
 * is a project's id, or `GENERAL_BOARD` for the space's board.
 * Coordinates are board units (px at zoom 1).
 */
export interface BoardItem {
  id: string;
  boardId: string;
  kind: BoardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawing order: higher draws on top. */
  z: number;
  color: BoardColor;
  /** A sticky's, a text's or a rect's label; empty otherwise. */
  text: string;
  /**
   * Flat `[x0, y0, x1, y1, …]`, relative to `x, y`: an ink stroke's
   * points, an arrow's two ends. Empty for the other kinds.
   */
  points: number[];
}

/**
 * A titled checklist of one-line items, each done or not, in an order you
 * choose (#298). Items are embedded, as milestones are on a project.
 * Retired in format 3 (#328): each list became a checklist note
 * (`shared/migrate.ts`). The collection is kept and still exports, and
 * old clients' list ops still reduce, but nothing new reads it.
 */
export interface List {
  id: string;
  /** null = General. */
  projectId: string | null;
  title: string;
  /** In the order you chose. */
  items: ListItem[];
  createdAt: Timestamp;
  /** Bumps on every edit, items included. */
  updatedAt: Timestamp;
}

/** One line on a list: done or not. */
export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: Timestamp;
  /** When it was checked; null while open. */
  doneAt: Timestamp | null;
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

/**
 * A saved kickoff checklist, applied when a project is created; or, with
 * `body`, a note template a note starts from (`shared/templates.ts`).
 */
export interface Template {
  id: string;
  name: string;
  /** In order. Empty on a note template. */
  tasks: TemplateTask[];
  /** Added to the new project's tags. Empty on a note template. */
  defaultTags: string[];
  /**
   * A note template's Markdown, mentions as `@{personId}`. Absent on a
   * project template, so older exports read as project templates.
   */
  body?: string;
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

/** A project's milestones, empty on documents written before they existed. */
export function milestonesOf(
  project: Pick<Project, 'milestones'>,
): Milestone[] {
  return project.milestones ?? [];
}

/** A meeting's topics, empty on documents written before they existed. */
export function topicsOf(meeting: Pick<Meeting, 'topics'>): Topic[] {
  return meeting.topics ?? [];
}

/** A task's blocked flag, null when it is not blocked. */
export function blockedOf(task: Pick<Task, 'blocked'>): Blocked | null {
  return task.blocked ?? null;
}

/** Whether a task is something to decide; false when never set. */
export function decideOf(task: Pick<Task, 'decide'>): boolean {
  return task.decide ?? false;
}

/** The key of General's activity log. */
export const GENERAL = 'general';

/**
 * A space: a complete, separate Datapad (its own projects, tasks, notes,
 * meetings, decisions, lists, people, orgs, templates, settings and activity) under
 * the one signed-in email. The Durable Object keeps the list; `position`
 * is its order in the switcher, so a reorder never touches `createdAt`.
 */
export interface SpaceInfo {
  id: string;
  name: string;
  position: number;
  createdAt: Timestamp;
}

/**
 * The first space's fixed id: every user starts with it, and the data that
 * predates spaces moves into it. Its backups and client cache keep the
 * paths and keys from before spaces. Like any space, it can be deleted
 * once another exists; only the last space is kept.
 */
export const MAIN_SPACE = 'main';

/**
 * Your preferences that belong with your data (and so follow you to every
 * device), as one document keyed `SETTINGS_ID`. Theme and motion stay per
 * device, in localStorage.
 */
export interface Settings {
  /** The org a new project starts with; empty for none. */
  defaultOrg: string;
  /**
   * New tasks go to the person marked as you unless someone else (or
   * nobody) is picked. Absent (off) until switched on, so older exports
   * round-trip unchanged; `defaultAssignee()` in `shared/tasks.ts` reads it.
   */
  assignToMe?: boolean;
  /**
   * The priority a new task starts with when none is picked. Absent:
   * Medium. `defaultPriority()` in `shared/tasks.ts` reads it.
   */
  defaultPriority?: Priority;
  /**
   * Navigation preferences from before v2 (#187). Retired in #329: kept
   * as stored, so an old export round-trips, and read by nothing.
   */
  nav?: NavPrefs;
  /**
   * The pinned rooms, in the rail's order (#329): each a project id, a
   * person id, or a project and a person (`shared/rooms.ts`). Absent
   * until something is pinned.
   */
  pinned?: string[];
  /**
   * Each page's remembered layout, sort, grouping, filters and sections
   * (#186). Absent until something is saved, so older exports round-trip
   * unchanged; `shared/pages.ts` reads it. Today's options live under
   * `focus` and All's under `all` (#343); pages retired in v2 stay as
   * stored and are read by nothing.
   */
  pages?: Partial<Record<PageKey, PagePrefs>>;
  /**
   * What a plain line on the capture line becomes (#343). Absent: a note.
   */
  captureAs?: CaptureAs;
  /**
   * Whether `@Name` on a captured task (or decision) assigns it to that
   * person (#343). Absent: it does. Off, the person is only mentioned.
   */
  mentionAssigns?: boolean;
  /**
   * Where a note captured in a room goes when it names no project
   * (#343): the room, or Unfiled. Absent: the room.
   */
  roomNotes?: RoomNotes;
  /** Whether the rail lists the people who owe you (#343). Absent: it does. */
  railOwed?: boolean;
  /** The tab a project room opens on (#343). Absent: Stream. */
  roomTab?: RoomTab;
  /**
   * The person room's lane names, where the owner wants other words
   * (#343). A lane left out keeps its default name.
   */
  laneLabels?: LaneLabels;
}

/** What a plain captured line becomes. */
export const CAPTURE_AS = ['note', 'task'] as const;
export type CaptureAs = (typeof CAPTURE_AS)[number];

/** Where a note captured in a room goes when it names no project. */
export const ROOM_NOTES = ['room', 'unfiled'] as const;
export type RoomNotes = (typeof ROOM_NOTES)[number];

/** A project room's tabs (#334), Stream first. */
export const ROOM_TABS = ['stream', 'plan', 'whiteboard'] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

/** The person room's three lanes (#335), by key. */
export const LANE_KEYS = ['youOwe', 'theyOwe', 'discuss'] as const;
export type LaneKey = (typeof LANE_KEYS)[number];
export type LaneLabels = Partial<Record<LaneKey, string>>;

/**
 * Which sections the rail and tab bar showed before v2, in what order,
 * which of the rail's extras, and what the top bar's + offered. Retired
 * in #329: kept as stored and read by nothing.
 */
export interface NavPrefs {
  order?: string[];
  hidden?: string[];
  /** The shown sections the phone's tab bar leaves out (the rail keeps). */
  phoneHidden?: string[];
  /** `digest` is from before tools (#261): read until `tools` is saved. */
  extras?: { activeProjects?: boolean; digest?: boolean; archived?: boolean };
  /**
   * The rail's tools (#261): their order, the hidden ones and those the
   * phone's tab bar leaves out, saved whole. Absent until first saved.
   */
  tools?: { order?: string[]; hidden?: string[]; phoneHidden?: string[] };
  /** The top bar's + menu (#201): its actions' order and the hidden ones. */
  quickAdd?: { order?: string[]; hidden?: string[] };
}

/**
 * The pages whose settings are remembered (#186). `project`, `task`,
 * `meeting` and `list` (#310) are the detail pages: one set each, shared
 * by every project's (task's, meeting's, list's) page.
 */
export const PAGE_KEYS = [
  'focus',
  'all',
  'projects',
  'archive',
  'tasks',
  'meetings',
  'notes',
  'lists',
  'people',
  'project',
  'person',
  'task',
  'meeting',
  'list',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/**
 * One page's saved settings: only what differs from the page's defaults.
 * Never the search text, never an id that points at a single item.
 */
export interface PagePrefs {
  /** The layout (Cards, Table, Board …; Focus's Day or Week). */
  view?: string;
  sort?: string;
  /** `asc` or `desc`. */
  dir?: string;
  group?: string;
  /** Other filters by their query key (`status`, `who`, `project` …). */
  filters?: Record<string, string>;
  /** Open (true) or closed (false) per remembered section. */
  sections?: Record<string, boolean>;
  /**
   * Section keys the page leaves out altogether (#310). Kept as written
   * and checked when read: a key the page does not have is ignored.
   */
  hidden?: string[];
  /**
   * Section keys in the order the page shows them (#310); a section the
   * list does not name keeps its default place.
   */
  order?: string[];
  /**
   * Saved views (All, #338): a name over an address (`query`, All's
   * query string without the `?`, its kinds included), in the order the
   * chips show them.
   */
  views?: SavedView[];
}

/** A saved view on All (#338): its address, named. */
export interface SavedView {
  id: string;
  name: string;
  /** All's query string, without the `?` (`kind=task&view=board`). */
  query: string;
}

export const SETTINGS_ID = 'user';

/**
 * The settings in effect: every option has a value, the stored one or its
 * default. `nav` and `pages` stay as stored (a page's defaults are in
 * `PAGES`, `shared/pages.ts`).
 */
export type EffectiveSettings = Required<Omit<Settings, 'nav' | 'pages'>> &
  Pick<Settings, 'nav' | 'pages'> & { laneLabels: Required<LaneLabels> };

/**
 * Every space-wide option's default, in one place (#343): a fresh space
 * works with no setup. No default org, new tasks unassigned at Medium, a
 * plain captured line a note, `@Name` assigning a task, room notes in the
 * room, nothing pinned (the rail lists the active projects) with the
 * people who owe you under it, rooms opening on Stream, the person room's
 * lanes by their own names. Stored settings hold only what was changed,
 * so older exports round-trip unchanged.
 */
export const DEFAULT_SETTINGS: EffectiveSettings = {
  defaultOrg: '',
  assignToMe: false,
  defaultPriority: 'med',
  pinned: [],
  captureAs: 'note',
  mentionAssigns: true,
  roomNotes: 'room',
  railOwed: true,
  roomTab: 'stream',
  laneLabels: {
    youOwe: 'You owe',
    theyOwe: 'They owe you',
    discuss: 'To discuss',
  },
};

/**
 * The settings document a space starts storing from: only what is
 * required. Changes are written over it, never the defaults.
 */
export const STORED_SETTINGS: Settings = {
  defaultOrg: DEFAULT_SETTINGS.defaultOrg,
};

/** The settings in effect: what is stored over the defaults. */
export function settingsOf(
  snapshot: Pick<Snapshot, 'settings'>,
): EffectiveSettings {
  const stored = snapshot.settings[SETTINGS_ID];
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    laneLabels: { ...DEFAULT_SETTINGS.laneLabels, ...stored?.laneLabels },
  };
}

export interface Collections {
  projects: Project;
  tasks: Task;
  notes: Note;
  meetings: Meeting;
  people: Person;
  decisions: Decision;
  orgs: Org;
  templates: Template;
  boardItems: BoardItem;
  lists: List;
  activity: Activity;
  settings: Settings;
}

export type Collection = keyof Collections;

export const COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'meetings',
  'people',
  'decisions',
  'orgs',
  'templates',
  'boardItems',
  'lists',
  'activity',
  'settings',
] as const satisfies readonly Collection[];

/** The collections whose documents carry their own `id`. */
export type DocCollection = Exclude<Collection, 'activity' | 'settings'>;

export const DOC_COLLECTIONS = [
  'projects',
  'tasks',
  'notes',
  'meetings',
  'people',
  'decisions',
  'orgs',
  'templates',
  'boardItems',
  'lists',
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
    meetings: {},
    people: {},
    decisions: {},
    orgs: {},
    templates: {},
    boardItems: {},
    lists: {},
    activity: {},
    settings: {},
  };
}

/**
 * The export file's format version (#240), written as `format`. Bump it
 * when the file changes in a way an older Datapad would misread, and say
 * so in CHANGELOG.md under **Export format**. A file without `format` is
 * legacy (before 1), migrated by shape (`shared/migrate.ts`); a file with
 * a higher one than this is refused, never half-read.
 *
 * 2 adds `lists` (#298): a format 1 Datapad would drop them without a
 * word, so it refuses the file instead. Every format 1 file reads as is.
 *
 * 3 adds `tasks[].decide` and retires lists and the Notepad (#328). A
 * format 1 or 2 file (or one without `format`) is brought up to it on
 * import by `migrateFormat3()`: decide-tagged open tasks to decide, each
 * list a checklist note, the Notepad an ordinary note.
 */
export const EXPORT_FORMAT = 3;

/** The JSON file Export writes and Import reads (the artifact's format). */
export type ExportFile = {
  format: typeof EXPORT_FORMAT;
  exportedAt: Timestamp;
} & Snapshot;
