import { byZ } from '#shared/board';
import type { BaseOp } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import type { BoardItem, Snapshot } from '#shared/types';

/**
 * Undo and redo on a whiteboard, as pure functions: what puts a board
 * back after some ops. An add's inverse deletes it; a delete's adds the
 * whole items back; an edit's edits the fields it changed back; a move's
 * moves back (points too, when it re-aimed an arrow); raising or lowering
 * puts the old drawing order back with raises or lowers. The board keeps
 * two stacks of these and sends them through the normal actions.
 */

/** How many steps a board remembers. */
export const HISTORY_MAX = 100;

/**
 * The ops that put back the drawing order `before` (one board, by `z`)
 * after `ids` went to the top (`raise`) or the bottom. Runs of items are
 * raised in their old order from the first one moved (or lowered in
 * reverse, down to the last one moved), which rebuilds the order exactly.
 */
export function restoreOrder(
  before: readonly BoardItem[],
  ids: readonly string[],
  to: 'top' | 'bottom',
): BaseOp[] {
  const moved = new Set(ids);
  const flags = before.map((b) => moved.has(b.id));
  const runs: string[][] = [];
  const push = (from: number, until: number) => {
    let run: string[] = [];
    let kind: boolean | null = null;
    for (let i = from; i < until; i += 1) {
      const b = before[i];
      if (!b) continue;
      if (kind !== null && flags[i] !== kind) {
        runs.push(run);
        run = [];
      }
      kind = flags[i] ?? false;
      run.push(b.id);
    }
    if (run.length > 0) runs.push(run);
  };
  if (to === 'top') {
    const first = flags.indexOf(true);
    if (first === -1) return [];
    push(first, before.length);
    // All of them, already on top in that order: raising changed nothing.
    if (runs.length === 1) return [];
    return runs.map((run) => ({ type: 'raiseBoardItems', ids: run }));
  }
  const last = flags.lastIndexOf(true);
  if (last === -1) return [];
  push(0, last + 1);
  if (runs.length === 1) return [];
  return runs.reverse().map((run) => ({ type: 'lowerBoardItems', ids: run }));
}

/** One board's items in drawing order. */
function boardOf(state: Snapshot, boardId: string): BoardItem[] {
  return Object.values(state.boardItems)
    .filter((b) => b.boardId === boardId)
    .sort(byZ);
}

/** The ops that undo one op, read against the state just before it. */
export function inverseOf(state: Snapshot, op: BaseOp): BaseOp[] {
  const items = state.boardItems;
  switch (op.type) {
    case 'addBoardItem':
      return [{ type: 'deleteBoardItems', ids: [op.item.id] }];
    case 'deleteBoardItems':
      return op.ids
        .flatMap((id) => items[id] ?? [])
        .sort(byZ)
        .map((item) => ({ type: 'addBoardItem', item: structuredClone(item) }));
    case 'editBoardItem': {
      const old = items[op.id];
      if (!old) return [];
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch) as (keyof typeof op.patch)[]) {
        const value = old[key];
        patch[key] = Array.isArray(value) ? [...value] : value;
      }
      return [
        {
          type: 'editBoardItem',
          id: op.id,
          patch: patch as typeof op.patch,
        },
      ];
    }
    case 'moveBoardItems': {
      const moves = op.moves.flatMap((m) => {
        const old = items[m.id];
        if (!old) return [];
        return [
          {
            id: old.id,
            x: old.x,
            y: old.y,
            ...(m.points ? { points: [...old.points] } : {}),
          },
        ];
      });
      return moves.length > 0 ? [{ type: 'moveBoardItems', moves }] : [];
    }
    case 'raiseBoardItems':
    case 'lowerBoardItems': {
      const boards = new Set(op.ids.flatMap((id) => items[id]?.boardId ?? []));
      return [...boards].flatMap((boardId) =>
        restoreOrder(
          boardOf(state, boardId),
          op.ids,
          op.type === 'raiseBoardItems' ? 'top' : 'bottom',
        ),
      );
    }
    default:
      return [];
  }
}

/**
 * The ops that undo `ops` sent in that order: each one's inverse, read
 * against the state the ones before it left, last first. Null when the
 * ops would not apply (nothing is sent then either).
 */
export function inverse(
  state: Snapshot,
  ops: readonly BaseOp[],
  now: string,
): BaseOp[] | null {
  const parts: BaseOp[][] = [];
  let current = state;
  try {
    for (const op of ops) {
      parts.push(inverseOf(current, op));
      current = reduce(current, op, now).state;
    }
  } catch {
    return null;
  }
  return parts.reverse().flat();
}

export interface History {
  /** What undoes each step, the latest last. */
  undo: BaseOp[][];
  /** What redoes each undone step, the latest last. */
  redo: BaseOp[][];
}

export const emptyHistory = (): History => ({ undo: [], redo: [] });

/** A step done: its undo on the stack (capped), and the redo stack cleared. */
export function recordStep(history: History, undo: BaseOp[]): History {
  if (undo.length === 0) return history;
  return { undo: [...history.undo, undo].slice(-HISTORY_MAX), redo: [] };
}
