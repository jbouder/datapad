import { z } from 'zod';
import { LIMITS } from './limits';
import {
  type Activity,
  type COLLECTIONS,
  DECISION_STATUSES,
  DEFAULT_SETTINGS,
  type Decision,
  DOC_COLLECTIONS,
  EVENT_TYPES,
  type Event,
  type ExportFile,
  type Link,
  NOTE_PHASES,
  type Note,
  ORG_KINDS,
  type Org,
  type Person,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  type Project,
  type Settings,
  type Snapshot,
  TASK_STATUSES,
  type Task,
  type Template,
} from './types';

/**
 * What travels between the app and the Worker, validated with zod at the
 * boundary: documents (imports), ops (the socket) and socket messages.
 * Ops are the only way data changes; `shared/reducer.ts` applies them.
 */

/** `GET /api/config`. */
export interface AppConfig {
  /** The signed-in email, verified by Cloudflare Access. */
  email: string;
}

/* ---------- fields ---------- */

const id = z.string().min(1).max(LIMITS.idMax);
const nullableId = id.nullable();

/** `YYYY-MM-DD` that names a real day. */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'That day does not exist');
const dateOrEmpty = z.union([z.literal(''), date]);
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 14:30');
const timeOrEmpty = z.union([z.literal(''), time]);
const timestamp = z.iso.datetime({ offset: true });

const text = (max: number) => z.string().max(max);
/** Required text in an op: trimmed, not empty. */
const required = (max: number) => z.string().trim().min(1).max(max);

const tags = z
  .array(z.string().trim().min(1).max(LIMITS.tagMax))
  .max(LIMITS.tagsMax);
const people = z.array(id).max(LIMITS.peopleMax);

export const LinkSchema = z.object({
  type: text(LIMITS.linkTypeMax).default('link'),
  url: text(LIMITS.urlMax),
  label: text(LIMITS.linkLabelMax).default(''),
}) satisfies z.ZodType<Link, unknown>;
const links = z.array(LinkSchema).max(LIMITS.linksMax);

const projectStatus = z.enum(PROJECT_STATUSES);
const projectHealth = z.enum(PROJECT_HEALTHS);
const priority = z.enum(PRIORITIES);
const eventType = z.enum(EVENT_TYPES);
const phase = z.enum(NOTE_PHASES).nullable();

/* ---------- documents ---------- */

/*
 * Every field of docs/SPEC.md § Data model with its type and optionality.
 * Unknown keys are stripped (zod's default), so an export with extra fields
 * still imports. Fields an older export may lack get their empty value;
 * names, titles, dates and timestamps it must have.
 */

