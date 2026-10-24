import { LIMITS } from './limits';
import type { Op, OpOf, ParsedExport } from './protocol';
import {
  type Activity,
  type Collection,
  type Collections,
  DEFAULT_SETTINGS,
  GENERAL,
  type Person,
  type Project,
  SETTINGS_ID,
  type Snapshot,
  type Task,
} from './types';

/**
 * The one place state changes, on the client and in the Durable Object.
 * Pure: no clock, no randomness (ids come in the op, the time as `now`).
 * Returns the next state and the rows it touched, so the object persists
 * only those; throws an `OpError` with a reason the UI can toast when the
 * op cannot apply. Ops arrive validated by `OpSchema`.
 */

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

function fail(message: string): never {
  throw new OpError(message);
}

export type Changed =
  | { col: Collection; id: string }
  | { col: Collection; id: string; deleted: true };

export interface ReduceResult {
  state: Snapshot;
  changed: Changed[];
}

/**
 * Copy-on-write over the snapshot: a collection map is copied the first
 * time it is written, and every write is recorded once in `changed`.
 */
class Draft {
  readonly state: Snapshot;
  private readonly owned = new Set<Collection>();
  private readonly changes = new Map<string, Changed>();

  constructor(base: Snapshot) {
    this.state = { ...base };
  }

  get<C extends Collection>(col: C, id: string): Collections[C] | undefined {
    return (this.state[col] as Record<string, Collections[C]>)[id];
  }

  all<C extends Collection>(col: C): Collections[C][] {
    return Object.values(this.state[col]) as Collections[C][];
  }

  set<C extends Collection>(col: C, id: string, doc: Collections[C]) {
    this.own(col)[id] = doc;
    this.changes.set(`${col}\u0000${id}`, { col, id });
  }

  delete(col: Collection, id: string) {
    if (!(id in this.state[col])) {
      return;
    }
    delete this.own(col)[id];
    this.changes.set(`${col}\u0000${id}`, { col, id, deleted: true });
  }

  get changed(): Changed[] {
    return [...this.changes.values()];
  }

  private own<C extends Collection>(col: C): Record<string, Collections[C]> {
    if (!this.owned.has(col)) {
      this.owned.add(col);
      (this.state as Record<Collection, unknown>)[col] = { ...this.state[col] };
    }
    return this.state[col] as Record<string, Collections[C]>;
  }
}

/* ---------- helpers ---------- */

const GENERAL_NAME = 'General';

function project(d: Draft, id: string): Project {
  return d.get('projects', id) ?? fail('That project no longer exists');
}

function task(d: Draft, id: string): Task {
  return d.get('tasks', id) ?? fail('That task no longer exists');
}

/** A target project for new or moved things: null (General) or one that exists. */
function checkProject(d: Draft, projectId: string | null) {
  if (projectId !== null) {
    project(d, projectId);
  }
}

function fresh(d: Draft, col: Collection, id: string, what: string) {
  if (d.get(col, id)) {
    fail(`That ${what} already exists`);
  }
}

function projectName(d: Draft, projectId: string | null): string {
  return projectId === null
    ? GENERAL_NAME
    : (d.get('projects', projectId)?.name ?? GENERAL_NAME);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Prepend to a project's log (or General's); newest first, capped. */
function log(d: Draft, projectId: string | null, text: string, now: string) {
  const scope = projectId ?? GENERAL;
  if (scope !== GENERAL && !d.get('projects', scope)) {
    return; // the project is gone, and its log with it
  }
  const current: Activity = d.get('activity', scope) ?? { events: [] };
  d.set('activity', scope, {
    events: [
      { t: now, text: clip(text, LIMITS.activityTextMax) },
      ...current.events,
    ].slice(0, LIMITS.activityMax),
  });
}

/** A project's `updatedAt` follows its tasks, notes and events. */
function touch(d: Draft, projectId: string | null, now: string) {
  const p = projectId === null ? undefined : d.get('projects', projectId);
  if (p && p.updatedAt !== now) {
    d.set('projects', p.id, { ...p, updatedAt: now });
  }
}

/** New tasks go after every task already in the project (or General). */
function nextOrder(d: Draft, projectId: string | null): number {
  let max = 0;
  for (const t of d.all('tasks')) {
    if (t.projectId === projectId && t.order > max) {
      max = t.order;
    }
  }
  return max + 1;
}

