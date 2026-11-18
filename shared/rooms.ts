/**
 * Rooms and the rail (#329), as pure functions. A room is one project's
 * or one person's page, or a project seen through one person (#334,
 * #335). The rail lists Today, Scratch and All, then the rooms: the
 * pinned ones in your order, or before anything is pinned the active
 * projects by recent change, then the people who owe you something.
 *
 * Pins are stored per space in `settings.pinned` (`setSettings`), each
 * entry a project id, a person id, `<projectId>+<personId>`, or
 * `view:<id>` for a view saved on All (#338), which pins like a room. The
 * only navigation setting: Settings → Navigation and its `nav` prefs
 * retired with v2.
 */

import { viewRoute } from './all';
import { lanesOf, waitingPeople } from './loops';
import { inScratch } from './notes';
import { projectRoomOf, type Route, roomTabRoute } from './routes';
import { meId } from './select';
import {
  type Person,
  type Project,
  type SavedView,
  type Settings,
  type Snapshot,
  settingsOf,
} from './types';

export type Room =
  | { kind: 'project'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'pair'; project: string; person: string }
  | { kind: 'view'; id: string };

/** Between a pair's project id and person id. */
const PAIR = '+';
/** Before a saved view's id. */
const VIEW = 'view:';

/** The key a room is pinned under. */
export function roomKey(room: Room): string {
  if (room.kind === 'pair') return `${room.project}${PAIR}${room.person}`;
  if (room.kind === 'view') return `${VIEW}${room.id}`;
  return room.id;
}

/** What `roomOf` reads: the projects, people and (for views) settings. */
type RoomState = Pick<Snapshot, 'projects' | 'people'> &
  Partial<Pick<Snapshot, 'settings'>>;

/** The views saved on All (#338), as they stand. */
export function savedViews(state: Partial<Pick<Snapshot, 'settings'>>) {
  if (!state.settings) return [];
  return settingsOf({ settings: state.settings }).pages?.all?.views ?? [];
}

/** The saved view a room names, if it still exists. */
export function viewOf(
  room: Room,
  state: Partial<Pick<Snapshot, 'settings'>>,
): SavedView | undefined {
  if (room.kind !== 'view') return undefined;
  return savedViews(state).find((v) => v.id === room.id);
}

/**
 * The room a pinned entry names, or null when it names nothing in the
 * space (a deleted project, a removed person): such an entry is skipped,
 * and kept until it is unpinned.
 */
