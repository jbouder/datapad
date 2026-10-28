import { checkShape } from './board';
import { formatDay } from './dates';
import { LIMITS } from './limits';
import { byDate } from './milestones';
import { notepadOf } from './notes';
import { applyPagePatch } from './pages';
import type { Op, OpOf, ParsedExport } from './protocol';
import { isNoteTemplate } from './templates';
import {
  type Activity,
  type BoardItem,
  blockedOf,
  type Collection,
  type Collections,
  DEFAULT_SETTINGS,
  GENERAL,
  GENERAL_BOARD,
  healthOf,
  type Meeting,
  type Milestone,
  milestonesOf,
  type NavPrefs,
  type Person,
  type Project,
  SETTINGS_ID,
  type Snapshot,
  type Task,
  type Topic,
  topicsOf,
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

function checkOrg(d: Draft, id: string): string {
  if (!d.get('orgs', id)) fail('That org no longer exists');
  return id;
}

/** Org names are unique, ignoring case. */
function sameName(d: Draft, name: string, except?: string) {
  const key = name.trim().toLowerCase();
  if (
    d
      .all('orgs')
      .some((o) => o.id !== except && o.name.trim().toLowerCase() === key)
  ) {
    fail(`There is already an org called ${name.trim()}`);
  }
}

const DECISION_VERBS = {
  proposed: 'Proposed',
  decided: 'Decided',
  revisited: 'Revisited',
} as const;

/** A project cannot start after its target. */
function checkDates(start?: string, target?: string) {
  if (start && target && start > target) {
    fail('The start date is after the target date');
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
    const docs = this.state[col] as Record<string, Collections[C]>;
    // Own documents only: never `toString` or another inherited member.
    return Object.hasOwn(docs, id) ? docs[id] : undefined;
  }

  all<C extends Collection>(col: C): Collections[C][] {
    return Object.values(this.state[col]) as Collections[C][];
  }

  set<C extends Collection>(col: C, id: string, doc: Collections[C]) {
    this.own(col)[id] = doc;
    this.changes.set(`${col}\u0000${id}`, { col, id });
  }

  delete(col: Collection, id: string) {
    if (!Object.hasOwn(this.state[col], id)) {
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

function meeting(d: Draft, id: string) {
  return d.get('meetings', id) ?? fail('That meeting no longer exists');
}

function topic(list: Topic[], id: string): Topic {
  return list.find((t) => t.id === id) ?? fail('That topic no longer exists');
}

/** A meeting's topics changed: bump it and its project. */
function setTopics(d: Draft, m: Meeting, list: Topic[], now: string) {
  d.set('meetings', m.id, { ...m, topics: list, updatedAt: now });
  touch(d, m.projectId, now);
}

function milestone(list: Milestone[], id: string): Milestone {
  return (
    list.find((m) => m.id === id) ?? fail('That milestone no longer exists')
  );
}

/** A project's milestones, kept by date then title. */
function setMilestones(d: Draft, p: Project, list: Milestone[], now: string) {
  d.set('projects', p.id, {
    ...p,
    milestones: [...list].sort(byDate),
    updatedAt: now,
  });
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

/** A project's `updatedAt` follows its tasks, notes and meetings. */
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

/** One Notepad per space: any other note marked `scratch` loses the mark. */
function onlyNotepad(d: Draft) {
  const keep = notepadOf(d.state.notes);
  for (const n of d.all('notes')) {
    if (n.scratch && n.id !== keep?.id) {
      const { scratch: _, ...rest } = n;
      d.set('notes', n.id, rest);
    }
  }
}

/**
 * Deletes a project's tasks, notes and log (its milestones live on it and
 * go with it); its meetings and decisions move to General.
 */
function cascadeProject(d: Draft, id: string, now: string) {
  for (const t of d.all('tasks')) {
    if (t.projectId === id) d.delete('tasks', t.id);
  }
  for (const n of d.all('notes')) {
    if (n.projectId === id) d.delete('notes', n.id);
  }
  for (const m of d.all('meetings')) {
    if (m.projectId === id) {
      d.set('meetings', m.id, { ...m, projectId: null, updatedAt: now });
    }
  }
  // A decision outlives its project: why something was decided is still
  // worth finding.
  for (const x of d.all('decisions')) {
    if (x.projectId === id) {
      d.set('decisions', x.id, { ...x, projectId: null, updatedAt: now });
    }
  }
  // Its whiteboard goes with it.
  for (const b of d.all('boardItems')) {
    if (b.boardId === id) d.delete('boardItems', b.id);
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
      // Its running notes go with it.
      for (const n of d.all('notes')) {
        if (n.taskId === t.id && n.projectId !== op.projectId) {
          d.set('notes', n.id, { ...n, projectId: op.projectId });
        }
      }
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
    case 'setBlocked': {
      const t = d.get('tasks', op.id) ?? fail('That task no longer exists');
      const next = op.blocked;
      if (next?.on && !d.get('people', next.on)) {
        fail('That person no longer exists');
      }
      if (JSON.stringify(blockedOf(t)) === JSON.stringify(next)) return;
      d.set('tasks', t.id, { ...t, blocked: next, updatedAt: now });
      const who = next?.on ? d.get('people', next.on)?.name : undefined;
      log(
        d,
        t.projectId,
        next
          ? `Blocked "${t.title}"${who ? ` on ${who}` : ''}`
          : `Unblocked "${t.title}"`,
        now,
      );
      touch(d, t.projectId, now);
      return;
    }
    case 'deleteTask': {
      // Keeps its notes: they stay plain notes, their task link gone.
      const t = task(d, op.id);
      d.delete('tasks', t.id);
      log(d, t.projectId, `Deleted task "${t.title}"`, now);
      touch(d, t.projectId, now);
      return;
    }

    /* projects */
    case 'createProject': {
      fresh(d, 'projects', op.id, 'project');
      const template = op.template
        ? (d.get('templates', op.template.id) ??
          fail('That template no longer exists'))
        : null;
      if (template && isNoteTemplate(template)) {
        fail('That is a note template');
      }
      if (template && op.template?.taskIds.length !== template.tasks.length) {
        fail('That template changed. Try again.');
      }
      checkDates(op.startDate, op.targetDate);
      d.set('projects', op.id, {
        id: op.id,
        name: op.name,
        org: op.org ?? '',
        ...(op.orgId ? { orgId: checkOrg(d, op.orgId) } : {}),
        status: op.status ?? 'active',
        health: op.health ?? 'none',
        priority: op.priority ?? 'none',
        ...(op.startDate ? { startDate: op.startDate } : {}),
        targetDate: op.targetDate ?? '',
        tags: [
          ...new Set([...(op.tags ?? []), ...(template?.defaultTags ?? [])]),
        ].slice(0, LIMITS.tagsMax),
        desc: op.desc ?? '',
        state: op.state ?? '',
        members: op.members ?? [],
        links: op.links ?? [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      log(
        d,
        op.id,
        template
          ? `Created project from template "${template.name}"`
          : 'Created project',
        now,
      );
      template?.tasks.forEach((t, i) => {
        const id = op.template?.taskIds[i] as string;
        fresh(d, 'tasks', id, 'task');
        d.set('tasks', id, {
          id,
          title: t.title,
          projectId: op.id,
          status: 'open',
          priority: t.priority,
          due: '',
          desc: '',
          tags: t.tags,
          assignee: '',
          links: [],
          order: i + 1,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        });
      });
      return;
    }
    case 'addTemplate': {
      fresh(d, 'templates', op.id, 'template');
      if (
        op.body !== undefined &&
        (op.tasks?.length || op.defaultTags?.length)
      ) {
        fail('A note template has no tasks or tags');
      }
      d.set('templates', op.id, {
        id: op.id,
        name: op.name,
        tasks: op.tasks ?? [],
        defaultTags: op.defaultTags ?? [],
        ...(op.body !== undefined ? { body: op.body } : {}),
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    case 'editTemplate': {
      const x =
        d.get('templates', op.id) ?? fail('That template no longer exists');
      // A template stays the kind it was made as.
      if (isNoteTemplate(x)) {
        if (op.patch.tasks || op.patch.defaultTags) {
          fail('A note template has no tasks or tags');
        }
      } else if (op.patch.body !== undefined) {
        fail('That is a project template');
      }
      d.set('templates', x.id, { ...x, ...op.patch, updatedAt: now });
      return;
    }
    case 'deleteTemplate': {
      d.get('templates', op.id) ?? fail('That template no longer exists');
      d.delete('templates', op.id);
      return;
    }
    case 'editProject': {
      const p = project(d, op.id);
      if (op.patch.orgId) checkOrg(d, op.patch.orgId);
      checkDates(
        op.patch.startDate ?? p.startDate,
        op.patch.targetDate ?? p.targetDate,
      );
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
    case 'setHealth': {
      const p = project(d, op.id);
      if (healthOf(p) === op.health) return;
      d.set('projects', p.id, { ...p, health: op.health, updatedAt: now });
      log(d, p.id, `Health set to ${op.health}`, now);
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
      const meetingId = op.meetingId ?? null;
      const taskId = op.taskId ?? null;
      if (meetingId !== null && taskId !== null) {
        fail('A note goes on a meeting or a task, not both');
      }
      if (meetingId !== null && !d.get('meetings', meetingId)) {
        fail('That meeting no longer exists');
      }
      // A task's note lives in the task's project.
      const t = taskId === null ? null : task(d, taskId);
      const projectId = t ? t.projectId : op.projectId;
      checkProject(d, projectId);
      d.set('notes', op.id, {
        id: op.id,
        projectId,
        body: op.body,
        pinned: false,
        meetingId,
        phase: meetingId === null ? null : (op.phase ?? null),
        taskId,
        createdAt: now,
      });
      if (t) d.set('tasks', t.id, { ...t, updatedAt: now });
      log(
        d,
        projectId,
        op.summary
          ? 'Saved a summary as a note'
          : t
            ? `Added a note to "${t.title}"`
            : 'Added a note',
        now,
      );
      touch(d, projectId, now);
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
    case 'writeNotepad': {
      // Silent in Activity: it saves as you type.
      const n = notepadOf(d.state.notes);
      const empty = op.body.trim() === '';
      if (n) {
        if (empty) d.delete('notes', n.id);
        else if (n.body !== op.body) {
          d.set('notes', n.id, { ...n, body: op.body, editedAt: now });
        }
        return;
      }
      if (empty) return;
      fresh(d, 'notes', op.id, 'note');
      d.set('notes', op.id, {
        id: op.id,
        projectId: null,
        body: op.body,
        pinned: false,
        meetingId: null,
        phase: null,
        scratch: true,
        createdAt: now,
      });
      return;
    }

    /* meetings */
    case 'addMeeting': {
      fresh(d, 'meetings', op.id, 'meeting');
      checkProject(d, op.projectId);
      d.set('meetings', op.id, {
        id: op.id,
        projectId: op.projectId,
        title: op.title,
        date: op.date,
        time: op.time ?? '',
        end: op.end ?? '',
        attendees: op.attendees ?? [],
        link: op.link ?? '',
        note: op.note ?? '',
        createdAt: now,
        updatedAt: now,
      });
      log(d, op.projectId, `Added meeting "${op.title}"`, now);
      touch(d, op.projectId, now);
      return;
    }
    case 'editMeeting': {
      const m = meeting(d, op.id);
      if (op.patch.projectId !== undefined) checkProject(d, op.patch.projectId);
      const next = { ...m, ...op.patch, updatedAt: now };
      d.set('meetings', m.id, next);
      log(d, next.projectId, `Edited meeting "${next.title}"`, now);
      touch(d, m.projectId, now);
      touch(d, next.projectId, now);
      return;
    }
    case 'deleteMeeting': {
      const m = meeting(d, op.id);
      d.delete('meetings', m.id);
      // Its action items stay, as plain tasks.
      for (const t of d.all('tasks')) {
        if (t.meetingId === m.id)
          d.set('tasks', t.id, { ...t, meetingId: null });
      }
      log(d, m.projectId, `Deleted meeting "${m.title}"`, now);
      touch(d, m.projectId, now);
      return;
    }

    /*
     * topics: on the meeting, so each one bumps its `updatedAt` and its
     * project's. Adding and deleting log; edit, toggle and reorder do not.
     */
    case 'addTopic': {
      const m = meeting(d, op.meetingId);
      const list = topicsOf(m);
      if (list.some((t) => t.id === op.id)) fail('That topic already exists');
      if (list.length >= LIMITS.topicsMax) {
        fail(`A meeting has ${LIMITS.topicsMax} topics at most`);
      }
      const at =
        op.after === undefined
          ? list.length
          : list.indexOf(topic(list, op.after)) + 1;
      const added: Topic = {
        id: op.id,
        title: op.title,
        done: false,
        outcome: '',
        ...(op.carriedFrom ? { carriedFrom: op.carriedFrom } : {}),
      };
      setTopics(d, m, [...list.slice(0, at), added, ...list.slice(at)], now);
      log(
        d,
        m.projectId,
        op.carriedFrom
          ? `Carried topic "${op.title}" forward to "${m.title}"`
          : `Added topic "${op.title}" to "${m.title}"`,
        now,
      );
      return;
    }
    case 'editTopic': {
      const m = meeting(d, op.meetingId);
      const list = topicsOf(m);
      const t = topic(list, op.id);
      const next = { ...t, ...op.patch };
      setTopics(
        d,
        m,
        list.map((x) => (x.id === t.id ? next : x)),
        now,
      );
      return;
    }
    case 'toggleTopic': {
      const m = meeting(d, op.meetingId);
      const list = topicsOf(m);
      const t = topic(list, op.id);
      if (t.done === op.done) return;
      setTopics(
        d,
        m,
        list.map((x) => (x.id === t.id ? { ...t, done: op.done } : x)),
        now,
      );
      return;
    }
    case 'reorderTopics': {
      const m = meeting(d, op.meetingId);
      const list = topicsOf(m);
      const byId = new Map(list.map((t) => [t.id, t]));
      if (
        op.ids.length !== list.length ||
        new Set(op.ids).size !== op.ids.length ||
        op.ids.some((id) => !byId.has(id))
      ) {
        fail('The topics changed; try again');
      }
      if (op.ids.every((id, i) => list[i]?.id === id)) return;
      setTopics(
        d,
        m,
        op.ids.flatMap((id) => byId.get(id) ?? []),
        now,
      );
      return;
    }
    case 'deleteTopic': {
      const m = meeting(d, op.meetingId);
      const list = topicsOf(m);
      const t = topic(list, op.id);
      setTopics(
        d,
        m,
        list.filter((x) => x.id !== t.id),
        now,
      );
      log(d, m.projectId, `Removed topic "${t.title}" from "${m.title}"`, now);
      return;
    }

    /* milestones: on the project, so each one bumps its `updatedAt` */
    case 'addMilestone': {
      const p = project(d, op.projectId);
      const list = milestonesOf(p);
      if (list.some((m) => m.id === op.id))
        fail('That milestone already exists');
      if (list.length >= LIMITS.milestonesMax) {
        fail(`A project has ${LIMITS.milestonesMax} milestones at most`);
      }
      const added: Milestone = { id: op.id, title: op.title, date: op.date };
      setMilestones(d, p, [...list, added], now);
      log(
        d,
        p.id,
        `Added milestone "${op.title}" (${formatDay(op.date, '0000-01-01')})`,
        now,
      );
      return;
    }
    case 'editMilestone': {
      const p = project(d, op.projectId);
      const list = milestonesOf(p);
      const m = milestone(list, op.id);
      const next = { ...m, ...op.patch };
      setMilestones(
        d,
        p,
        list.map((x) => (x.id === m.id ? next : x)),
        now,
      );
      log(d, p.id, `Edited milestone "${next.title}"`, now);
      return;
    }
    case 'deleteMilestone': {
      const p = project(d, op.projectId);
      const list = milestonesOf(p);
      const m = milestone(list, op.id);
      setMilestones(
        d,
        p,
        list.filter((x) => x.id !== m.id),
        now,
      );
      log(d, p.id, `Deleted milestone "${m.title}"`, now);
      return;
    }

    /* orgs */
    case 'addOrg': {
      fresh(d, 'orgs', op.id, 'org');
      sameName(d, op.name);
      d.set('orgs', op.id, {
        id: op.id,
        name: op.name,
        kind: op.kind ?? 'client',
        links: [],
        notes: '',
        contacts: op.contacts ?? [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    case 'editOrg': {
      const o = d.get('orgs', op.id) ?? fail('That org no longer exists');
      if (op.patch.name && op.patch.name !== o.name)
        sameName(d, op.patch.name, o.id);
      const next = { ...o, ...op.patch, updatedAt: now };
      d.set('orgs', o.id, next);
      if (next.name !== o.name) {
        // Its projects show the new name too.
        for (const p of d.all('projects')) {
          if (p.orgId === o.id) {
            d.set('projects', p.id, { ...p, org: next.name, updatedAt: now });
          }
        }
        for (const s of d.all('settings')) {
          if (s.defaultOrg === o.name) {
            d.set('settings', SETTINGS_ID, { ...s, defaultOrg: next.name });
          }
        }
      }
      return;
    }
    case 'deleteOrg': {
      d.get('orgs', op.id) ?? fail('That org no longer exists');
      d.delete('orgs', op.id);
      for (const p of d.all('projects')) {
        if (p.orgId === op.id) {
          const { orgId: _, ...rest } = p;
          d.set('projects', p.id, rest);
        }
      }
      return;
    }
    case 'organizeOrgs': {
      const byName = new Map(
        d.all('orgs').map((o) => [o.name.trim().toLowerCase(), o.id]),
      );
      let made = 0;
      for (const o of op.orgs) {
        const key = o.name.trim().toLowerCase();
        if (byName.has(key) || d.get('orgs', o.id)) continue;
        d.set('orgs', o.id, {
          id: o.id,
          name: o.name.trim(),
          kind: o.kind ?? 'client',
          links: [],
          notes: '',
          contacts: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        });
        byName.set(key, o.id);
        made += 1;
      }
      let linked = 0;
      for (const p of d.all('projects')) {
        const want = byName.get(p.org.trim().toLowerCase());
        if (!want || p.orgId === want) continue;
        d.set('projects', p.id, { ...p, orgId: want });
        linked += 1;
      }
      if (made + linked > 0) {
        log(
          d,
          null,
          `Organized orgs: ${made} new, ${linked} ${linked === 1 ? 'project' : 'projects'} linked`,
          now,
        );
      }
      return;
    }

    /* decisions: retired (#183), kept so old clients' ops still apply */
    case 'addDecision': {
      fresh(d, 'decisions', op.id, 'decision');
      checkProject(d, op.projectId);
      const status = op.status ?? 'proposed';
      d.set('decisions', op.id, {
        id: op.id,
        projectId: op.projectId,
        title: op.title,
        rationale: op.rationale ?? '',
        status,
        decidedAt: op.decidedAt ?? '',
        deciders: op.deciders ?? [],
        links: op.links ?? [],
        ...(op.sourceNoteId ? { sourceNoteId: op.sourceNoteId } : {}),
        createdAt: now,
        updatedAt: now,
      });
      log(d, op.projectId, `${DECISION_VERBS[status]} "${op.title}"`, now);
      touch(d, op.projectId, now);
      return;
    }
    case 'editDecision': {
      const x =
        d.get('decisions', op.id) ?? fail('That decision no longer exists');
      if (op.patch.projectId !== undefined) checkProject(d, op.patch.projectId);
      const next = { ...x, ...op.patch, updatedAt: now };
      d.set('decisions', x.id, next);
      log(d, next.projectId, `Edited decision "${next.title}"`, now);
      touch(d, x.projectId, now);
      touch(d, next.projectId, now);
      return;
    }
    case 'setDecisionStatus': {
      const x =
        d.get('decisions', op.id) ?? fail('That decision no longer exists');
      if (x.status === op.status) return;
      const decidedAt =
        op.status === 'decided' && !x.decidedAt
          ? (op.day ?? now.slice(0, 10))
          : x.decidedAt;
      d.set('decisions', x.id, {
        ...x,
        status: op.status,
        decidedAt,
        updatedAt: now,
      });
      log(d, x.projectId, `${DECISION_VERBS[op.status]} "${x.title}"`, now);
      touch(d, x.projectId, now);
      return;
    }
    case 'deleteDecision': {
      const x =
        d.get('decisions', op.id) ?? fail('That decision no longer exists');
      d.delete('decisions', x.id);
      log(d, x.projectId, `Deleted decision "${x.title}"`, now);
      touch(d, x.projectId, now);
      return;
    }

    /* whiteboards */
    case 'addBoardItem':
      return addBoardItem(d, op, now);
    case 'editBoardItem': {
      const b =
        d.get('boardItems', op.id) ?? fail('That item is no longer there');
      const next: BoardItem = { ...b, ...op.patch };
      checkItem(next);
      d.set('boardItems', b.id, next);
      return;
    }
    case 'moveBoardItems': {
      for (const m of op.moves) {
        const b = d.get('boardItems', m.id);
        if (!b) continue; // deleted on another device meanwhile
        const next: BoardItem = {
          ...b,
          x: m.x,
          y: m.y,
          ...(m.points ? { points: m.points } : {}),
        };
        checkItem(next);
        if (
          next.x !== b.x ||
          next.y !== b.y ||
          next.points.join() !== b.points.join()
        ) {
          d.set('boardItems', b.id, next);
        }
      }
      return;
    }
    case 'raiseBoardItems':
      return restack(d, op.ids, 'top');
    case 'lowerBoardItems':
      return restack(d, op.ids, 'bottom');
    case 'deleteBoardItems': {
      for (const id of op.ids) d.delete('boardItems', id);
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
        const waiting = blockedOf(t)?.on === op.id;
        if (t.assignee === op.id || waiting) {
          d.set('tasks', t.id, {
            ...t,
            assignee: t.assignee === op.id ? '' : t.assignee,
            // Still blocked, just not on anyone listed.
            blocked: waiting
              ? { on: null, note: blockedOf(t)?.note ?? '' }
              : t.blocked,
            updatedAt: now,
          });
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
      for (const o of d.all('orgs')) {
        if (o.contacts.includes(op.id)) {
          d.set('orgs', o.id, {
            ...o,
            contacts: o.contacts.filter((c) => c !== op.id),
          });
        }
      }
      for (const x of d.all('decisions')) {
        if (x.deciders.includes(op.id)) {
          d.set('decisions', x.id, {
            ...x,
            deciders: x.deciders.filter((p) => p !== op.id),
          });
        }
      }
      for (const m of d.all('meetings')) {
        if (m.attendees.includes(op.id)) {
          d.set('meetings', m.id, {
            ...m,
            attendees: m.attendees.filter((a) => a !== op.id),
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
    case 'setNav': {
      setNav(d, op);
      return;
    }

    /* page preferences (#186), not logged either */
    case 'setPagePrefs': {
      const current = d.get('settings', SETTINGS_ID) ?? DEFAULT_SETTINGS;
      const pages = { ...current.pages };
      const next = applyPagePatch(pages[op.page], op.patch);
      if (Object.keys(next?.filters ?? {}).length > LIMITS.prefFiltersMax) {
        fail(`${LIMITS.prefFiltersMax} saved filters per page at most`);
      }
      if (Object.keys(next?.sections ?? {}).length > LIMITS.prefSectionsMax) {
        fail(`${LIMITS.prefSectionsMax} saved sections per page at most`);
      }
      if (next) pages[op.page] = next;
      else delete pages[op.page];
      d.set('settings', SETTINGS_ID, { ...current, pages });
      return;
    }
    case 'resetPagePrefs': {
      const current = d.get('settings', SETTINGS_ID) ?? DEFAULT_SETTINGS;
      // Kept, empty: a space that reset everything has still saved.
      const pages = { ...current.pages };
      if (op.page) delete pages[op.page];
      d.set('settings', SETTINGS_ID, {
        ...current,
        pages: op.page ? pages : {},
      });
      return;
    }
  }
}

/**
 * Navigation preferences (not logged). Each key replaces what is stored,
 * except `extras`, which merges switch by switch (`quickAdd` comes whole:
 * its order and hidden together); `null` clears a key, and
 * a nav with nothing left in it goes, so the default nav is no `nav`.
 */
function setNav(d: Draft, op: OpOf<'setNav'>) {
  const current = d.get('settings', SETTINGS_ID) ?? DEFAULT_SETTINGS;
  const nav: NavPrefs = { ...current.nav };
  const { order, hidden, phoneHidden, extras, quickAdd } = op.patch;
  if (order === null) delete nav.order;
  else if (order) nav.order = [...new Set(order)];
  if (hidden === null) delete nav.hidden;
  else if (hidden) nav.hidden = [...new Set(hidden)];
  if (phoneHidden === null) delete nav.phoneHidden;
  else if (phoneHidden) nav.phoneHidden = [...new Set(phoneHidden)];
  if (extras === null) delete nav.extras;
  else if (extras) nav.extras = { ...nav.extras, ...extras };
  if (quickAdd === null) delete nav.quickAdd;
  else if (quickAdd)
    nav.quickAdd = {
      order: [...new Set(quickAdd.order)],
      hidden: [...new Set(quickAdd.hidden)],
    };
  const { nav: _, ...rest } = current;
  d.set(
    'settings',
    SETTINGS_ID,
    Object.keys(nav).length > 0 ? { ...rest, nav } : rest,
  );
}

function addTask(d: Draft, op: OpOf<'addTask'>, now: string) {
  fresh(d, 'tasks', op.id, 'task');
  // An action item lives in its meeting's project.
  const m = op.meetingId ? meeting(d, op.meetingId) : null;
  const projectId = m ? m.projectId : op.projectId;
  checkProject(d, projectId);
  d.set('tasks', op.id, {
    id: op.id,
    title: op.title,
    projectId,
    status: 'open',
    priority: op.priority ?? 'none',
    due: op.due ?? '',
    desc: op.desc ?? '',
    tags: op.tags ?? [],
    assignee: op.assignee ?? '',
    links: op.links ?? [],
    order: nextOrder(d, projectId),
    ...(op.sourceNoteId ? { sourceNoteId: op.sourceNoteId } : {}),
    ...(m ? { meetingId: m.id } : {}),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
  log(
    d,
    projectId,
    m
      ? `Added action item "${op.title}" to "${m.title}"`
      : `Added task "${op.title}"`,
    now,
  );
  touch(d, projectId, now);
}

/* ---------- whiteboards ---------- */

const DREW = 'Drew on the whiteboard';

/** An item's points fit its kind. */
function checkItem(item: BoardItem) {
  const problem = checkShape(item);
  if (problem) fail(problem);
}

/**
 * Adds an item to a project's board or the space's. Silent, except that
 * the first one on a project's board in a day logs "Drew on the
 * whiteboard": the day began at `dayStart` (the sender's midnight), or at
 * the UTC midnight of `now` without it.
 */
function addBoardItem(d: Draft, op: OpOf<'addBoardItem'>, now: string) {
  const { item } = op;
  fresh(d, 'boardItems', item.id, 'item');
  if (item.boardId !== GENERAL_BOARD) project(d, item.boardId);
  checkItem(item);
  const count = d.all('boardItems').filter((b) => b.boardId === item.boardId);
  if (count.length >= LIMITS.boardItemsMax) {
    fail(`A whiteboard has ${LIMITS.boardItemsMax} items at most`);
  }
  d.set('boardItems', item.id, item);
  if (item.boardId === GENERAL_BOARD) return;
  const since = Date.parse(op.dayStart ?? `${now.slice(0, 10)}T00:00:00Z`);
  const events = d.get('activity', item.boardId)?.events ?? [];
  const drewToday = events.some(
    (e) => e.text === DREW && Date.parse(e.t) >= since,
  );
  if (!drewToday) log(d, item.boardId, DREW, now);
}

/**
 * Moves items to the top (or bottom) of their board, keeping their order
 * among themselves. Ids no longer there are skipped. Items already at the
 * top (or bottom), in that order, are left alone.
 */
function restack(d: Draft, ids: string[], to: 'top' | 'bottom') {
  const items = ids
    .flatMap((id) => d.get('boardItems', id) ?? [])
    .sort((a, b) => a.z - b.z);
  const boards = new Map<string, BoardItem[]>();
  for (const b of items) {
    boards.set(b.boardId, [...(boards.get(b.boardId) ?? []), b]);
  }
  for (const [boardId, moving] of boards) {
    const chosen = new Set(moving.map((b) => b.id));
    const others = d
      .all('boardItems')
      .filter((b) => b.boardId === boardId && !chosen.has(b.id))
      .map((b) => b.z);
    if (others.length === 0) continue;
    const low = moving[0]?.z ?? 0;
    const high = moving.at(-1)?.z ?? 0;
    const max = Math.max(...others);
    const min = Math.min(...others);
    // Already above (or below) everything else: nothing to do.
    if (to === 'top' ? max < low : min > high) continue;
    const start = to === 'top' ? max + 1 : min - moving.length;
    moving.forEach((b, i) => {
      if (b.z !== start + i) d.set('boardItems', b.id, { ...b, z: start + i });
    });
  }
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
  onlyNotepad(d);
  return { state: d.state, changed: d.changed };
}