/** At most one person is `me`: the one just marked wins. */
function onlyMe(d: Draft, meId: string) {
  for (const p of d.all('people')) {
    if (p.me && p.id !== meId) {
      d.set('people', p.id, { ...p, me: false });
    }
  }
}

/** Deletes a project's tasks, notes and log; its events move to General. */
function cascadeProject(d: Draft, id: string, now: string) {
  for (const t of d.all('tasks')) {
    if (t.projectId === id) d.delete('tasks', t.id);
  }
  for (const n of d.all('notes')) {
    if (n.projectId === id) d.delete('notes', n.id);
  }
  for (const e of d.all('events')) {
    if (e.projectId === id) {
      d.set('events', e.id, { ...e, projectId: null, updatedAt: now });
    }
  }
  d.delete('activity', id);
  d.delete('projects', id);
}

const encoder = new TextEncoder();

function checkSizes(d: Draft) {
  for (const c of d.changed) {
    if ('deleted' in c) continue;
    const doc = d.get(c.col, c.id);
    if (encoder.encode(JSON.stringify(doc)).length > LIMITS.docBytes) {
      fail('That is too big to save. Split it into smaller pieces.');
    }
  }
}

/* ---------- the reducer ---------- */

export function reduce(state: Snapshot, op: Op, now: string): ReduceResult {
  const d = new Draft(state);
  apply(d, op, now);
  checkSizes(d);
  const changed = d.changed;
  return { state: changed.length ? d.state : state, changed };
}

