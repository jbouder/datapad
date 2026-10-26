import { LIMITS } from './limits';

/**
 * Adding a person or an org by name from inside a form (#160). Names are
 * matched trimmed and ignoring case, so typing a name that exists picks
 * that record instead of making a second one.
 */

const key = (name: string) => name.trim().toLowerCase();

/** The record a name means, ignoring case and outer spaces, if any. */
export function byName<T extends { id: string; name: string }>(
  records: Record<string, T>,
  name: string,
): T | undefined {
  const k = key(name);
  return k ? Object.values(records).find((r) => key(r.name) === k) : undefined;
}

/** What adding a typed name should do. */
export type InlineAddPlan =
  | { kind: 'empty' }
  | { kind: 'tooLong' }
  | { kind: 'existing'; id: string; name: string }
  | { kind: 'new'; name: string };

/**
 * Nothing for a blank name, a refusal past `LIMITS.nameMax`, the record
 * an existing name already means, or the trimmed name to create.
 */
export function planInlineAdd<T extends { id: string; name: string }>(
  records: Record<string, T>,
  raw: string,
): InlineAddPlan {
  const name = raw.trim();
  if (!name) return { kind: 'empty' };
  if (name.length > LIMITS.nameMax) return { kind: 'tooLong' };
  const found = byName(records, name);
  return found
    ? { kind: 'existing', id: found.id, name: found.name }
    : { kind: 'new', name };
}
