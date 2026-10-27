import { describe, expect, it } from 'vitest';
import { itemsOf } from '#shared/board';
import type { BaseOp, Op } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import { type BoardItem, emptySnapshot, type Snapshot } from '#shared/types';
import {
  HISTORY_MAX,
  inverse,
  inverseOf,
  recordStep,
  restoreOrder,
} from '../src/lib/board-history';

const T1 = '2026-10-23T10:00:00.000Z';

function item(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    boardId: 'p1',
    kind: 'sticky',
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    z: 0,
    color: 'warn',
    text: '',
    points: [],
    ...overrides,
  };
}

function run(state: Snapshot, ...ops: (Op | BaseOp)[]): Snapshot {
  return ops.reduce((s, op) => reduce(s, op as Op, T1).state, state);
}

/** A board: a, b, c, d, e in that order, plus an arrow. */
function board(): Snapshot {
  return run(
    emptySnapshot(),
    { type: 'createProject', id: 'p1', name: 'Echo Base' },
    ...['a', 'b', 'c', 'd', 'e'].map(
      (id, z): Op => ({
        type: 'addBoardItem',
        item: item(id, { x: z * 10, z, text: id.toUpperCase() }),
      }),
    ),
    {
      type: 'addBoardItem',
      item: item('arrow', {
        kind: 'arrow',
        z: 5,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        points: [0, 0, 100, 0],
      }),
    },
  );
}

const order = (state: Snapshot) =>
  itemsOf(state.boardItems, 'p1').map((b) => b.id);

/** The board's items, without the activity the adds logged. */
const items = (state: Snapshot) => state.boardItems;

/** Sends `ops`, then their inverse: the board must be as it was. */
function roundTrip(state: Snapshot, ops: BaseOp[]) {
  const undo = inverse(state, ops, T1);
  expect(undo).not.toBeNull();
  const done = run(state, ...ops);
  const undone = run(done, ...(undo ?? []));
  return { done, undone, undo: undo ?? [] };
}

describe('undo: each op’s inverse', () => {
  it('an add is undone by a delete, and a delete by adding the whole item back', () => {
    const state = board();
    const added = item('f', { z: 6, text: 'New' });
    expect(inverseOf(state, { type: 'addBoardItem', item: added })).toEqual([
      { type: 'deleteBoardItems', ids: ['f'] },
    ]);
    const { undone, undo } = roundTrip(state, [
      { type: 'deleteBoardItems', ids: ['d', 'b'] },
    ]);
    // In drawing order, each the whole item.
    expect(undo).toEqual([
      { type: 'addBoardItem', item: state.boardItems.b },
      { type: 'addBoardItem', item: state.boardItems.d },
    ]);
    expect(items(undone)).toEqual(items(state));
  });

  it('an edit is undone by editing back only the fields it changed', () => {
    const state = board();
    const op: BaseOp = {
      type: 'editBoardItem',
      id: 'c',
      patch: { text: 'Shields', color: 'ok' },
    };
    expect(inverseOf(state, op)).toEqual([
      {
        type: 'editBoardItem',
        id: 'c',
        patch: { text: 'C', color: 'warn' },
      },
    ]);
    expect(items(roundTrip(state, [op]).undone)).toEqual(items(state));
    // An arrow's ends.
    const ends: BaseOp = {
      type: 'editBoardItem',
      id: 'arrow',
      patch: { points: [0, 0, 40, 40] },
    };
    expect(items(roundTrip(state, [ends]).undone)).toEqual(items(state));
  });

  it('a move is undone by moving back, re-aimed points too', () => {
    const state = board();
    const op: BaseOp = {
      type: 'moveBoardItems',
      moves: [
        { id: 'a', x: 500, y: 500 },
        { id: 'arrow', x: 0, y: 0, points: [0, 0, 500, 500] },
      ],
    };
    expect(inverseOf(state, op)).toEqual([
      {
        type: 'moveBoardItems',
        moves: [
          { id: 'a', x: 0, y: 0 },
          { id: 'arrow', x: 0, y: 0, points: [0, 0, 100, 0] },
        ],
      },
    ]);
    expect(items(roundTrip(state, [op]).undone)).toEqual(items(state));
  });

  it('items deleted meanwhile have nothing to undo', () => {
    const state = board();
    expect(
      inverseOf(state, {
        type: 'editBoardItem',
        id: 'gone',
        patch: { text: 'x' },
      }),
    ).toEqual([]);
    expect(
      inverseOf(state, {
        type: 'moveBoardItems',
        moves: [{ id: 'gone', x: 1, y: 1 }],
      }),
    ).toEqual([]);
  });
});

