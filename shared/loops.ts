/**
 * Open loops (#331), as pure functions: every open task in a live
 * project, split three ways. To decide is a task marked `decide`.
 * Waiting on is one blocked (on someone, or on nobody listed) or assigned
 * to someone other than you. Mine is the rest. Today shows the three
 * lanes, the rooms (#334, #335) narrow them with `keep`, and the rail
 * counts who owes you something from the same split (`owedBy`).
 */
import { mentionedIds } from './mentions';
import {
  blockedOf,
  decideOf,
  type Person,
  type Snapshot,
  type Task,
} from './types';

/** The Waiting on group for tasks waiting on nobody listed. */
export const NOBODY = '';

export interface WaitingLane {
  /** The person it waits on, or `NOBODY`. */
  personId: string;
  tasks: Task[];
}

export interface Lanes {
  mine: Task[];
  /** By who it waits on: most tasks first, then by name, nobody last. */
  waiting: WaitingLane[];
  decide: Task[];
}

/**
 * Who an open task waits on: the person it is blocked on (`NOBODY` when
 * blocked on no one listed), else its assignee when that is not `me`;
 * null when it is yours to do (assigned to you or no one, and not
 * blocked on anyone else; blocked on you is yours).
 */
export function waitingOf(task: Task, me: string | null): string | null {
  const blocked = blockedOf(task);
  if (blocked) {
    // Blocked on me is mine to unblock, whoever it is assigned to.
    return me && blocked.on === me ? null : (blocked.on ?? NOBODY);
  }
  if (task.assignee && task.assignee !== me) return task.assignee;
  return null;
}

/** Due first (no date last), then the manual order, then the title. */
export function byLoop(a: Task, b: Task): number {
  const ad = a.due || '9999-99-99';
  const bd = b.due || '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.order - b.order || a.title.localeCompare(b.title);
}

/** Open, and not in an archived project. */
export function isOpenLoop(
  task: Task,
  projects: Snapshot['projects'],
): boolean {
  if (task.status !== 'open') return false;
  return !(task.projectId && projects[task.projectId]?.archived);
}

/**
 * The open loops in three lanes, each sorted by `byLoop`; only the tasks
 * `keep` passes, when given. `me` is the person marked as you, or null
 * (then every assigned task waits on its assignee).
 */
export function lanesOf(
  state: Pick<Snapshot, 'tasks' | 'projects' | 'people'>,
  me: string | null,
  keep?: (task: Task) => boolean,
): Lanes {
  const mine: Task[] = [];
  const decide: Task[] = [];
  const waiting = new Map<string, Task[]>();
  for (const task of Object.values(state.tasks)) {
    if (!isOpenLoop(task, state.projects)) continue;
    if (keep && !keep(task)) continue;
    if (decideOf(task)) {
      decide.push(task);
      continue;
    }
    const on = waitingOf(task, me);
    if (on === null) mine.push(task);
    else waiting.set(on, [...(waiting.get(on) ?? []), task]);
  }
  const name = (id: string) => state.people[id]?.name ?? '';
  return {
    mine: mine.sort(byLoop),
    decide: decide.sort(byLoop),
    waiting: [...waiting]
      .map(([personId, tasks]) => ({ personId, tasks: tasks.sort(byLoop) }))
      .sort(
        (a, b) =>
          Number(a.personId === NOBODY) - Number(b.personId === NOBODY) ||
          b.tasks.length - a.tasks.length ||
          name(a.personId).localeCompare(name(b.personId)),
      ),
  };
}

/** How many tasks the Waiting on lane holds. */
export function waitingCount(lanes: Pick<Lanes, 'waiting'>): number {
  return lanes.waiting.reduce((n, group) => n + group.tasks.length, 0);
}

/** The Waiting on groups whose person exists, with that person. */
export function waitingPeople(
  lanes: Pick<Lanes, 'waiting'>,
  people: Snapshot['people'],
): { person: Person; tasks: Task[] }[] {
  const out: { person: Person; tasks: Task[] }[] = [];
  for (const { personId, tasks } of lanes.waiting) {
    const person = people[personId];
    if (person) out.push({ person, tasks });
  }
  return out;
}

/**
 * Whether a task has to do with `personId`: assigned to them, blocked on
 * them, or mentioning them in its description. A person's room keeps
 * these (#335).
 */
export function taskTouches(task: Task, personId: string): boolean {
  return (
    task.assignee === personId ||
    blockedOf(task)?.on === personId ||
    mentionedIds(task.desc).includes(personId)
  );
}
