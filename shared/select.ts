import { addDays, endOfWeek } from './dates';
import { nextMilestone } from './milestones';
import {
  blockedOf,
  type DateString,
  type Decision,
  type Meeting,
  type Milestone,
  milestonesOf,
  type Note,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from './types';

/**
 * Pure selectors over the snapshot. Each one is memoized on the identity of
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

/** How many running notes each task has (tasks with none are absent). */
export const taskNoteCounts = lastCall(
  (notes: Snapshot['notes']): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const n of Object.values(notes)) {
      if (!n.taskId) continue;
      counts.set(n.taskId, (counts.get(n.taskId) ?? 0) + 1);
    }
    return counts;
  },
);

/** A task's running notes, newest first. */
export function notesOfTask(notes: Snapshot['notes'], taskId: string): Note[] {
  return Object.values(notes)
    .filter((n) => n.taskId === taskId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Distinct orgs across projects, for autocomplete, sorted. */
export const orgs = lastCall(
  (projects: Projects, records: Snapshot['orgs'] = {}): string[] =>
    [
      ...new Set([
        ...Object.values(records)
          .filter((o) => !o.archived)
          .map((o) => o.name),
        ...Object.values(projects)
          .map((p) => p.org.trim())
          .filter(Boolean),
      ]),
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
  /** Waiting on someone, whatever the date: first, so 1:1s can unblock them. */
  blocked: Task[];
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
      blocked: [],
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
      if (blockedOf(t)) buckets.blocked.push(t);
      else if (t.due === '') buckets.noDate.push(t);
      else if (t.due < today) buckets.overdue.push(t);
      else if (t.due === today) buckets.today.push(t);
      else if (t.due <= sunday) buckets.thisWeek.push(t);
      else buckets.later.push(t);
    }
    for (const list of Object.values(buckets)) list.sort(byDueThenPriority);
    return buckets;
  },
);

/** Each project's next milestone on or after `today`, by project id. */
export const nextMilestones = lastCall(
  (projects: Projects, today: DateString): Map<string, Milestone> => {
    const next = new Map<string, Milestone>();
    for (const p of Object.values(projects)) {
      const m = nextMilestone(p, today);
      if (m) next.set(p.id, m);
    }
    return next;
  },
);

/** One thing on Focus's agenda: a meeting, or a milestone on its project. */
export type AgendaItem =
  | { kind: 'meeting'; id: string; date: DateString; meeting: Meeting }
  | {
      kind: 'milestone';
      id: string;
      date: DateString;
      milestone: Milestone;
      project: Project;
    };

/** All day (a milestone, a meeting without a time) sorts first in its day. */
function timeOf(item: AgendaItem): string {
  return item.kind === 'meeting' ? item.meeting.time : '';
}

function titleOf(item: AgendaItem): string {
  return item.kind === 'meeting' ? item.meeting.title : item.milestone.title;
}

/**
 * Meetings and milestones in the next seven days (today included), outside
 * archived projects, as one list: by day, all-day items first within a
 * day, then by time and title.
 */
export const agenda = lastCall(
  (
    meetings: Snapshot['meetings'],
    projects: Projects,
    today: DateString,
  ): AgendaItem[] => {
    const last = addDays(today, 6);
    const soon = (date: DateString) => date >= today && date <= last;
    const items: AgendaItem[] = [];
    for (const m of Object.values(meetings)) {
      if (!soon(m.date)) continue;
      if (m.projectId !== null && projects[m.projectId]?.archived) continue;
      items.push({ kind: 'meeting', id: m.id, date: m.date, meeting: m });
    }
    for (const p of Object.values(projects)) {
      if (p.archived) continue;
      for (const m of milestonesOf(p)) {
        if (!soon(m.date)) continue;
        items.push({
          kind: 'milestone',
          id: m.id,
          date: m.date,
          milestone: m,
          project: p,
        });
      }
    }
    return items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        timeOf(a).localeCompare(timeOf(b)) ||
        titleOf(a).localeCompare(titleOf(b)),
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
  /** Open tasks blocked on them: what to raise in a 1:1. */
  waiting: Task[];
  /** Decisions they took part in, newest first. */
  decisions: Decision[];
}

const NO_STATS: PersonStats = {
  projects: [],
  open: [],
  waiting: [],
  decisions: [],
};

/** Per person: their projects and open tasks (People list, detail, cards). */
export const peopleStats = lastCall(
  (
    projects: Projects,
    tasks: Tasks,
    decisions: Snapshot['decisions'] = {},
  ): Map<string, PersonStats> => {
    const stats = new Map<string, PersonStats>();
    const entry = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        s = { projects: [], open: [], waiting: [], decisions: [] };
        stats.set(id, s);
      }
      return s;
    };
    for (const p of Object.values(projects)) {
      for (const id of p.members) entry(id).projects.push(p);
    }
    for (const t of Object.values(tasks)) {
      if (t.status !== 'open') continue;
      if (t.projectId !== null && projects[t.projectId]?.archived) continue;
      if (t.assignee) entry(t.assignee).open.push(t);
      const on = blockedOf(t)?.on;
      if (on) entry(on).waiting.push(t);
    }
    for (const x of Object.values(decisions)) {
      for (const id of x.deciders) entry(id).decisions.push(x);
    }
    for (const s of stats.values()) {
      s.projects.sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
      );
      s.decisions.sort((a, b) =>
        (b.decidedAt || b.createdAt).localeCompare(a.decidedAt || a.createdAt),
      );
      for (const list of [s.open, s.waiting]) {
        list.sort(
          (a, b) =>
            Number(a.due === '') - Number(b.due === '') ||
            byDueThenPriority(a, b),
        );
      }
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
