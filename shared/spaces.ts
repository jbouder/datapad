import { LIMITS } from './limits';
import type { SpaceInfo } from './types';

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
