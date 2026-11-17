/**
 * Rooms and the rail (#329), as pure functions. A room is one project's
 * or one person's page, or a project seen through one person (#334,
 * #335). The rail lists Today, Unfiled and All, then the rooms: the
 * pinned ones in your order, or before anything is pinned the active
 * projects by recent change, then the people who owe you something.
 *
 * Pins are stored per space in `settings.pinned` (`setSettings`), each
 * entry a project id, a person id, or `<projectId>+<personId>`. The
 * only navigation setting: Settings → Navigation and its `nav` prefs
 * retired with v2.
 */
import { isUnfiled } from './notes';
import { meId } from './select';
import {
  blockedOf,
  type Person,
  type Project,
  type Settings,
  type Snapshot,
} from './types';

export type Room =
  | { kind: 'project'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'pair'; project: string; person: string };

/** Between a pair's project id and person id. */
const PAIR = '+';

/** The key a room is pinned under. */
export function roomKey(room: Room): string {
  if (room.kind === 'pair') return `${room.project}${PAIR}${room.person}`;
  return room.id;
}

/**
 * The room a pinned entry names, or null when it names nothing in the
 * space (a deleted project, a removed person): such an entry is skipped,
 * and kept until it is unpinned.
 */
export function roomOf(
  entry: string,
  state: Pick<Snapshot, 'projects' | 'people'>,
): Room | null {
  if (Object.hasOwn(state.projects, entry)) {
    return { kind: 'project', id: entry };
  }
  if (Object.hasOwn(state.people, entry)) return { kind: 'person', id: entry };
  const at = entry.indexOf(PAIR);
  if (at <= 0) return null;
  const project = entry.slice(0, at);
  const person = entry.slice(at + 1);
  return Object.hasOwn(state.projects, project) &&
    Object.hasOwn(state.people, person)
    ? { kind: 'pair', project, person }
    : null;
}

/** The pinned entries as stored, each once. */
export function pinnedOf(settings: Pick<Settings, 'pinned'>): string[] {
  return [...new Set(settings.pinned ?? [])];
}

export function isPinned(
  settings: Pick<Settings, 'pinned'>,
  room: Room,
): boolean {
  return pinnedOf(settings).includes(roomKey(room));
}

/** The pins with `room` pinned (at the end) or unpinned. */
export function withPin(
  settings: Pick<Settings, 'pinned'>,
  room: Room,
  pinned: boolean,
): string[] {
  const key = roomKey(room);
  const rest = pinnedOf(settings).filter((k) => k !== key);
  return pinned ? [...rest, key] : rest;
}

/**
 * The pins with `key` moved one place up (-1) or down (1) among the
 * rooms that still exist; null at either end, or when it is not pinned.
 * Stale entries keep their places.
 */
export function movePin(
  settings: Pick<Settings, 'pinned'>,
  state: Pick<Snapshot, 'projects' | 'people'>,
  key: string,
  by: -1 | 1,
): string[] | null {
  const pins = pinnedOf(settings);
  const live = pins.filter((k) => roomOf(k, state));
  const from = live.indexOf(key);
  const to = from + by;
  if (from === -1 || to < 0 || to >= live.length) return null;
  const other = live[to] as string;
  return pins.map((k) => (k === key ? other : k === other ? key : k));
}

/** The pinned rooms that exist, in order. */
export function pinnedRooms(
  settings: Pick<Settings, 'pinned'>,
  state: Pick<Snapshot, 'projects' | 'people'>,
): Room[] {
  return pinnedOf(settings)
    .map((key) => roomOf(key, state))
    .filter((room): room is Room => room !== null);
}

/** Not archived and not done: what the rail shows before any pin. */
function liveProjects(projects: Snapshot['projects']): Project[] {
  return Object.values(projects)
    .filter((p) => !p.archived && p.status !== 'done')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The rail's rooms: the pinned ones in order, or with none pinned the
 * active projects, most recently changed first. `pinned` says which.
 */
export function railRooms(
  settings: Pick<Settings, 'pinned'>,
  state: Pick<Snapshot, 'projects' | 'people'>,
): { pinned: boolean; rooms: Room[] } {
  const pinned = pinnedRooms(settings, state);
  if (pinned.length > 0) return { pinned: true, rooms: pinned };
  return {
    pinned: false,
    rooms: liveProjects(state.projects).map((p) => ({
      kind: 'project',
      id: p.id,
    })),
  };
}

/** How many people the rail lists as owing you something, at most. */
export const OWED_MAX = 5;

/**
 * The people who owe you something, most first, then by name: those an
 * open task waits on (blocked on them), or that is assigned to them and
 * not to you. Archived projects' tasks do not count, nor does the person
 * marked as you, nor anyone already pinned as a room. `OWED_MAX` at most.
 */
export function owedBy(
  state: Pick<Snapshot, 'tasks' | 'projects' | 'people'>,
  settings: Pick<Settings, 'pinned'> = {},
): { person: Person; count: number }[] {
  const me = meId(state.people);
  const pinned = new Set(pinnedOf(settings));
  const counts = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'open') continue;
    if (task.projectId && state.projects[task.projectId]?.archived) continue;
    const blocked = blockedOf(task);
    const on = blocked ? blocked.on : task.assignee;
    if (!on || on === me || pinned.has(on)) continue;
    counts.set(on, (counts.get(on) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, count]) => ({ person: state.people[id], count }))
    .filter((p): p is { person: Person; count: number } => Boolean(p.person))
    .sort(
      (a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name),
    )
    .slice(0, OWED_MAX);
}

/** How many notes have no home yet: Unfiled's count. */
export function unfiledCount(notes: Snapshot['notes']): number {
  let count = 0;
  for (const note of Object.values(notes)) if (isUnfiled(note)) count++;
  return count;
}