export function roomOf(entry: string, state: RoomState): Room | null {
  if (entry.startsWith(VIEW)) {
    const id = entry.slice(VIEW.length);
    return savedViews(state).some((v) => v.id === id)
      ? { kind: 'view', id }
      : null;
  }
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

/** The query key that narrows a project's room to one person (#334). */
export const PERSON_PARAM = 'person';

/** The query key that narrows a person's room to one project (#335). */
export const PROJECT_PARAM = 'project';

/**
 * What a room page is narrowed to: on a person's room the project
 * (`?project=`), on a project's room the person (`?person=`).
 */
export function narrowedOf(route: Route, query: URLSearchParams) {
  return query.get(route.name === 'person' ? PROJECT_PARAM : PERSON_PARAM);
}

/**
 * Where a room is: a project's room, a person's, a pair as the project's
 * room narrowed to the person (`?person=`), or a saved view's All. A pair
 * pinned from the person's room (`?project=`) is the same pin: both show
 * the same items.
 */
/**
 * Where a project's room opens from the rail, All and Search: the tab
 * Settings → Rooms names (#343), Stream until changed.
 */
export function projectHome(
  id: string,
  state: Partial<Pick<Snapshot, 'settings'>> = {},
): Route {
  const tab = state.settings
    ? settingsOf({ settings: state.settings }).roomTab
    : 'stream';
  return roomTabRoute(id, tab);
}

export function roomLink(
  room: Room,
  state: Partial<Pick<Snapshot, 'settings'>> = {},
): { route: Route; query: string } {
  if (room.kind === 'view') return viewRoute(viewOf(room, state)?.query ?? '');
  if (room.kind === 'person') {
    return { route: { name: 'person', id: room.id }, query: '' };
  }
  if (room.kind === 'project') {
    return { route: projectHome(room.id, state), query: '' };
  }
  return {
    route: projectHome(room.project, state),
    query: new URLSearchParams({ [PERSON_PARAM]: room.person }).toString(),
  };
}

/**
 * Whether a page is `room`: a project's room (any tab) with no one, or
 * with the pair's person, picked; a person's room with no project, or
 * with the pair's project, picked; a saved view's All when `hereView`
 * (the view All shows now) is it. `narrowedTo` is `narrowedOf`.
 */
export function isRoomPage(
  room: Room,
  route: Route,
  narrowedTo: string | null,
  hereView?: string,
): boolean {
  if (room.kind === 'view') return route.name === 'all' && hereView === room.id;
  if (route.name === 'person') {
    if (room.kind === 'person') return route.id === room.id && !narrowedTo;
    return (
      room.kind === 'pair' &&
      room.person === route.id &&
      room.project === narrowedTo
    );
  }
  if (room.kind === 'person') return false;
  const project = projectRoomOf(route)?.id;
  if (room.kind === 'project') return project === room.id && !narrowedTo;
  return project === room.project && narrowedTo === room.person;
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
  state: RoomState,
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

/** The projects hidden from the rail, each once. */
export function hiddenOf(settings: Pick<Settings, 'hiddenRooms'>): string[] {
  return [...new Set(settings.hiddenRooms ?? [])];
}

export function isHidden(
  settings: Pick<Settings, 'hiddenRooms'>,
  projectId: string,
): boolean {
  return hiddenOf(settings).includes(projectId);
}

/**
 * The settings patch that hides a project from the rail, or shows it
 * again. Hiding also unpins the project's own room, so it leaves the
 * rail whichever list it is on; a pair with a person stays pinned.
 */
export function hidePatch(
  settings: Pick<Settings, 'hiddenRooms' | 'pinned'>,
  projectId: string,
  hidden: boolean,
): Pick<Settings, 'hiddenRooms' | 'pinned'> {
  const rest = hiddenOf(settings).filter((id) => id !== projectId);
  if (!hidden) return { hiddenRooms: rest };
  return {
    hiddenRooms: [...rest, projectId],
    pinned: withPin(settings, { kind: 'project', id: projectId }, false),
  };
}

/** The hidden projects that still exist, by name. */
export function hiddenProjects(
  settings: Pick<Settings, 'hiddenRooms'>,
  projects: Snapshot['projects'],
): Project[] {
  return hiddenOf(settings)
    .map((id) => (Object.hasOwn(projects, id) ? projects[id] : undefined))
    .filter((p): p is Project => p !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The pinned rooms that exist, in order. */
export function pinnedRooms(
  settings: Pick<Settings, 'pinned'>,
  state: RoomState,
): Room[] {
  return pinnedOf(settings)
    .map((key) => roomOf(key, state))
    .filter((room): room is Room => room !== null);
}

/**
 * Not archived, not done and not hidden: what the rail shows before any
 * pin.
 */
function liveProjects(
  projects: Snapshot['projects'],
  hidden: Set<string>,
): Project[] {
  return Object.values(projects)
    .filter((p) => !p.archived && p.status !== 'done' && !hidden.has(p.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The rail's rooms: the pinned ones in order, or with none pinned the
 * active projects not hidden, most recently changed first. `pinned` says
 * which.
 */
export function railRooms(
  settings: Pick<Settings, 'pinned' | 'hiddenRooms'>,
  state: RoomState,
): { pinned: boolean; rooms: Room[] } {
  const pinned = pinnedRooms(settings, state);
  if (pinned.length > 0) return { pinned: true, rooms: pinned };
  return {
    pinned: false,
    rooms: liveProjects(state.projects, new Set(hiddenOf(settings))).map(
      (p) => ({
        kind: 'project',
        id: p.id,
      }),
    ),
  };
}

/** How many people the rail lists as owing you something, at most. */
export const OWED_MAX = 5;

/**
 * The people who owe you something, most first, then by name: Today's
 * Waiting on lane (`lanesOf`), by person: open tasks blocked on them, or
 * assigned to them and not to you, that are not to decide. Archived
 * projects' tasks do not count, nor does the person
 * marked as you, nor anyone already pinned as a room. `OWED_MAX` at most.
 */
export function owedBy(
  state: Pick<Snapshot, 'tasks' | 'projects' | 'people'>,
  settings: Pick<Settings, 'pinned'> = {},
): { person: Person; count: number }[] {
  const me = meId(state.people);
  const pinned = new Set(pinnedOf(settings));
  return waitingPeople(lanesOf(state, me), state.people)
    .filter(({ person }) => person.id !== me && !pinned.has(person.id))
    .map(({ person, tasks }) => ({ person, count: tasks.length }))
    .sort(
      (a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name),
    )
    .slice(0, OWED_MAX);
}

/**
 * Every person but you, by how much they owe you (as `owedBy` counts it),
 * most first, then by name: All's people rooms (#337).
 */
export function peopleByOwed(
  state: Pick<Snapshot, 'tasks' | 'projects' | 'people'>,
): { person: Person; count: number }[] {
  const me = meId(state.people);
  const counts = new Map(
    waitingPeople(lanesOf(state, me), state.people).map(({ person, tasks }) => [
      person.id,
      tasks.length,
    ]),
  );
  return Object.values(state.people)
    .filter((person) => person.id !== me)
    .map((person) => ({ person, count: counts.get(person.id) ?? 0 }))
    .sort(
      (a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name),
    );
}

/**
 * All's project rooms (#337): every project not archived, by name, under
 * its org (orgs A to Z, then those with none, under `''`).
 */
export function projectRoomsByOrg(
  projects: Snapshot['projects'],
): { org: string; projects: Project[] }[] {
  const groups = new Map<string, Project[]>();
  for (const project of Object.values(projects)) {
    if (project.archived) continue;
    const org = project.org.trim();
    groups.set(org, [...(groups.get(org) ?? []), project]);
  }
  return [...groups]
    .map(([org, list]) => ({
      org,
      projects: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) => Number(!a.org) - Number(!b.org) || a.org.localeCompare(b.org),
    );
}

/** How many notes have no home yet: Scratch's count. */
export function scratchCount(notes: Snapshot['notes']): number {
  let count = 0;
  for (const note of Object.values(notes)) if (inScratch(note)) count++;
  return count;
}
