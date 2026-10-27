import { describe, expect, it } from 'vitest';
import { ExportSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import { search, searchIndex } from '#shared/search';
import {
  type BoardItem,
  type BoardKind,
  emptySnapshot,
  GENERAL_BOARD,
  type Snapshot,
} from '#shared/types';
import fixture from './fixtures/export.json';

function seeded(): Snapshot {
  const { exportedAt: _, ...state } = ExportSchema.parse(fixture);
  return state;
}

const indexOf = (s: Snapshot) =>
  searchIndex(
    s.projects,
    s.tasks,
    s.notes,
    s.meetings,
    s.people,
    s.orgs,
    s.boardItems,
  );

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

  it('finds a meeting by its topics, and not the topic on its own', () => {
    let s = seeded();
    s = reduce(
      s,
      {
        type: 'addTopic',
        meetingId: 'e-1',
        id: 'tp-1',
        title: 'Mynock nests',
      },
      '2026-10-24T09:00:00.000Z',
    ).state;
    const r = search(indexOf(s), 'mynock');
    expect(ids(r.meeting)).toEqual(['e-1']);
    expect(Object.values(r).flat()).toHaveLength(1);
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

  it('finds a task’s note as a note, in the task’s project', () => {
    const s = reduce(
      seeded(),
      {
        type: 'addNote',
        id: 'n-t',
        projectId: null,
        body: 'Pinged legal, waiting on the redline',
        taskId: 't-1',
      },
      '2026-10-24T09:00:00.000Z',
    ).state;
    const r = search(indexOf(s), 'redline');
    expect(ids(r.note)).toEqual(['n-t']);
    expect(r.note[0]?.entry.projectId).toBe(s.tasks['t-1']?.projectId);
    expect(r.task).toEqual([]);
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

  it('finds the words on whiteboards: stickies, text and rect labels', () => {
    const s = seeded();
    const projectId = Object.keys(s.projects)[0] ?? '';
    const person = Object.values(s.people)[0];
    const item = (
      id: string,
      kind: BoardKind,
      boardId: string,
      text: string,
    ): BoardItem => ({
      id,
      boardId,
      kind,
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      z: 0,
      color: 'warn',
      text,
      points: kind === 'arrow' ? [0, 0, 10, 10] : [],
    });
    s.boardItems = {
      w1: item(
        'w1',
        'sticky',
        projectId,
        'Shield generator\nCheck the coolant',
      ),
      w2: item('w2', 'text', GENERAL_BOARD, 'Quarterly shield themes'),
      w3: item('w3', 'rect', projectId, 'Shield bay'),
      w4: item('w4', 'arrow', projectId, ''),
      w5: item('w5', 'sticky', projectId, '   '),
      w6: item('w6', 'rect', projectId, `Ask @{${person?.id}}`),
    };
    const index = indexOf(s);
    // Arrows, ink and empty items are not entries.
    expect(index.whiteboard.map((e) => e.id).sort()).toEqual([
      'w1',
      'w2',
      'w3',
      'w6',
    ]);
    const first = index.whiteboard.find((e) => e.id === 'w1');
    expect(first).toMatchObject({
      kind: 'whiteboard',
      title: 'Shield generator',
      body: 'Shield generator Check the coolant',
      projectId,
    });
    // The space's board has no project.
    expect(index.whiteboard.find((e) => e.id === 'w2')?.projectId).toBeNull();
    // Mentions read as names.
    expect(index.whiteboard.find((e) => e.id === 'w6')?.title).toBe(
      `Ask @${person?.name}`,
    );

    const r = search(index, 'shield');
    expect(ids(r.whiteboard)).toEqual(['w3', 'w1', 'w2']);
    // A match past the first line shows as a snippet.
    const coolant = search(index, 'coolant').whiteboard;
    expect(ids(coolant)).toEqual(['w1']);
    expect(coolant[0]?.snippet).toContain('Check the coolant');
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
