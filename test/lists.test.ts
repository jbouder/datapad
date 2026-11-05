import { describe, expect, it } from 'vitest';
import {
  isListDone,
  listCounts,
  listProgress,
  listProject,
  orderedItems,
  selectLists,
} from '#shared/lists';
import type { List, ListItem, Project } from '#shared/types';

const T = '2026-10-23T10:00:00.000Z';

const item = (id: string, text: string, done = false): ListItem => ({
  id,
  text,
  done,
  createdAt: T,
  doneAt: done ? T : null,
});

const list = (
  id: string,
  title: string,
  items: ListItem[],
  projectId: string | null = null,
  updatedAt = T,
): List => ({ id, projectId, title, items, createdAt: T, updatedAt });

describe('lists (#298)', () => {
  const offsite = list('l1', 'Offsite', [
    item('a', 'Venue', true),
    item('b', 'Agenda'),
    item('c', 'Dinner', true),
    item('d', 'Travel'),
  ]);

  it('counts progress as "done of total"', () => {
    expect(listCounts(offsite)).toEqual({ done: 2, total: 4 });
    expect(listProgress(offsite)).toBe('2 of 4');
    expect(listProgress(list('l2', 'Empty', []))).toBe('0 of 0');
  });

  it('is done when it has items and every one is checked', () => {
    expect(isListDone(offsite)).toBe(false);
    expect(isListDone(list('l2', 'Empty', []))).toBe(false);
    expect(isListDone(list('l3', 'All', [item('a', 'A', true)]))).toBe(true);
  });

  it('orders items as chosen, or open ones first', () => {
    expect(orderedItems(offsite).map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(orderedItems(offsite, 'open-first').map((i) => i.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('finds a list’s project, or null for General or one that is gone', () => {
    const p = { id: 'p1', name: 'Echo Base' } as Project;
    expect(listProject({ projectId: 'p1' }, { p1: p })).toBe(p);
    expect(listProject({ projectId: null }, { p1: p })).toBeNull();
    expect(listProject({ projectId: 'p9' }, { p1: p })).toBeNull();
  });

  it('selects by project, state and words, most recently updated first', () => {
    const lists = {
      l1: { ...offsite, projectId: 'p1', updatedAt: '2026-10-22T00:00:00Z' },
      l2: list('l2', 'Books', [], null, '2026-10-24T00:00:00Z'),
      l3: list('l3', 'Drills', [item('a', 'Run', true)], 'p1'),
    };
    const ids = (out: List[]) => out.map((l) => l.id);
    expect(ids(selectLists(lists))).toEqual(['l2', 'l3', 'l1']);
    expect(ids(selectLists(lists, { projectId: 'p1' }))).toEqual(['l3', 'l1']);
    expect(ids(selectLists(lists, { projectId: null }))).toEqual(['l2']);
    expect(ids(selectLists(lists, { state: 'in-progress' }))).toEqual([
      'l2',
      'l1',
    ]);
    expect(ids(selectLists(lists, { state: 'done' }))).toEqual(['l3']);
    expect(ids(selectLists(lists, { q: 'offsite DINNER' }))).toEqual(['l1']);
    expect(ids(selectLists(lists, { q: 'offsite books' }))).toEqual([]);
  });
});