export const ProjectSchema = z.object({
  id,
  name: z.string().min(1).max(LIMITS.nameMax),
  org: text(LIMITS.nameMax).default(''),
  /** Absent in older exports: not organised yet. */
  orgId: nullableId.optional(),
  status: projectStatus.default('active'),
  /** Absent in older exports; `healthOf()` reads that as `none`. */
  health: projectHealth.optional(),
  priority: priority.default('none'),
  targetDate: dateOrEmpty.default(''),
  tags: tags.default([]),
  desc: text(LIMITS.bodyMax).default(''),
  state: text(LIMITS.stateMax).default(''),
  members: people.default([]),
  links: links.default([]),
  archived: z.boolean().default(false),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodType<Project, unknown>;

const blocked = z.object({
  on: z.union([id, z.null()]),
  note: z.string().trim().max(LIMITS.blockedNoteMax),
});

export const TaskSchema = z.object({
  id,
  title: z.string().min(1).max(LIMITS.titleMax),
  projectId: nullableId.default(null),
  status: z.enum(TASK_STATUSES).default('open'),
  priority: priority.default('none'),
  due: dateOrEmpty.default(''),
  desc: text(LIMITS.bodyMax).default(''),
  tags: tags.default([]),
  assignee: z.union([z.literal(''), id]).default(''),
  links: links.default([]),
  order: z.number().finite().default(0),
  sourceNoteId: id.optional(),
  /** Absent in older exports; `blockedOf()` reads that as not blocked. */
  blocked: blocked.nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp.nullable().default(null),
}) satisfies z.ZodType<Task, unknown>;

export const NoteSchema = z.object({
  id,
  projectId: nullableId.default(null),
  body: text(LIMITS.bodyMax),
  pinned: z.boolean().default(false),
  eventId: nullableId.default(null),
  phase: phase.default(null),
  createdAt: timestamp,
  editedAt: timestamp.optional(),
}) satisfies z.ZodType<Note, unknown>;

export const EventSchema = z.object({
  id,
  projectId: nullableId.default(null),
  title: z.string().min(1).max(LIMITS.titleMax),
  type: eventType.default('other'),
  date,
  time: timeOrEmpty.default(''),
  end: timeOrEmpty.default(''),
  attendees: people.default([]),
  link: text(LIMITS.urlMax).default(''),
  note: text(LIMITS.eventNoteMax).default(''),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodType<Event, unknown>;

const templateTask = z.object({
  title: required(LIMITS.titleMax),
  priority: priority.default('none'),
  tags: tags.default([]),
});

export const TemplateSchema = z.object({
  id,
  name: z.string().min(1).max(LIMITS.nameMax),
  tasks: z.array(templateTask).max(LIMITS.templateTasksMax).default([]),
  defaultTags: tags.default([]),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodType<Template, unknown>;

const orgKind = z.enum(ORG_KINDS);

export const OrgSchema = z.object({
  id,
  name: z.string().min(1).max(LIMITS.nameMax),
  kind: orgKind.default('client'),
  links: links.default([]),
  notes: text(LIMITS.bodyMax).default(''),
  contacts: people.default([]),
  archived: z.boolean().default(false),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodType<Org, unknown>;

const decisionStatus = z.enum(DECISION_STATUSES);

export const DecisionSchema = z.object({
  id,
  projectId: nullableId.default(null),
  title: z.string().min(1).max(LIMITS.titleMax),
  rationale: text(LIMITS.bodyMax).default(''),
  status: decisionStatus.default('proposed'),
  decidedAt: dateOrEmpty.default(''),
  deciders: people.default([]),
  links: links.default([]),
  sourceNoteId: id.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodType<Decision, unknown>;

export const PersonSchema = z.object({
  id,
  name: z.string().min(1).max(LIMITS.nameMax),
  role: text(LIMITS.nameMax).default(''),
  me: z.boolean().default(false),
}) satisfies z.ZodType<Person, unknown>;

export const ActivityEntrySchema = z.object({
  t: timestamp,
  text: text(LIMITS.activityTextMax),
});

export const ActivitySchema = z.object({
  events: z.array(ActivityEntrySchema).max(LIMITS.activityMax).default([]),
}) satisfies z.ZodType<Activity, unknown>;

export const SettingsSchema = z.object({
  defaultOrg: text(LIMITS.nameMax).default(DEFAULT_SETTINGS.defaultOrg),
}) satisfies z.ZodType<Settings, unknown>;

/** One schema per collection, for imports and `put`. */
export const DocumentSchemas = {
  projects: ProjectSchema,
  tasks: TaskSchema,
  notes: NoteSchema,
  events: EventSchema,
  people: PersonSchema,
  decisions: DecisionSchema,
  orgs: OrgSchema,
  templates: TemplateSchema,
  activity: ActivitySchema,
  settings: SettingsSchema,
} as const;

/* ---------- the export file ---------- */

/**
 * One collection of an export: a map by id (the artifact's shape), or an
 * array of documents that carry their id. Either way it becomes a map, and
 * a document without an `id` takes its key.
 */
function collectionOf<S extends z.ZodType>(schema: S) {
  return z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .default({})
    .transform((value, ctx) => {
      const entries: Array<[string, unknown]> = Array.isArray(value)
        ? value.map((doc, i) => [String(i), doc])
        : Object.entries(value);
      const out: Record<string, z.output<S>> = {};
      for (const [key, doc] of entries) {
        const withId =
          !Array.isArray(value) && typeof doc === 'object' && doc !== null
            ? { id: key, ...doc }
            : doc;
        const parsed = schema.safeParse(withId);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({ ...issue, path: [key, ...issue.path] } as never);
          }
          continue;
        }
        out[(parsed.data as { id: string }).id] = parsed.data as z.output<S>;
      }
      return out;
    });
}

/**
 * A collection keyed by something other than a document id: activity by
 * project id (or `general`), settings by `SETTINGS_ID`.
 */
function keyedCollection<S extends z.ZodType>(schema: S) {
  return z
    .union([z.record(z.string(), z.unknown()), z.array(z.looseObject({ id }))])
    .default({})
    .transform((value, ctx) => {
      const entries: Array<[string, unknown]> = Array.isArray(value)
        ? value.map((doc) => [doc.id, doc])
        : Object.entries(value);
      const out: Record<string, z.output<S>> = {};
      for (const [key, doc] of entries) {
        const parsed = schema.safeParse(doc);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({ ...issue, path: [key, ...issue.path] } as never);
          }
          continue;
        }
        out[key] = parsed.data as z.output<S>;
      }
      return out;
    });
}

/**
 * Datapad's export and the artifact's `ledger-*.json`, unchanged. Missing
 * collections are empty; unknown top-level keys are ignored.
 */
export const ExportSchema = z.object({
  exportedAt: timestamp.optional(),
  projects: collectionOf(ProjectSchema),
  tasks: collectionOf(TaskSchema),
  notes: collectionOf(NoteSchema),
  events: collectionOf(EventSchema),
  people: collectionOf(PersonSchema),
  /** Datapad only; older exports and the artifact have none. */
  decisions: collectionOf(DecisionSchema),
  /** Datapad only (M7); older files carry orgs as project text. */
  orgs: collectionOf(OrgSchema),
  /** Datapad only (M7). */
  templates: collectionOf(TemplateSchema),
  activity: keyedCollection(ActivitySchema),
  settings: keyedCollection(SettingsSchema),
});

export type ParsedExport = z.output<typeof ExportSchema>;

/** Documents per collection, as an import reports them. */
/** One nightly backup, as Settings → Data lists it. */
export interface BackupInfo {
  /** `YYYY-MM-DD`, the backup's day in the backup time zone. */
  day: string;
  bytes: number;
  /** When it was written, ISO 8601. */
  at: string;
}

/** `GET /api/backups`. */
export interface BackupList {
  backups: BackupInfo[];
  /** When they run: the local hour (0–23) in this IANA zone. */
  hour: number;
  timeZone: string;
}

export type Counts = Record<(typeof COLLECTIONS)[number], number>;

export function countDocuments(snapshot: Snapshot): Counts {
  return {
    projects: Object.keys(snapshot.projects).length,
    tasks: Object.keys(snapshot.tasks).length,
    notes: Object.keys(snapshot.notes).length,
    events: Object.keys(snapshot.events).length,
    people: Object.keys(snapshot.people).length,
    decisions: Object.keys(snapshot.decisions).length,
    orgs: Object.keys(snapshot.orgs).length,
    templates: Object.keys(snapshot.templates).length,
    activity: Object.keys(snapshot.activity).length,
    settings: Object.keys(snapshot.settings).length,
  };
}

/** `POST /api/import` → 200. */
export interface ImportResult {
  imported: Counts;
}

/** `GET /api/erase-token` → 200. Post the token back to `/api/erase`. */
export interface EraseToken {
  token: string;
  expiresAt: number;
}

export type { ExportFile };

/* ---------- ops ---------- */

const taskFields = {
  title: required(LIMITS.titleMax),
  priority,
  due: dateOrEmpty,
  desc: text(LIMITS.bodyMax),
  tags,
  assignee: z.union([z.literal(''), id]),
  links,
};

const projectFields = {
  name: required(LIMITS.nameMax),
  org: z.string().trim().max(LIMITS.nameMax),
  orgId: nullableId,
  priority,
  targetDate: dateOrEmpty,
  tags,
  desc: text(LIMITS.bodyMax),
  members: people,
  links,
};

const eventFields = {
  projectId: nullableId,
  title: required(LIMITS.titleMax),
  type: eventType,
  date,
  time: timeOrEmpty,
  end: timeOrEmpty,
  attendees: people,
  link: z.string().trim().max(LIMITS.urlMax),
  note: text(LIMITS.eventNoteMax),
};

const orgFields = {
  name: required(LIMITS.nameMax),
  kind: orgKind,
  links,
  notes: text(LIMITS.bodyMax),
  contacts: people,
  archived: z.boolean(),
};

const decisionFields = {
  projectId: nullableId,
  title: required(LIMITS.titleMax),
  rationale: text(LIMITS.bodyMax),
  decidedAt: dateOrEmpty,
  deciders: people,
  links,
};

const personFields = {
  name: required(LIMITS.nameMax),
  role: z.string().trim().max(LIMITS.nameMax),
  me: z.boolean(),
};

/** A partial update that changes at least one field. */
function patch<T extends z.ZodRawShape>(fields: T) {
  return z
    .object(fields)
    .partial()
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change');
}

const docCollection = z.enum(DOC_COLLECTIONS);

const PutSchema = z.discriminatedUnion('col', [
  z.object({
    type: z.literal('put'),
    col: z.literal('projects'),
    doc: ProjectSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('tasks'),
    doc: TaskSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('notes'),
    doc: NoteSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('events'),
    doc: EventSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('people'),
    doc: PersonSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('decisions'),
    doc: DecisionSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('orgs'),
    doc: OrgSchema,
  }),
  z.object({
    type: z.literal('put'),
    col: z.literal('templates'),
    doc: TemplateSchema,
  }),
]);

/**
 * Every change a client can ask for. Ids of new documents come from the
 * client; the time comes from the server (`at` on the broadcast).
 */
const BaseOpSchema = z.discriminatedUnion('type', [
  /* generic */
  PutSchema,
  z.object({ type: z.literal('remove'), col: docCollection, id }),
  /** Append a line to a project's activity log, or `general`'s. */
  z.object({
    type: z.literal('log'),
    scope: id,
    text: required(LIMITS.activityTextMax),
  }),

  /* tasks */
  z.object({
    type: z.literal('addTask'),
    id,
    projectId: nullableId,
    ...taskFields,
    priority: taskFields.priority.optional(),
    due: taskFields.due.optional(),
    desc: taskFields.desc.optional(),
    tags: taskFields.tags.optional(),
    assignee: taskFields.assignee.optional(),
    links: taskFields.links.optional(),
    sourceNoteId: id.optional(),
  }),
  /** Close (`done: true`) or reopen. Says the outcome, so it is idempotent. */
  z.object({ type: z.literal('toggleTask'), id, done: z.boolean() }),
  z.object({ type: z.literal('moveTask'), id, projectId: nullableId }),
  /** The project's open tasks in their new order. */
  z.object({
    type: z.literal('reorderTasks'),
    projectId: nullableId,
    ids: z.array(id).min(1).max(LIMITS.reorderMax),
  }),
  z.object({ type: z.literal('editTask'), id, patch: patch(taskFields) }),
  z.object({ type: z.literal('deleteTask'), id }),
  /** Logs "Blocked "<title>" on <name>" or "Unblocked "<title>"". */
  z.object({
    type: z.literal('setBlocked'),
    id,
    blocked: blocked.nullable(),
  }),

  /* projects */
  z.object({
    type: z.literal('createProject'),
    id,
    name: projectFields.name,
    ...z.object(projectFields).omit({ name: true }).partial().shape,
    status: projectStatus.optional(),
    health: projectHealth.optional(),
    state: z.string().trim().max(LIMITS.stateMax).optional(),
    /**
     * Start from a template: its tasks, in order, with these ids (one per
     * template task), and its default tags.
     */
    template: z
      .object({
        id,
        taskIds: z.array(id).max(LIMITS.templateTasksMax),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('editProject'),
    id,
    patch: patch(projectFields),
  }),
  z.object({
    type: z.literal('setState'),
    id,
    state: z.string().trim().max(LIMITS.stateMax),
  }),
  z.object({ type: z.literal('setStatus'), id, status: projectStatus }),
  /** Logs "Health set to <health>". */
  z.object({ type: z.literal('setHealth'), id, health: projectHealth }),
  z.object({ type: z.literal('archiveProject'), id }),
  z.object({ type: z.literal('unarchiveProject'), id }),
  /** Deletes its tasks, notes and activity; its events move to General. */
  z.object({ type: z.literal('deleteProject'), id }),

  /* notes */
  z.object({
    type: z.literal('addNote'),
    id,
    projectId: nullableId,
    body: required(LIMITS.bodyMax),
    eventId: nullableId.optional(),
    phase: phase.optional(),
    /** A saved summary: logs "Saved a summary as a note". */
    summary: z.boolean().optional(),
  }),
  z.object({ type: z.literal('editNote'), id, body: required(LIMITS.bodyMax) }),
  z.object({ type: z.literal('pinNote'), id, pinned: z.boolean() }),
  z.object({ type: z.literal('deleteNote'), id }),

  /* events */
  z.object({
    type: z.literal('addEvent'),
    id,
    projectId: eventFields.projectId,
    title: eventFields.title,
    /** The event's `type`; that key is taken by the op's own. */
    eventType: eventFields.type,
    date: eventFields.date,
    time: eventFields.time.optional(),
    end: eventFields.end.optional(),
    attendees: eventFields.attendees.optional(),
    link: eventFields.link.optional(),
    note: eventFields.note.optional(),
  }),
  z.object({ type: z.literal('editEvent'), id, patch: patch(eventFields) }),
  /** Keeps the event's notes. */
  z.object({ type: z.literal('deleteEvent'), id }),

  /* templates (not logged: they are not project work) */
  z.object({
    type: z.literal('addTemplate'),
    id,
    name: required(LIMITS.nameMax),
    tasks: z.array(templateTask).max(LIMITS.templateTasksMax).optional(),
    defaultTags: tags.optional(),
  }),
  z.object({
    type: z.literal('editTemplate'),
    id,
    patch: patch({
      name: required(LIMITS.nameMax),
      tasks: z.array(templateTask).max(LIMITS.templateTasksMax),
      defaultTags: tags,
    }),
  }),
  z.object({ type: z.literal('deleteTemplate'), id }),

  /* orgs */
  z.object({
    type: z.literal('addOrg'),
    id,
    name: orgFields.name,
    kind: orgKind.optional(),
    contacts: orgFields.contacts.optional(),
  }),
  /** A rename renames it on its projects too. */
  z.object({ type: z.literal('editOrg'), id, patch: patch(orgFields) }),
  /** Its projects keep their org text; only the link goes. */
  z.object({ type: z.literal('deleteOrg'), id }),
  /**
   * "Organise orgs": make an Org for each project org text that has none
   * (ids from the client), then link every project whose text names an
   * Org. Running it again changes nothing.
   */
  z.object({
    type: z.literal('organizeOrgs'),
    orgs: z
      .array(
        z.object({
          id,
          name: orgFields.name,
          kind: orgKind.optional(),
        }),
      )
      .max(LIMITS.batchMax),
  }),

  /* decisions */
  /** Logs "Proposed "<title>"" or "Decided "<title>"". */
  z.object({
    type: z.literal('addDecision'),
    id,
    projectId: decisionFields.projectId,
    title: decisionFields.title,
    status: decisionStatus.optional(),
    rationale: decisionFields.rationale.optional(),
    decidedAt: decisionFields.decidedAt.optional(),
    deciders: decisionFields.deciders.optional(),
    links: decisionFields.links.optional(),
    sourceNoteId: id.optional(),
  }),
  z.object({
    type: z.literal('editDecision'),
    id,
    patch: patch(decisionFields),
  }),
  /**
   * Logs "Decided", "Revisited" or "Proposed "<title>"". Deciding sets
   * `decidedAt` to `day` (the client's local date) when it is empty.
   */
  z.object({
    type: z.literal('setDecisionStatus'),
    id,
    status: decisionStatus,
    day: date.optional(),
  }),
  z.object({ type: z.literal('deleteDecision'), id }),

  /* people */
  z.object({
    type: z.literal('addPerson'),
    id,
    name: personFields.name,
    role: personFields.role.optional(),
    me: personFields.me.optional(),
  }),
  z.object({ type: z.literal('editPerson'), id, patch: patch(personFields) }),
  /** Mentions of them render as "@unknown". */
  z.object({ type: z.literal('removePerson'), id }),

  /* settings */
  z.object({
    type: z.literal('setSettings'),
    patch: patch({ defaultOrg: z.string().trim().max(LIMITS.nameMax) }),
  }),
]);

/** Everything a single op can be. */
export type BaseOp = z.infer<typeof BaseOpSchema>;

/**
 * Several ops applied as one: all or nothing, one sequence number, one
 * echo. Bulk actions use it (and their undo), so closing 30 tasks is one
 * change rather than 30 messages against the flood limit. Batches do not
 * nest.
 */
const BatchSchema = z.object({
  type: z.literal('batch'),
  ops: z.array(BaseOpSchema).min(1).max(LIMITS.batchMax),
});

// One discriminated union, so a bad op still gets a field-level reason.
export const OpSchema = z.discriminatedUnion('type', [
  ...BaseOpSchema.options,
  BatchSchema,
]);

export type Op = z.infer<typeof OpSchema>;
export type OpType = Op['type'];
export type OpOf<T extends OpType> = Extract<Op, { type: T }>;

/* ---------- socket messages ---------- */

/** Client → server. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('op'),
    /** Client-chosen, so the sender can match the echo or the rejection. */
    opId: id,
    op: OpSchema,
  }),
  /** Ask for a fresh snapshot (after a sequence gap or a disagreement). */
  z.object({ type: z.literal('sync') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Server → client. Not validated on the client; the server is trusted. */
export type ServerMessage =
  | {
      type: 'snapshot';
      seq: number;
      state: Snapshot;
      /**
       * The latest op ids the object applied (up to `LIMITS.recentOps`),
       * so a reconnecting client drops pending ops whose echo it missed
       * instead of sending them twice.
       */
      recent: string[];
    }
  | {
      type: 'op';
      seq: number;
      opId: string;
      op: Op;
      /** Server clock when the op was applied; pass to `reduce`. */
      at: string;
    }
  | { type: 'rejected'; opId: string; reason: string }
  /** An op the object had already applied (a replay): nothing changed. */
  | { type: 'ack'; opId: string };

/* ---------- readable errors ---------- */

const LABELS: Record<string, string> = {
  targetDate: 'Target date',
  projectId: 'Project',
  eventId: 'Event',
  sourceNoteId: 'Source note',
  createdAt: 'Created',
  updatedAt: 'Updated',
  completedAt: 'Closed',
  editedAt: 'Edited',
  desc: 'Description',
  state: 'Current state',
  eventType: 'Type',
  t: 'Time',
};

function label(path: ReadonlyArray<PropertyKey>): string {
  const key = [...path].reverse().find((p) => typeof p === 'string');
  if (!key) {
    return 'Value';
  }
  if (LABELS[key]) {
    return LABELS[key];
  }
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One zod issue as a sentence the UI can toast. */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const what = label(issue.path);
  switch (issue.code) {
    case 'too_big':
      return issue.origin === 'array'
        ? `${what}: ${issue.maximum} at most`
        : `${what} is too long (${issue.maximum} characters at most)`;
    case 'too_small':
      return issue.origin === 'array'
        ? `${what}: at least ${issue.minimum}`
        : `${what} is required`;
    case 'invalid_value':
      return `${what} must be one of ${issue.values.join(', ')}`;
    case 'invalid_type':
      return issue.input === undefined
        ? `${what} is required`
        : `${what} is not valid`;
    case 'invalid_format':
    case 'custom':
      return issue.message
        ? `${what}: ${issue.message}`
        : `${what} is not valid`;
    default:
      return `${what} is not valid`;
  }
}

/** Where an issue sits in a file, e.g. `tasks › t-1 › title`. */
export function issuePath(issue: z.core.$ZodIssue): string {
  return issue.path.map(String).join(' › ');
}
