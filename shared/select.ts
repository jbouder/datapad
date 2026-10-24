import { addDays, endOfWeek } from './dates';
import type {
  DateString,
  Event,
  Note,
  Person,
  Project,
  Snapshot,
  Task,
} from './types';

/**
 * Pure selectors over the snapshot. Each one is memoised on the identity of
 * its arguments: the reducer copies a collection only when it changes, so a
 * selector over `tasks` recomputes when a task changes and not when a note
 * does. Pass collections, not the whole snapshot, for that to hold.
 */

/** Remember the last call; recompute only when an argument changes. */
export function lastCall<A extends unknown[], R>(fn: (...args: A) => R) {
  let last: { args: A; result: R } | null = null;
  return (...args: A): R => {
    if (
      last &&
      last.args.length === args.length &&
      last.args.every((a, i) => Object.is(a, args[i]))
    ) {
      return last.result;
    }
    const result = fn(...args);
    last = { args, result };
    return result;
  };
}

type Tasks = Snapshot['tasks'];
type Projects = Snapshot['projects'];

/** The key General's counts go under. */
export const GENERAL_KEY = '';

/** Open tasks per project id (General under `GENERAL_KEY`). */
export const openCounts = lastCall((tasks: Tasks): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const t of Object.values(tasks)) {
    if (t.status !== 'open') continue;
    const key = t.projectId ?? GENERAL_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
});

/** Distinct orgs across projects, for autocomplete, sorted. */
export const orgs = lastCall((projects: Projects): string[] =>
  [
    ...new Set(
      Object.values(projects)
        .map((p) => p.org.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b)),
);

/** The person marked as "me", if any. */
export const meId = lastCall(
  (people: Snapshot['people']): string | null =>
    Object.values(people).find((p) => p.me)?.id ?? null,
);

/** Who the Focus and Tasks lists show. */
export type AssigneeFilter =
  | { kind: 'anyone' }
  | { kind: 'mine' }
  | { kind: 'unassigned' }
  | { kind: 'person'; id: string };

/** The filter as it sits in the URL (`who=`): anyone, mine, unassigned, p:<id>. */
export function assigneeFromQuery(value: string | null): AssigneeFilter {
  if (value === 'mine') return { kind: 'mine' };
  if (value === 'unassigned') return { kind: 'unassigned' };
  if (value?.startsWith('p:') && value.length > 2) {
    return { kind: 'person', id: value.slice(2) };
  }
  return { kind: 'anyone' };
}

export function assigneeToQuery(filter: AssigneeFilter): string {
  return filter.kind === 'person' ? `p:${filter.id}` : filter.kind;
}

/** Who a task quick-added under the filter goes to ('' = nobody). */
export function assigneeFor(filter: AssigneeFilter, me: string | null): string {
  if (filter.kind === 'mine') return me ?? '';
  if (filter.kind === 'person') return filter.id;
  return '';
}

export function matchesAssignee(
  task: Task,
  filter: AssigneeFilter,
  me: string | null,
): boolean {
  switch (filter.kind) {
    case 'anyone':
      return true;
    case 'mine':
      return me !== null && task.assignee === me;
    case 'unassigned':
      return task.assignee === '';
    case 'person':
      return task.assignee === filter.id;
  }
}

export interface FocusBuckets {
  /** Due before today. */
  overdue: Task[];
  today: Task[];
  /** After today, up to and including this week's Sunday. */
  thisWeek: Task[];
  /** After this week's Sunday. */
  later: Task[];
  noDate: Task[];
}

function byDueThenPriority(a: Task, b: Task): number {
  return (
    a.due.localeCompare(b.due) ||
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    a.order - b.order ||
    a.title.localeCompare(b.title)
  );
}

export const PRIORITY_RANK = { high: 3, med: 2, low: 1, none: 0 } as const;

/**
 * Open tasks outside archived projects, bucketed against `today` (the
 * user's local date, from `localDate(new Date())`).
 */
export const focusBuckets = lastCall(
  (
    tasks: Tasks,
    projects: Projects,
    today: DateString,
    me: string | null,
    filter: AssigneeFilter,
  ): FocusBuckets => {
    const sunday = endOfWeek(today);
    const buckets: FocusBuckets = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDate: [],
    };
    for (const t of Object.values(tasks)) {
      if (t.status !== 'open') continue;
      if (t.projectId !== null && projects[t.projectId]?.archived) continue;
      if (!matchesAssignee(t, filter, me)) continue;
      if (t.due === '') buckets.noDate.push(t);
      else if (t.due < today) buckets.overdue.push(t);
      else if (t.due === today) buckets.today.push(t);
      else if (t.due <= sunday) buckets.thisWeek.push(t);
      else buckets.later.push(t);
    }
    for (const list of Object.values(buckets)) list.sort(byDueThenPriority);
    return buckets;
  },
);

