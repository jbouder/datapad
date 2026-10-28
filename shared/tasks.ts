import { addDays, endOfWeek } from './dates';
import type { Op } from './protocol';
import { type AssigneeFilter, matchesAssignee, PRIORITY_RANK } from './select';
import { blockedOf, type DateString, type Snapshot, type Task } from './types';

/** The Tasks view's controls, as kept in the URL. */
export interface TaskFilters {
  status: 'open' | 'done' | 'all';
  group: 'project' | 'due' | 'assignee' | 'priority' | 'none';
  who: AssigneeFilter;
  /** Text to find in titles, details and tags. */
  q: string;
  /** Only tasks waiting on someone. */
  blocked: boolean;
  sort: TaskSortKey;
  dir: 'asc' | 'desc';
}

export const TASK_SORTS = [
  'title',
  'project',
  'priority',
  'due',
  'assignee',
  'updated',
] as const;
export type TaskSortKey = (typeof TASK_SORTS)[number];

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  status: 'open',
  group: 'project',
  who: { kind: 'anyone' },
  q: '',
  blocked: false,
  sort: 'due',
  dir: 'asc',
};

export interface TaskGroup {
  id: string;
  label: string;
  rows: Task[];
}

const PRIORITY_NAMES = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
  none: 'No priority',
} as const;

/** Due buckets, in the order Focus uses them. */
export const DUE_BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number]['id'];

export function dueBucket(task: Task, today: DateString): DueBucket {
  if (!task.due) return 'none';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  if (task.due <= endOfWeek(today)) return 'week';
  return 'later';
}

function compare(
  sort: TaskSortKey,
  state: Pick<Snapshot, 'projects' | 'people'>,
): (a: Task, b: Task) => number {
  const project = (t: Task) =>
    t.projectId ? (state.projects[t.projectId]?.name ?? '') : '';
  const person = (t: Task) => state.people[t.assignee]?.name ?? '';
  switch (sort) {
    case 'title':
      return (a, b) => a.title.localeCompare(b.title);
    case 'project':
      return (a, b) => project(a).localeCompare(project(b));
    case 'priority':
      return (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    case 'due':
      // Undated last, whichever way.
      return (a, b) =>
        (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99');
    case 'assignee':
      return (a, b) => (person(a) || '￿').localeCompare(person(b) || '￿');
    case 'updated':
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  }
}

/**
 * The tasks the Tasks view shows: filtered by status, assignee and text,
 * sorted (ties by title), then grouped. Groups come in a stable order:
 * projects by name with General last, due buckets in time order, people
 * by name with Unassigned last.
 */
export function selectTasks(
  state: Pick<Snapshot, 'tasks' | 'projects' | 'people'>,
  filters: TaskFilters,
  today: DateString,
  me: string | null,
): TaskGroup[] {
  const q = filters.q.trim().toLowerCase();
  const cmp = compare(filters.sort, state);
  const dir = filters.dir === 'asc' ? 1 : -1;
  const rows = Object.values(state.tasks)
    .filter(
      (t) =>
        (filters.status === 'all' || t.status === filters.status) &&
        matchesAssignee(t, filters.who, me) &&
        (!filters.blocked || blockedOf(t) !== null) &&
        (!q ||
          t.title.toLowerCase().includes(q) ||
          t.desc.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))),
    )
    .sort((a, b) => dir * cmp(a, b) || a.title.localeCompare(b.title));

  if (filters.group === 'none') {
    return [{ id: 'all', label: '', rows }];
  }
  const groups = new Map<string, TaskGroup>();
  const add = (id: string, label: string, task: Task) => {
    const g = groups.get(id) ?? { id, label, rows: [] };
    g.rows.push(task);
    groups.set(id, g);
  };
  for (const t of rows) {
    if (filters.group === 'project') {
      const p = t.projectId ? state.projects[t.projectId] : undefined;
      add(p ? p.id : 'general', p ? p.name : 'General', t);
    } else if (filters.group === 'priority') {
      add(t.priority, PRIORITY_NAMES[t.priority], t);
    } else if (filters.group === 'due') {
      const b = dueBucket(t, today);
      add(b, DUE_BUCKETS.find((x) => x.id === b)?.label ?? b, t);
    } else {
      const person = state.people[t.assignee];
      add(
        person ? person.id : 'unassigned',
        person ? person.name : 'Unassigned',
        t,
      );
    }
  }
  const list = [...groups.values()];
  if (filters.group === 'priority') {
    return list.sort(
      (a, b) =>
        PRIORITY_RANK[b.id as keyof typeof PRIORITY_RANK] -
        PRIORITY_RANK[a.id as keyof typeof PRIORITY_RANK],
    );
  }
  if (filters.group === 'due') {
    const order: string[] = DUE_BUCKETS.map((b) => b.id);
    return list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const last = filters.group === 'project' ? 'general' : 'unassigned';
  return list.sort(
    (a, b) =>
      Number(a.id === last) - Number(b.id === last) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * The due date a card gets when it is dropped in a due column: Today is
 * today, This week is Friday (or Sunday once Friday has gone), Later is
 * two weeks out, No date clears it. Overdue takes no drops (null).
 */
export function dueForBucket(
  bucket: DueBucket,
  today: DateString,
): DateString | '' | null {
  switch (bucket) {
    case 'today':
      return today;
    case 'week': {
      const sunday = endOfWeek(today);
      const friday = addDays(sunday, -2);
      return friday >= today ? friday : sunday;
    }
    case 'later':
      return addDays(today, 14);
    case 'none':
      return '';
    case 'overdue':
      return null;
  }
}

type TaskOp = Exclude<Op, { type: 'batch' }>;

/**
 * The ops that undo `ops` on tasks that were `before`, newest first (#235).
 * Each puts back only what its op changed, through the op that checks it:
 * a close reopens, a move moves back (refused if that project has gone),
 * an edit restores the fields it set, a delete restores the task. So an
 * edit another tab or MCP made in between is kept. Ops on other things
 * (or on a task not in `before`) have no undo here.
 */
export function undoTaskOps(before: Task[], ops: Op[]): TaskOp[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const flat = ops.flatMap((o) => (o.type === 'batch' ? o.ops : [o]));
  const undo: TaskOp[] = [];
  for (const op of [...flat].reverse()) {
    const t = 'id' in op ? was.get(op.id) : undefined;
    if (!t) continue;
    if (op.type === 'toggleTask') {
      undo.push({ type: 'toggleTask', id: t.id, done: t.status === 'done' });
    } else if (op.type === 'moveTask') {
      undo.push({ type: 'moveTask', id: t.id, projectId: t.projectId });
    } else if (op.type === 'editTask') {
      const patch = Object.fromEntries(
        Object.keys(op.patch).map((k) => [k, t[k as keyof typeof op.patch]]),
      ) as typeof op.patch;
      undo.push({ type: 'editTask', id: t.id, patch });
    } else if (op.type === 'deleteTask') {
      undo.push({ type: 'restoreTask', task: t });
    }
  }
  return undo;
}
