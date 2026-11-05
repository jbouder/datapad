import { queryWords } from './notes';
import type { List, ListItem, Project } from './types';

/**
 * Lists (#298): titled checklists of one-line items that live on their
 * list. These are the small rules the views and the MCP tools share.
 */

/** How many of a list's items are done, of how many. */
export function listCounts(list: Pick<List, 'items'>): {
  done: number;
  total: number;
} {
  let done = 0;
  for (const i of list.items) if (i.done) done++;
  return { done, total: list.items.length };
}

/** A list's progress as it reads: "3 of 8". */
export function listProgress(list: Pick<List, 'items'>): string {
  const { done, total } = listCounts(list);
  return `${done} of ${total}`;
}

/** Done: it has items and every one is checked. An empty list is not. */
export function isListDone(list: Pick<List, 'items'>): boolean {
  const { done, total } = listCounts(list);
  return total > 0 && done === total;
}

/** How a list's items show: in the order chosen, or open ones first. */
export type ItemOrder = 'order' | 'open-first';

/**
 * A list's items in `order`: as the owner arranged them, or the open ones
 * first and then the done ones, each in that order.
 */
export function orderedItems(
  list: Pick<List, 'items'>,
  order: ItemOrder = 'order',
): ListItem[] {
  if (order === 'order') return [...list.items];
  return [
    ...list.items.filter((i) => !i.done),
    ...list.items.filter((i) => i.done),
  ];
}

/** A list's project, or null for General (or a project that is gone). */
export function listProject(
  list: Pick<List, 'projectId'>,
  projects: Record<string, Project>,
): Project | null {
  return list.projectId === null ? null : (projects[list.projectId] ?? null);
}

/** Which lists by how far along they are. */
export const LIST_STATES = ['all', 'in-progress', 'done'] as const;
export type ListState = (typeof LIST_STATES)[number];

export interface ListFilters {
  /** A project's id, null for General, undefined for every list. */
  projectId?: string | null;
  state?: ListState;
  /** Every word must be in the title or an item's text. */
  q?: string;
}

/**
 * The lists that pass `filters`, most recently updated first (then by
 * title). In progress is every list not done, empty ones included.
 */
export function selectLists(
  lists: Record<string, List>,
  filters: ListFilters = {},
): List[] {
  const words = queryWords(filters.q ?? '');
  const state = filters.state ?? 'all';
  return Object.values(lists)
    .filter((l) => {
      if (filters.projectId !== undefined && l.projectId !== filters.projectId)
        return false;
      if (state !== 'all' && isListDone(l) !== (state === 'done')) return false;
      if (words.length === 0) return true;
      const text = [l.title, ...l.items.map((i) => i.text)]
        .join('\n')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.title.localeCompare(b.title),
    );
}
