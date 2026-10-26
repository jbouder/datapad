import { LIMITS } from './limits';
import { mentionedIds } from './mentions';
import { orgByName } from './orgs';
import type { ParsedExport } from './protocol';
import type { Changed } from './reducer';
import {
  blockedOf,
  type Collection,
  type Snapshot,
  type SpaceInfo,
} from './types';

/**
 * Spaces (M9): each one a complete, separate Datapad under the one
 * signed-in email. These rules are shared so the switcher and the Durable
 * Object agree on what a good name is and what order the spaces are in.
 * Names are unique, ignoring case, like orgs.
 */

const key = (name: string) => name.trim().toLowerCase();

export type SpaceNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/**
 * Whether `name` can name a space among `existing`: trimmed, not empty,
 * within the limit and not another space's name. `exceptId` is the space
 * being renamed, so keeping (or recasing) its own name is fine.
 */
export function validSpaceName(
  name: string,
  existing: readonly SpaceInfo[],
  exceptId?: string,
): SpaceNameCheck {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Give the space a name' };
  }
  if (trimmed.length > LIMITS.spaceNameMax) {
    return {
      ok: false,
      reason: `Space names are ${LIMITS.spaceNameMax} characters at most`,
    };
  }
  const k = key(trimmed);
  const taken = existing.some((s) => s.id !== exceptId && key(s.name) === k);
  if (taken) {
    return { ok: false, reason: `There is already a space called ${trimmed}` };
  }
  return { ok: true, name: trimmed };
}

/**
 * The spaces in switcher order: by position, then (should two ever share
 * one) by when they were made, then by id, so the order never depends on
 * how they were read. Returns a new array.
 */
export function orderedSpaces(spaces: readonly SpaceInfo[]): SpaceInfo[] {
  return [...spaces].sort(
    (a, b) =>
      a.position - b.position ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/** Where a new space goes: after the last one. */
export function nextPosition(spaces: readonly SpaceInfo[]): number {
  return spaces.reduce((max, s) => Math.max(max, s.position + 1), 0);
}

/* ---------- moving a project to another space ---------- */

/** Where a moved project came from and when, for its log in the target. */
export interface Arrival {
  /** The source space's name: "Moved from <name>". */
  from: string;
  at: string;
}

/** The collections a moved project takes with it (and leaves behind). */
const CARRIED = [
  'projects',
  'tasks',
  'notes',
  'meetings',
  'decisions',
  'activity',
] as const satisfies readonly Collection[];

/**
 * Everything a project takes to another space, as an import of it: the
 * project (its milestones inside it), its tasks, notes, meetings and
 * decisions (unlike deleting, its meetings and decisions go with it rather
 * than to General), its log with
 * "Moved from <space>" on top, and copies of the people and org it
 * refers to, so names resolve in the target. People: its members, its
 * tasks' assignees and who they are blocked on, its meetings' attendees,
 * its decisions' deciders, its org's contacts, and everyone mentioned in
 * its description, its tasks' descriptions, its notes, its decisions'
 * rationales and its org's notes. Its org: `orgId`, else the org its
 * text names.
 *
 * `target` is the space it lands in, so the copies fit there: a copied
 * person is not `me` when the target already has a `me` (else `merge()`
 * would demote the target's own), and an org the target already has by
 * name is used rather than copied (org names are unique). Null when the
 * project is not in `state`. Pure.
 */
export function projectSubtree(
  state: Snapshot,
  projectId: string,
  target: Snapshot,
  arrival: Arrival,
): ParsedExport | null {
  const project = state.projects[projectId];
  if (!project) return null;
  const out: ParsedExport = {
    exportedAt: arrival.at,
    projects: {},
    tasks: {},
    notes: {},
    meetings: {},
    people: {},
    decisions: {},
    orgs: {},
    templates: {},
    activity: {},
    settings: {},
  };
  const people = new Set<string>(project.members);
  const texts = [project.desc];
  const mine = <T extends { projectId: string | null }>(
    docs: Record<string, T>,
  ) => Object.entries(docs).filter(([, d]) => d.projectId === projectId);

  for (const [id, t] of mine(state.tasks)) {
    out.tasks[id] = t;
    if (t.assignee) people.add(t.assignee);
    const on = blockedOf(t)?.on;
    if (on) people.add(on);
    texts.push(t.desc);
  }
  for (const [id, n] of mine(state.notes)) {
    out.notes[id] = n;
    texts.push(n.body);
  }
  for (const [id, m] of mine(state.meetings)) {
    out.meetings[id] = m;
    for (const a of m.attendees) people.add(a);
  }
  for (const [id, x] of mine(state.decisions)) {
    out.decisions[id] = x;
    for (const p of x.deciders) people.add(p);
    texts.push(x.rationale);
  }

  const org =
    (project.orgId ? state.orgs[project.orgId] : undefined) ??
    orgByName(state.orgs, project.org);
  let orgId: string | undefined;
  if (org) {
    const there = orgByName(target.orgs, org.name);
    if (there && there.id !== org.id) {
      // The target has its own org by that name: the project joins it.
      orgId = there.id;
    } else {
      out.orgs[org.id] = org;
      orgId = org.id;
      for (const c of org.contacts) people.add(c);
      texts.push(org.notes);
    }
  }

  for (const text of texts) {
    for (const id of mentionedIds(text)) people.add(id);
  }
  const targetHasMe = Object.values(target.people).some((p) => p.me);
  for (const id of people) {
    const person = state.people[id];
    if (!person) continue; // a dangling reference, or a mention of no one
    // Whoever is `me` in the target stays so; else `me` comes along.
    const me = targetHasMe ? (target.people[id]?.me ?? false) : person.me;
    out.people[id] = person.me === me ? person : { ...person, me };
  }

  const { orgId: _, ...rest } = project;
  out.projects[projectId] = {
    ...rest,
    ...(orgId ? { orgId } : {}),
    updatedAt: arrival.at,
  };
  const log = state.activity[projectId]?.events ?? [];
  out.activity[projectId] = {
    events: [
      { t: arrival.at, text: `Moved from ${arrival.from}` },
      ...log,
    ].slice(0, LIMITS.activityMax),
  };
  return out;
}

/**
 * The source's side of a move: `state` without the documents `subtree`
 * carries away (the project, its tasks, notes, meetings, decisions and
 * log). People and orgs stay: other projects may still need them.
 * Returns every row it deleted, for the Durable Object to write. Pure,
 * and the counterpart of `merge()` on the target, which is why it is not
 * an op: a move spans two spaces, and an op only ever changes one.
 */
export function removeSubtree(
  state: Snapshot,
  subtree: ParsedExport,
): { state: Snapshot; changed: Changed[] } {
  const next: Snapshot = { ...state };
  const changed: Changed[] = [];
  for (const col of CARRIED) {
    const gone = Object.keys(subtree[col]).filter((id) => id in state[col]);
    if (gone.length === 0) continue;
    const kept: Record<string, unknown> = { ...state[col] };
    for (const id of gone) {
      delete kept[id];
      changed.push({ col, id, deleted: true });
    }
    (next as Record<Collection, unknown>)[col] = kept;
  }
  return { state: next, changed };
}
