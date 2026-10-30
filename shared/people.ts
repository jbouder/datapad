import { LIMITS } from './limits';
import { queryWords } from './notes';
import type { Org, Person } from './types';

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

/**
 * People's Find (#272): the people whose name, role or orgs (those that
 * list them as a contact) hold every word typed, ignoring case, in the
 * order given. No words, everyone.
 */
export function findPeople<T extends Pick<Person, 'id' | 'name' | 'role'>>(
  people: readonly T[],
  q: string,
  orgs: Record<string, Pick<Org, 'name' | 'contacts'>>,
): T[] {
  const words = queryWords(q);
  if (words.length === 0) return [...people];
  const orgNames = new Map<string, string[]>();
  for (const org of Object.values(orgs)) {
    for (const id of org.contacts) {
      orgNames.set(id, [...(orgNames.get(id) ?? []), org.name]);
    }
  }
  return people.filter((p) => {
    const text = [p.name, p.role, ...(orgNames.get(p.id) ?? [])]
      .join('\n')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
