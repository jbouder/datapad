import { describe, expect, it } from 'vitest';
import { ExportSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import { search, searchIndex } from '#shared/search';
import { emptySnapshot, type Snapshot } from '#shared/types';
import fixture from './fixtures/export.json';

function seeded(): Snapshot {
  const { exportedAt: _, ...state } = ExportSchema.parse(fixture);
  return state;
}

const indexOf = (s: Snapshot) =>
  searchIndex(s.projects, s.tasks, s.notes, s.events, s.people);

const ids = (hits: { entry: { id: string } }[]) => hits.map((h) => h.entry.id);

describe('search', () => {
  it('with no query, lists projects, most recent first, archived last', () => {
    const s = seeded();
    const r = search(indexOf(s), '  ');
    const active = Object.values(s.projects)
      .filter((p) => !p.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => p.id);
    expect(ids(r.project)).toEqual([...active, 'p-yavin']);
    expect(r.task).toEqual([]);
  });

  it('finds a task by title and every word must match, any case', () => {
    const r = search(indexOf(seeded()), 'SHIELD delivery');
    expect(ids(r.task)).toEqual(['t-1']);
    expect(search(indexOf(seeded()), 'shield banana').task).toEqual([]);
  });

  it('reads mentions as names and gives a snippet around the match', () => {
    let s = seeded();
    s = reduce(
      s,
      {
        type: 'addNote',
        id: 'n-x',
        projectId: 'p-echo',
        body: 'Standup\nAsk @{u-han} about the **thermal** couplings today',
      },
      '2026-10-24T09:00:00.000Z',
    ).state;
    const r = search(indexOf(s), 'han thermal');
    expect(ids(r.note)).toEqual(['n-x']);
    expect(r.note[0]?.entry.title).toBe('Standup');
    expect(r.note[0]?.snippet).toContain('Ask @Han Solo about the thermal');
    expect(ids(r.person)).toEqual([]);
    // A name match ranks above a role match (Mon is the Chancellor).
    expect(ids(search(indexOf(s), 'han').person)).toEqual(['u-han', 'u-mon']);
  });

  it('marks and ranks archived items after the rest', () => {
    const r = search(indexOf(seeded()), 'yavin');
    expect(r.project[0]).toMatchObject({
      entry: { id: 'p-yavin', archived: true },
    });
    expect(r.task.every((h) => h.entry.archived)).toBe(true);
  });

  it('ranks titles that start with the word first', () => {
    let s = emptySnapshot();
    for (const [id, title] of [
      ['a', 'Order the heaters'],
      ['b', 'Heaters for the hangar'],
    ] as const) {
      s = reduce(
        s,
        { type: 'addTask', id, projectId: null, title },
        '2026-10-24T09:00:00.000Z',
      ).state;
    }
    expect(ids(search(indexOf(s), 'heat').task)).toEqual(['b', 'a']);
  });

  it('answers within a frame for 5 000 documents, index rebuilt once', () => {
    const s = emptySnapshot();
    for (let i = 0; i < 5000; i++) {
      const id = `t${i}`;
      s.tasks[id] = {
        id,
        title: `Task number ${i} about subsystem ${i % 97}`,
        projectId: null,
        status: 'open',
        priority: 'none',
        due: '',
        desc: `Details for ${i}: check the coolant loop and the relay ${i % 13}`,
        tags: ['ops'],
        assignee: '',
        links: [],
        order: i,
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T09:00:00.000Z',
        completedAt: null,
      };
    }
    const index = indexOf(s);
    expect(indexOf(s)).toBe(index);
    const start = performance.now();
    for (const q of ['r', 're', 'rel', 'rela', 'relay 7']) search(index, q);
    expect((performance.now() - start) / 5).toBeLessThan(16);
  });
});