const MARKERS = new Set<Event['type']>(['milestone', 'deadline']);

/** Each project's next milestone or deadline on or after `today`. */
export const nextMarkers = lastCall(
  (events: Snapshot['events'], today: DateString): Map<string, Event> => {
    const next = new Map<string, Event>();
    for (const e of Object.values(events)) {
      if (!e.projectId || !MARKERS.has(e.type) || e.date < today) continue;
      const current = next.get(e.projectId);
      if (
        !current ||
        e.date < current.date ||
        (e.date === current.date && e.time < current.time)
      ) {
        next.set(e.projectId, e);
      }
    }
    return next;
  },
);

/** Events in the next seven days (today included), outside archived projects. */
export const agenda = lastCall(
  (
    events: Snapshot['events'],
    projects: Projects,
    today: DateString,
  ): Event[] => {
    const last = addDays(today, 6);
    return Object.values(events)
      .filter(
        (e) =>
          e.date >= today &&
          e.date <= last &&
          !(e.projectId !== null && projects[e.projectId]?.archived),
      )
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
      );
  },
);

export interface Mentions {
  notes: Note[];
  tasks: Task[];
}

/** Every note and task whose text mentions the person (`@{id}`). */
export const mentionsOf = lastCall(
  (
    notes: Snapshot['notes'],
    tasks: Tasks,
    personId: Person['id'],
  ): Mentions => {
    const token = `@{${personId}}`;
    return {
      notes: Object.values(notes)
        .filter((n) => n.body.includes(token))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      tasks: Object.values(tasks)
        .filter((t) => t.desc.includes(token))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  },
);

/** Projects outside the archive, most recently updated first. */
export const activeProjects = lastCall((projects: Projects): Project[] =>
  Object.values(projects)
    .filter((p) => !p.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);

export interface PersonStats {
  /** Projects they are a member of, archived last, then by name. */
  projects: Project[];
  /** Open tasks assigned to them, outside archived projects. */
  open: Task[];
}

const NO_STATS: PersonStats = { projects: [], open: [] };

/** Per person: their projects and open tasks (People list, detail, cards). */
export const peopleStats = lastCall(
  (projects: Projects, tasks: Tasks): Map<string, PersonStats> => {
    const stats = new Map<string, PersonStats>();
    const entry = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        s = { projects: [], open: [] };
        stats.set(id, s);
      }
      return s;
    };
    for (const p of Object.values(projects)) {
      for (const id of p.members) entry(id).projects.push(p);
    }
    for (const t of Object.values(tasks)) {
      if (!t.assignee || t.status !== 'open') continue;
      if (t.projectId !== null && projects[t.projectId]?.archived) continue;
      entry(t.assignee).open.push(t);
    }
    for (const s of stats.values()) {
      s.projects.sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
      );
      s.open.sort(
        (a, b) =>
          Number(a.due === '') - Number(b.due === '') ||
          byDueThenPriority(a, b),
      );
    }
    return stats;
  },
);

/** One person's stats; empty when they have none. */
export function statsFor(
  stats: Map<string, PersonStats>,
  id: string,
): PersonStats {
  return stats.get(id) ?? NO_STATS;
}
