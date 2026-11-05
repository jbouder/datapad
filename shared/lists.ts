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

/** How the Lists page orders them (#299). */
export const LIST_SORTS = ['updated', 'created', 'title'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export interface ListFilters {
  /** A project's id, null for General, undefined for every list. */
  projectId?: string | null;
  state?: ListState;
  /** Every word must be in the title or an item's text. */
  q?: string;
  /** Recently updated (the default), newest created, or by title. */
  sort?: ListSort;
}

const byTitle = (a: List, b: List) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
  a.id.localeCompare(b.id);

const COMPARE: Record<ListSort, (a: List, b: List) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt) || byTitle(a, b),
  title: byTitle,
};

/**
 * The lists that pass `filters`, in `sort`'s order: most recently updated
 * first by default (then by title). In progress is every list not done,
 * empty ones included.
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
    .sort(COMPARE[filters.sort ?? 'updated']);
}

/**
 * The Lists page's controls from its query (`?project=`, `?show=`,
 * `?sort=`, `?q=`), as `selectLists` takes them: `general` is General, a
 * value the page does not have reads as its default.
 */
export function listFiltersOf(query: URLSearchParams): ListFilters {
  const project = query.get('project');
  const show = query.get('show');
  const sort = query.get('sort');
  return {
    ...(project ? { projectId: project === 'general' ? null : project } : {}),
    state: LIST_STATES.find((s) => s === show) ?? 'all',
    sort: LIST_SORTS.find((s) => s === sort) ?? 'updated',
    q: query.get('q') ?? '',
  };
}

/** The first `n` open items, in order: what a list's card shows. */
export function previewItems(list: Pick<List, 'items'>, n = 3): ListItem[] {
  return list.items.filter((i) => !i.done).slice(0, n);
}

/**
 * Every item id of `list` in the order after moving the open item `id`
 * to place `to` among the open ones (0 is the top). The done items keep
 * their places, so ticking one off again puts it back where it was. Null
 * when nothing would move. `reorderListItems` takes the result.
 */
export function moveOpenItem(
  list: Pick<List, 'items'>,
  id: string,
  to: number,
): string[] | null {
  const open = list.items.filter((i) => !i.done).map((i) => i.id);
  const from = open.indexOf(id);
  const at = Math.max(0, Math.min(to, open.length - 1));
  if (from < 0 || from === at) return null;
  open.splice(from, 1);
  open.splice(at, 0, id);
  let next = 0;
  return list.items.map((i) => (i.done ? i.id : (open[next++] ?? i.id)));
}

/**
 * A project's lists as its page shows them (#301): the ones in progress
 * (empty ones included) most recently updated first, then the done ones
 * the same way.
 */
export function projectLists(
  lists: Record<string, List>,
  projectId: string,
): List[] {
  const all = selectLists(lists, { projectId });
  return [
    ...all.filter((l) => !isListDone(l)),
    ...all.filter((l) => isListDone(l)),
  ];
}
