import type { Person } from './types';

/**
 * Mentions are stored as `@{personId}` tokens and edited as `@Name`
 * (docs/SPEC.md § Mentions). Renaming a person therefore renames every
 * mention; a token whose person is gone reads `@unknown`.
 */

export const MENTION_TOKEN = /@\{([^}]+)\}/g;

/** For the editor: every `@{id}` as `@Name` (or `@unknown`). */
export function tokensToNames(
  text: string,
  people: Record<string, Person>,
): string {
  return text.replace(MENTION_TOKEN, (_, id: string) => {
    const person = people[id];
    return person ? `@${person.name}` : '@unknown';
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * For storage: every `@Name` that matches a person, longest names first
 * and not followed by a word character, as `@{id}`. Text that names
 * nobody stays as typed.
 */
export function namesToTokens(
  text: string,
  people: Record<string, Person>,
): string {
  const byLength = Object.values(people).sort(
    (a, b) => b.name.length - a.name.length,
  );
  let out = text;
  for (const p of byLength) {
    if (!p.name) continue;
    const pattern = new RegExp(
      `@${escapeRegExp(p.name)}(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    out = out.replace(pattern, `@{${p.id}}`);
  }
  return out;
}

/** The person ids a text mentions, in order, once each. */
export function mentionedIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_TOKEN)].map((m) => m[1] ?? ''))];
}

/**
 * The mention being typed at `caret`: `@` then up to 30 letters, digits or
 * spaces, starting the text or after a space. Null when there is none.
 */
export function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}

/** Up to `limit` people whose names start with the query (any case). */
export function mentionMatches(
  people: Record<string, Person>,
  query: string,
  limit = 8,
): Person[] {
  const q = query.toLowerCase();
  return Object.values(people)
    .filter((p) => p.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}
