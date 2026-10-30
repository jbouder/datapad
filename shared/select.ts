import { addDays, dayOf, daysBetween, formatDay } from './dates';
import { byWhen, previousMeeting } from './meetings';
import { nextMilestone } from './milestones';
import {
  blockedOf,
  type DateString,
  healthOf,
  type Meeting,
  type Milestone,
  milestonesOf,
  type Note,
  type Person,
  type Priority,
  type Project,
  type Snapshot,
  type Task,
  type Timestamp,
  topicsOf,
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
  return newestFirst(Object.values(notes).filter((n) => n.taskId === taskId));
}

/**
 * A meeting's action items (`Task.meetingId`): open first, oldest first,
 * then done, the most recently closed first.
 */
export function tasksOfMeeting(
  tasks: Snapshot['tasks'],
  meetingId: string,
): { open: Task[]; done: Task[] } {
  const mine = Object.values(tasks).filter((t) => t.meetingId === meetingId);
  return {
    open: mine
      .filter((t) => t.status === 'open')
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    done: mine
      .filter((t) => t.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
  };
}

/**
 * A meeting's notes, newest first: one list, whatever their (legacy)
 * `phase`.
 */
export function notesOfMeeting(
  notes: Snapshot['notes'],
  meetingId: string,
): Note[] {
  return newestFirst(
    Object.values(notes).filter((n) => n.meetingId === meetingId),
  );
}

function newestFirst(notes: Note[]): Note[] {
  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

/**
 * How many days Focus's Week looks ahead, today included: the agenda's
 * window and Due's. `FOCUS_DAYS` unless Settings → Pages says otherwise
 * (`focusDays()` in `shared/pages.ts`).
 */
export const FOCUS_DAYS = 7;
export const FOCUS_DAY_CHOICES = [3, 5, 7, 10, 14] as const;

/**
 * Every open task by when it is due. Focus's Due shows Overdue, Today and
 * Upcoming in Week (blocked tasks are in its Waiting on, `waitingOn`); the
 * rail counts them all.
 */
export interface FocusBuckets {
  /** Waiting on someone, whatever the date. */
  blocked: Task[];
  /** Due before today. */
  overdue: Task[];
  today: Task[];
  /**
   * After today, within `days` of it (today included): the same rolling
   * window as the agenda, so a Friday sees Monday.
   */
  upcoming: Task[];
  /** After that. */
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
    days: number = FOCUS_DAYS,
  ): FocusBuckets => {
    const last = addDays(today, days - 1);
    const buckets: FocusBuckets = {
      blocked: [],
      overdue: [],
      today: [],
      upcoming: [],
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
      else if (t.due <= last) buckets.upcoming.push(t);
      else buckets.later.push(t);
    }
    for (const list of Object.values(buckets)) list.sort(byDueThenPriority);
    return buckets;
  },
);

/** The buckets Focus's Due draws from: Day's two, Week's three. */
export type DueKey = Extract<
  keyof FocusBuckets,
  'overdue' | 'today' | 'upcoming'
>;

/**
 * Focus's Due: the view's buckets, then every High priority task the
 * view would leave out, whatever its date (due later or not at all), so
 * the important work stays in sight. Blocked tasks stay in Waiting on.
 */
export function focusDue(
  buckets: FocusBuckets,
  keys: readonly DueKey[],
): Task[] {
  const rest = (['upcoming', 'later', 'noDate'] as const).filter(
    (key) => !(keys as readonly string[]).includes(key),
  );
  return [
    ...keys.flatMap((key) => buckets[key]),
    ...rest.flatMap((key) => buckets[key].filter((t) => t.priority === 'high')),
  ];
}

export interface PriorityGroup {
  priority: Priority;
  tasks: Task[];
}

/**
 * Focus's Due (#218): tasks by priority, High first and No priority
 * last, each group keeping the order it was given; empty groups left out.
 */
export function byPriority(tasks: readonly Task[]): PriorityGroup[] {
  const order: Priority[] = ['high', 'med', 'low', 'none'];
  return order.flatMap((priority) => {
    const group = tasks.filter((t) => t.priority === priority);
    return group.length > 0 ? [{ priority, tasks: group }] : [];
  });
}

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
 * Meetings and milestones in the next `days` (seven unless Focus's setting
 * says otherwise; today included), outside
 * archived projects, as one list: by day, all-day items first within a
 * day, then by time and title.
 */
export const agenda = lastCall(
  (
    meetings: Snapshot['meetings'],
    projects: Projects,
    today: DateString,
    days: number = FOCUS_DAYS,
  ): AgendaItem[] => {
    const last = addDays(today, days - 1);
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
}

const NO_STATS: PersonStats = {
  projects: [],
  open: [],
  waiting: [],
};

/** Per person: their projects and open tasks (People list, detail, cards). */
export const peopleStats = lastCall(
  (projects: Projects, tasks: Tasks): Map<string, PersonStats> => {
    const stats = new Map<string, PersonStats>();
    const entry = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        s = { projects: [], open: [], waiting: [] };
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
    for (const s of stats.values()) {
      s.projects.sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
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

/* ---- Focus's briefing ---------------------------------------------------- */

/** The days Focus's header and its Follow-ups look back over. */
export const BRIEFING_WEEK = 7;
/** A target this many days away (or past) puts a project in Attention. */
export const ATTENTION_TARGET_DAYS = 14;
/** A project unchanged this many days is quiet. */
export const ATTENTION_QUIET_DAYS = 14;

/** Outside the archive: General, or a project that is not archived. */
const unarchived = (projects: Projects, projectId: string | null) =>
  projectId === null || !projects[projectId]?.archived;

/** Whole days from a timestamp's local day to `today`, never below 0. */
export function daysSince(timestamp: Timestamp, today: DateString): number {
  return Math.max(0, daysBetween(dayOf(timestamp), today));
}

/** Focus's header: the week's movement, whatever the assignee filter. */
export interface WeekMovement {
  /** Closed in the last seven days, today included. */
  closed: number;
  /** Created in the last seven days, today included. */
  added: number;
  /** Open and due before today, blocked or not. */
  overdue: number;
}

/** Tasks outside the archive, against the last `BRIEFING_WEEK` days. */
export const weekMovement = lastCall(
  (tasks: Tasks, projects: Projects, today: DateString): WeekMovement => {
    const since = addDays(today, -(BRIEFING_WEEK - 1));
    const inWeek = (timestamp: Timestamp) => {
      const day = dayOf(timestamp);
      return day >= since && day <= today;
    };
    const out: WeekMovement = { closed: 0, added: 0, overdue: 0 };
    for (const t of Object.values(tasks)) {
      if (!unarchived(projects, t.projectId)) continue;
      if (t.status === 'done' && t.completedAt && inWeek(t.completedAt)) {
        out.closed += 1;
      }
      if (inWeek(t.createdAt)) out.added += 1;
      if (t.status === 'open' && t.due !== '' && t.due < today) {
        out.overdue += 1;
      }
    }
    return out;
  },
);

/** "5 closed this week · 3 added · 2 overdue". */
export function movementLine(m: WeekMovement): string {
  return `${m.closed} closed this week · ${m.added} added · ${m.overdue} overdue`;
}

/** Blocked tasks waiting on one person (or on no one listed). */
export interface WaitingGroup {
  /** null: Not on anyone (or on someone no longer listed). */
  person: Person | null;
  /** Longest waiting first. */
  tasks: Task[];
  /** When the longest waiting last changed (`setBlocked` bumps it). */
  since: Timestamp;
}

/**
 * Open blocked tasks outside the archive that match the assignee filter,
 * grouped by who they wait on: by name, Not on anyone last.
 */
export const waitingOn = lastCall(
  (
    tasks: Tasks,
    projects: Projects,
    people: Snapshot['people'],
    me: string | null,
    filter: AssigneeFilter,
  ): WaitingGroup[] => {
    const groups = new Map<string, Task[]>();
    for (const t of Object.values(tasks)) {
      const blocked = blockedOf(t);
      if (!blocked || t.status !== 'open') continue;
      if (!unarchived(projects, t.projectId)) continue;
      if (!matchesAssignee(t, filter, me)) continue;
      const key = blocked.on && people[blocked.on] ? blocked.on : '';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const out: WaitingGroup[] = [...groups].map(([key, list]) => {
      list.sort(
        (a, b) =>
          a.updatedAt.localeCompare(b.updatedAt) ||
          a.title.localeCompare(b.title),
      );
      return {
        person: key ? (people[key] ?? null) : null,
        tasks: list,
        since: list[0]?.updatedAt ?? '',
      };
    });
    return out.sort(
      (a, b) =>
        Number(a.person === null) - Number(b.person === null) ||
        (a.person?.name ?? '').localeCompare(b.person?.name ?? ''),
    );
  },
);

const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "waiting 9 days", "waiting 1 day", "waiting since today". */
export function waitingFor(days: number): string {
  return days <= 0 ? 'waiting since today' : `waiting ${dayCount(days)}`;
}

/** Why a project is in Attention. */
export type AttentionReason =
  | { kind: 'health'; health: 'yellow' | 'red' }
  /** Days to the target date: 0 today, negative once it has passed. */
  | { kind: 'target'; days: number }
  /** Days since it last changed. */
  | { kind: 'quiet'; days: number };

export interface AttentionItem {
  project: Project;
  reasons: AttentionReason[];
}

const HEALTH_RANK = { red: 0, yellow: 1, green: 2, none: 2 } as const;

/**
 * Active projects outside the archive that need a look: health yellow or
 * red; a target date past or within `ATTENTION_TARGET_DAYS`; or no change
 * in `ATTENTION_QUIET_DAYS`. Red first, then yellow, then by target date
 * (none last), then name.
 */
export const attention = lastCall(
  (projects: Projects, today: DateString): AttentionItem[] => {
    const out: AttentionItem[] = [];
    for (const p of Object.values(projects)) {
      if (p.archived || p.status !== 'active') continue;
      const reasons: AttentionReason[] = [];
      const health = healthOf(p);
      if (health === 'yellow' || health === 'red') {
        reasons.push({ kind: 'health', health });
      }
      if (p.targetDate) {
        const days = daysBetween(today, p.targetDate);
        if (days <= ATTENTION_TARGET_DAYS) {
          reasons.push({ kind: 'target', days });
        }
      }
      const quiet = daysSince(p.updatedAt, today);
      if (quiet >= ATTENTION_QUIET_DAYS) {
        reasons.push({ kind: 'quiet', days: quiet });
      }
      if (reasons.length > 0) out.push({ project: p, reasons });
    }
    return out.sort(
      (a, b) =>
        HEALTH_RANK[healthOf(a.project)] - HEALTH_RANK[healthOf(b.project)] ||
        Number(a.project.targetDate === '') -
          Number(b.project.targetDate === '') ||
        a.project.targetDate.localeCompare(b.project.targetDate) ||
        a.project.name.localeCompare(b.project.name),
    );
  },
);

/** "yellow · target in 6 days · quiet 16 days". */
export function attentionLine(reasons: readonly AttentionReason[]): string {
  return reasons
    .map((r) => {
      if (r.kind === 'health') return r.health;
      if (r.kind === 'quiet') return `quiet ${dayCount(r.days)}`;
      if (r.days < 0) return `target passed ${dayCount(-r.days)} ago`;
      if (r.days === 0) return 'target today';
      if (r.days === 1) return 'target tomorrow';
      return `target in ${dayCount(r.days)}`;
    })
    .join(' · ');
}

/** A recent meeting's open action items. */
export interface FollowUp {
  meeting: Meeting;
  /** Oldest first, as on the meeting. */
  tasks: Task[];
}

/**
 * Open action items (`Task.meetingId`) matching the assignee filter and
 * not blocked (those are in Waiting on), from
 * meetings outside the archive held in the last `BRIEFING_WEEK` days
 * (today and a week ago today included, so last week's instance of a
 * weekly meeting counts), grouped by meeting, newest meeting first.
 */
export const followUps = lastCall(
  (
    meetings: Snapshot['meetings'],
    tasks: Tasks,
    projects: Projects,
    today: DateString,
    me: string | null,
    filter: AssigneeFilter,
  ): FollowUp[] => {
    const since = addDays(today, -BRIEFING_WEEK);
    const groups = new Map<string, Task[]>();
    for (const t of Object.values(tasks)) {
      const m = t.meetingId ? meetings[t.meetingId] : undefined;
      if (!m || t.status !== 'open' || blockedOf(t)) continue;
      if (m.date < since || m.date > today) continue;
      if (!unarchived(projects, t.projectId)) continue;
      if (!unarchived(projects, m.projectId)) continue;
      if (!matchesAssignee(t, filter, me)) continue;
      groups.set(m.id, [...(groups.get(m.id) ?? []), t]);
    }
    const out: FollowUp[] = [];
    for (const [id, list] of groups) {
      const meeting = meetings[id];
      if (!meeting) continue;
      list.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      out.push({ meeting, tasks: list });
    }
    return out.sort((a, b) => byWhen(b.meeting, a.meeting));
  },
);

/** Where a meeting on the agenda stands, for its card. */
export interface Prep {
  topics: number;
  /** Topics not covered yet. */
  left: number;
  /** Of those, carried forward from an earlier meeting (`carriedFrom`). */
  carried: number;
  /** The previous meeting in its series, if any. */
  previous: Meeting | null;
  /** The previous meeting's open action items. */
  actionItems: number;
  hasNote: boolean;
}

export function prepOf(
  meeting: Meeting,
  snapshot: Pick<Snapshot, 'meetings' | 'tasks' | 'notes'>,
): Prep {
  const topics = topicsOf(meeting);
  const left = topics.filter((t) => !t.done);
  const previous = previousMeeting(snapshot.meetings, meeting);
  return {
    topics: topics.length,
    left: left.length,
    carried: left.filter((t) => t.carriedFrom).length,
    previous,
    actionItems: previous
      ? tasksOfMeeting(snapshot.tasks, previous.id).open.length
      : 0,
    hasNote: Object.values(snapshot.notes).some(
      (n) => n.meetingId === meeting.id,
    ),
  };
}

/**
 * An agenda card's one line: "2 of 5 topics left · 1 carried · 3 action
 * items open from Tue 20 Oct · no note yet", each part only when it says
 * something; empty when nothing does.
 */
export function prepLine(prep: Prep, today: DateString): string {
  const parts: string[] = [];
  if (prep.topics > 0) {
    parts.push(
      prep.left > 0
        ? `${prep.left} of ${prep.topics} ${prep.topics === 1 ? 'topic' : 'topics'} left`
        : 'all topics covered',
    );
  }
  if (prep.carried > 0) parts.push(`${prep.carried} carried`);
  if (prep.previous && prep.actionItems > 0) {
    const items = prep.actionItems === 1 ? 'action item' : 'action items';
    parts.push(
      `${prep.actionItems} ${items} open from ${formatDay(prep.previous.date, today)}`,
    );
  }
  if (!prep.hasNote) parts.push('no note yet');
  return parts.join(' · ');
}