function apply(d: Draft, op: Op, now: string) {
  switch (op.type) {
    /* several at once: the first refusal refuses the whole batch */
    case 'batch': {
      for (const inner of op.ops) apply(d, inner, now);
      return;
    }

    /* generic */
    case 'put': {
      d.set(op.col, op.doc.id, op.doc);
      if (op.col === 'people' && (op.doc as Person).me) {
        onlyMe(d, op.doc.id);
      }
      return;
    }
    case 'remove': {
      if (op.col === 'projects') {
        if (d.get('projects', op.id)) cascadeProject(d, op.id, now);
        return;
      }
      d.delete(op.col, op.id);
      return;
    }
    case 'log': {
      if (op.scope !== GENERAL) project(d, op.scope);
      log(d, op.scope === GENERAL ? null : op.scope, op.text, now);
      return;
    }

    /* tasks */
    case 'addTask':
      return addTask(d, op, now);
    case 'toggleTask': {
      const t = task(d, op.id);
      const status = op.done ? 'done' : 'open';
      if (t.status === status) return;
      d.set('tasks', t.id, {
        ...t,
        status,
        completedAt: op.done ? now : null,
        updatedAt: now,
      });
      log(
        d,
        t.projectId,
        `${op.done ? 'Closed' : 'Reopened'} "${t.title}"`,
        now,
      );
      touch(d, t.projectId, now);
      return;
    }
    case 'moveTask': {
      const t = task(d, op.id);
      if (t.projectId === op.projectId) return;
      checkProject(d, op.projectId);
      d.set('tasks', t.id, {
        ...t,
        projectId: op.projectId,
        order: nextOrder(d, op.projectId),
        updatedAt: now,
      });
      const from = projectName(d, t.projectId);
      const to = projectName(d, op.projectId);
      log(d, t.projectId, `Moved "${t.title}" to ${to}`, now);
      log(d, op.projectId, `Moved "${t.title}" here from ${from}`, now);
      touch(d, t.projectId, now);
      touch(d, op.projectId, now);
      return;
    }
    case 'reorderTasks':
      return reorderTasks(d, op);
    case 'editTask': {
      const t = task(d, op.id);
      const next: Task = { ...t, ...op.patch, updatedAt: now };
      d.set('tasks', t.id, next);
      log(d, t.projectId, `Edited task "${next.title}"`, now);
      touch(d, t.projectId, now);
      return;
    }
    case 'deleteTask': {
      const t = task(d, op.id);
      d.delete('tasks', t.id);
      log(d, t.projectId, `Deleted task "${t.title}"`, now);
      touch(d, t.projectId, now);
      return;
    }

    /* projects */
    case 'createProject': {
      fresh(d, 'projects', op.id, 'project');
      d.set('projects', op.id, {
        id: op.id,
        name: op.name,
        org: op.org ?? '',
        status: op.status ?? 'active',
        priority: op.priority ?? 'none',
        targetDate: op.targetDate ?? '',
        tags: op.tags ?? [],
        desc: op.desc ?? '',
        state: op.state ?? '',
        members: op.members ?? [],
        links: op.links ?? [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      log(d, op.id, 'Created project', now);
      return;
    }
    case 'editProject': {
      const p = project(d, op.id);
      d.set('projects', p.id, { ...p, ...op.patch, updatedAt: now });
      log(d, p.id, 'Edited project details', now);
      return;
    }
    case 'setState': {
      const p = project(d, op.id);
      if (p.state === op.state) return;
      d.set('projects', p.id, { ...p, state: op.state, updatedAt: now });
      log(d, p.id, 'Updated current state', now);
      return;
    }
    case 'setStatus': {
      const p = project(d, op.id);
      if (p.status === op.status) return;
      d.set('projects', p.id, { ...p, status: op.status, updatedAt: now });
      log(d, p.id, `Status changed to ${op.status}`, now);
      return;
    }
    case 'archiveProject':
    case 'unarchiveProject': {
      const p = project(d, op.id);
      const archived = op.type === 'archiveProject';
      if (p.archived === archived) return;
      d.set('projects', p.id, { ...p, archived, updatedAt: now });
      log(d, p.id, archived ? 'Archived project' : 'Unarchived project', now);
      return;
    }
    case 'deleteProject': {
      project(d, op.id);
      cascadeProject(d, op.id, now);
      return;
    }

    /* notes */
    case 'addNote': {
      fresh(d, 'notes', op.id, 'note');
      checkProject(d, op.projectId);
      const eventId = op.eventId ?? null;
      if (eventId !== null && !d.get('events', eventId)) {
        fail('That event no longer exists');
      }
      d.set('notes', op.id, {
        id: op.id,
        projectId: op.projectId,
        body: op.body,
        pinned: false,
        eventId,
        phase: eventId === null ? null : (op.phase ?? null),
        createdAt: now,
      });
      log(
        d,
        op.projectId,
        op.summary ? 'Saved a Claude summary as a note' : 'Added a note',
        now,
      );
      touch(d, op.projectId, now);
      return;
    }
    case 'editNote': {
      const n = d.get('notes', op.id) ?? fail('That note no longer exists');
      if (n.body === op.body) return;
      d.set('notes', n.id, { ...n, body: op.body, editedAt: now });
      touch(d, n.projectId, now);
      return;
    }
    case 'pinNote': {
      const n = d.get('notes', op.id) ?? fail('That note no longer exists');
      if (n.pinned === op.pinned) return;
      d.set('notes', n.id, { ...n, pinned: op.pinned });
      touch(d, n.projectId, now);
      return;
    }
    case 'deleteNote': {
      const n = d.get('notes', op.id) ?? fail('That note no longer exists');
      d.delete('notes', n.id);
      log(d, n.projectId, 'Deleted a note', now);
      touch(d, n.projectId, now);
      return;
    }

    /* events */
    case 'addEvent': {
      fresh(d, 'events', op.id, 'event');
      checkProject(d, op.projectId);
      d.set('events', op.id, {
        id: op.id,
        projectId: op.projectId,
        title: op.title,
        type: op.eventType,
        date: op.date,
        time: op.time ?? '',
        end: op.end ?? '',
        attendees: op.attendees ?? [],
        link: op.link ?? '',
        note: op.note ?? '',
        createdAt: now,
        updatedAt: now,
      });
      log(d, op.projectId, `Added ${op.eventType} "${op.title}"`, now);
      touch(d, op.projectId, now);
      return;
    }
    case 'editEvent': {
      const e = d.get('events', op.id) ?? fail('That event no longer exists');
      if (op.patch.projectId !== undefined) checkProject(d, op.patch.projectId);
      const next = { ...e, ...op.patch, updatedAt: now };
      d.set('events', e.id, next);
      log(d, next.projectId, `Edited ${next.type} "${next.title}"`, now);
      touch(d, e.projectId, now);
      touch(d, next.projectId, now);
      return;
    }
    case 'deleteEvent': {
      const e = d.get('events', op.id) ?? fail('That event no longer exists');
      d.delete('events', e.id);
      log(d, e.projectId, `Deleted event "${e.title}"`, now);
      touch(d, e.projectId, now);
      return;
    }

    /* people */
    case 'addPerson': {
      fresh(d, 'people', op.id, 'person');
      const me = op.me ?? false;
      d.set('people', op.id, {
        id: op.id,
        name: op.name,
        role: op.role ?? '',
        me,
      });
      if (me) onlyMe(d, op.id);
      return;
    }
    case 'editPerson': {
      const p = d.get('people', op.id) ?? fail('That person no longer exists');
      const next = { ...p, ...op.patch };
      d.set('people', p.id, next);
      if (next.me) onlyMe(d, p.id);
      return;
    }
    case 'removePerson': {
      // Mentions stay as tokens (they read @unknown); every reference
      // that picks the person goes: assignments, members, attendees.
      d.get('people', op.id) ?? fail('That person no longer exists');
      d.delete('people', op.id);
      for (const t of d.all('tasks')) {
        if (t.assignee === op.id) {
          d.set('tasks', t.id, { ...t, assignee: '', updatedAt: now });
        }
      }
      for (const p of d.all('projects')) {
        if (p.members.includes(op.id)) {
          d.set('projects', p.id, {
            ...p,
            members: p.members.filter((m) => m !== op.id),
          });
        }
      }
      for (const e of d.all('events')) {
        if (e.attendees.includes(op.id)) {
          d.set('events', e.id, {
            ...e,
            attendees: e.attendees.filter((a) => a !== op.id),
          });
        }
      }
      return;
    }

    /* settings (not logged) */
    case 'setSettings': {
      const current = d.get('settings', SETTINGS_ID) ?? DEFAULT_SETTINGS;
      d.set('settings', SETTINGS_ID, { ...current, ...op.patch });
      return;
    }
  }
}

function addTask(d: Draft, op: OpOf<'addTask'>, now: string) {
  fresh(d, 'tasks', op.id, 'task');
  checkProject(d, op.projectId);
  d.set('tasks', op.id, {
    id: op.id,
    title: op.title,
    projectId: op.projectId,
    status: 'open',
    priority: op.priority ?? 'none',
    due: op.due ?? '',
    desc: op.desc ?? '',
    tags: op.tags ?? [],
    assignee: op.assignee ?? '',
    links: op.links ?? [],
    order: nextOrder(d, op.projectId),
    ...(op.sourceNoteId ? { sourceNoteId: op.sourceNoteId } : {}),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  log(d, op.projectId, `Added task "${op.title}"`, now);
  touch(d, op.projectId, now);
}

/**
 * Rewrites `order` as 1..n over the project's open tasks: the ones named,
 * in that order, then any the sender did not know about (added on another
 * device meanwhile) in their current order. Names that are not open tasks
 * of the project are skipped rather than refused, for the same reason.
 * Only rows whose order changed are written; nothing is logged.
 */
function reorderTasks(d: Draft, op: OpOf<'reorderTasks'>) {
  const open = d
    .all('tasks')
    .filter((t) => t.projectId === op.projectId && t.status === 'open')
    .sort((a, b) => a.order - b.order);
  const byId = new Map(open.map((t) => [t.id, t]));
  const named = [...new Set(op.ids)].flatMap((id) => byId.get(id) ?? []);
  const seen = new Set(named.map((t) => t.id));
  const ordered = [...named, ...open.filter((t) => !seen.has(t.id))];
  ordered.forEach((t, i) => {
    if (t.order !== i + 1) {
      d.set('tasks', t.id, { ...t, order: i + 1 });
    }
  });
}

/* ---------- import ---------- */

/**
 * Merge an import by id: a document with an id already present replaces
 * it, everything else is kept. Activity logs are per project, so they
 * replace whole too. The result still has at most one `me`: an imported
 * one wins.
 */
export function merge(state: Snapshot, incoming: ParsedExport): ReduceResult {
  const d = new Draft(state);
  for (const col of Object.keys(incoming) as Array<keyof ParsedExport>) {
    if (col === 'exportedAt') continue;
    for (const [id, doc] of Object.entries(incoming[col] ?? {})) {
      d.set(col, id, doc as Collections[typeof col]);
    }
  }
  const me = Object.values(incoming.people).find((p) => p.me);
  if (me) onlyMe(d, me.id);
  return { state: d.state, changed: d.changed };
}