describe('undo: drawing order', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'arrow'];

  it('restoreOrder raises the runs from the first item moved', () => {
    const before = ids.map((id, z) => item(id, { z }));
    expect(restoreOrder(before, ['b', 'd'], 'top')).toEqual([
      { type: 'raiseBoardItems', ids: ['b'] },
      { type: 'raiseBoardItems', ids: ['c'] },
      { type: 'raiseBoardItems', ids: ['d'] },
      { type: 'raiseBoardItems', ids: ['e', 'arrow'] },
    ]);
    expect(restoreOrder(before, ['b', 'd'], 'bottom')).toEqual([
      { type: 'lowerBoardItems', ids: ['d'] },
      { type: 'lowerBoardItems', ids: ['c'] },
      { type: 'lowerBoardItems', ids: ['b'] },
      { type: 'lowerBoardItems', ids: ['a'] },
    ]);
    // Already on top (or at the bottom): nothing changed, nothing to undo.
    expect(restoreOrder(before, ['e', 'arrow'], 'top')).toEqual([]);
    expect(restoreOrder(before, ['a'], 'bottom')).toEqual([]);
  });

  for (const type of ['raiseBoardItems', 'lowerBoardItems'] as const) {
    for (const moved of [['b'], ['b', 'd'], ['a', 'e'], ['c', 'arrow'], ids]) {
      it(`${type} ${moved.join(', ')} is undone exactly`, () => {
        const state = board();
        const { done, undone } = roundTrip(state, [{ type, ids: moved }]);
        if (moved.length < ids.length) {
          expect(order(done)).not.toEqual(order(state));
        }
        expect(order(undone)).toEqual(order(state));
      });
    }
  }
});

describe('undo: steps of several ops', () => {
  it('inverts each against the state before it, last first', () => {
    const state = board();
    const ops: BaseOp[] = [
      { type: 'addBoardItem', item: item('f', { z: 6 }) },
      { type: 'editBoardItem', id: 'f', patch: { text: 'Then edited' } },
      { type: 'moveBoardItems', moves: [{ id: 'f', x: 40, y: 40 }] },
    ];
    const { undone, undo } = roundTrip(state, ops);
    expect(undo).toEqual([
      { type: 'moveBoardItems', moves: [{ id: 'f', x: 0, y: 0 }] },
      { type: 'editBoardItem', id: 'f', patch: { text: '' } },
      { type: 'deleteBoardItems', ids: ['f'] },
    ]);
    expect(items(undone)).toEqual(items(state));
  });

  it('undo then redo is the step again', () => {
    const state = board();
    const ops: BaseOp[] = [
      { type: 'editBoardItem', id: 'a', patch: { w: 300, h: 250 } },
      { type: 'moveBoardItems', moves: [{ id: 'a', x: -100, y: -50 }] },
    ];
    const { done, undone, undo } = roundTrip(state, ops);
    // Redo is worked out as the undo goes, from the state just before it.
    const redo = inverse(done, undo, T1) ?? [];
    expect(items(run(undone, ...redo))).toEqual(items(done));
  });

  it('is null when the ops would not apply', () => {
    expect(
      inverse(
        board(),
        [{ type: 'editBoardItem', id: 'gone', patch: { text: 'x' } }],
        T1,
      ),
    ).toBeNull();
  });

  it('recordStep caps the stack and clears redo; an empty step is no step', () => {
    let history = { undo: [] as BaseOp[][], redo: [[]] as BaseOp[][] };
    const step: BaseOp[] = [{ type: 'deleteBoardItems', ids: ['a'] }];
    expect(recordStep(history, [])).toBe(history);
    for (let i = 0; i < HISTORY_MAX + 5; i += 1) {
      history = recordStep(history, step);
    }
    expect(history.undo).toHaveLength(HISTORY_MAX);
    expect(history.redo).toEqual([]);
  });
});
