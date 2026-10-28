import { arrowPoints, type BoardMove, type Box, reaim } from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import type { BoardColor, BoardItem } from '#shared/types';
import { clampCoord, type Point } from './viewport';

/**
 * The whiteboard's op builders, pure (no React, no DOM), shared by the
 * pointer gestures (`gesture.ts`), the keys (`useBoardKeys.ts`) and the
 * board. They only build ops; the board sends them through `useHistory`'s
 * `run`, so ⌘Z can take them back.
 */

/**
 * The moves for items going to new places, with the arrows attached to
 * them re-aimed, as `moveBoardItems` ops (up to `batchMax` moves each).
 * Arrows moving themselves keep their shape. `resized` holds the boxes of
 * items whose size changes too, so their arrows aim at the new edges.
 */
export function moveOps(
  items: readonly BoardItem[],
  moves: BoardMove[],
  resized: ReadonlyMap<string, Box> = new Map(),
): BaseOp[] {
  const byId = new Map(items.map((b) => [b.id, b]));
  const boxes = new Map(resized);
  for (const m of moves) {
    const item = byId.get(m.id);
    if (item && !boxes.has(m.id)) {
      boxes.set(m.id, { x: m.x, y: m.y, w: item.w, h: item.h });
    }
  }
  const moving = new Set(moves.map((m) => m.id));
  const changed = [...moves, ...reaim(items, boxes, moving)].filter((m) => {
    const item = byId.get(m.id);
    return (
      item &&
      (item.x !== m.x ||
        item.y !== m.y ||
        (m.points !== undefined && m.points.join() !== item.points.join()))
    );
  });
  const ops: BaseOp[] = [];
  for (let i = 0; i < changed.length; i += LIMITS.batchMax) {
    ops.push({
      type: 'moveBoardItems',
      moves: changed.slice(i, i + LIMITS.batchMax),
    });
  }
  return ops;
}

/** The selected items `dx`, `dy` along (the arrow keys). */
export function nudgeMoves(
  byId: ReadonlyMap<string, BoardItem>,
  ids: readonly string[],
  dx: number,
  dy: number,
): BoardMove[] {
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item
      ? [{ id, x: clampCoord(item.x + dx), y: clampCoord(item.y + dy) }]
      : [];
  });
}

/** The selected items in `color`, leaving out those already in it. */
export function recolorOps(
  byId: ReadonlyMap<string, BoardItem>,
  ids: readonly string[],
  color: BoardColor,
): BaseOp[] {
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item && item.color !== color
      ? [{ type: 'editBoardItem' as const, id, patch: { color } }]
      : [];
  });
}

/**
 * An item resized to `box` (from a corner handle): its new size, then its
 * move and its arrows' re-aiming after the new size. Empty when nothing
 * changed.
 */
export function resizeOps(
  items: readonly BoardItem[],
  item: BoardItem,
  box: Box,
): BaseOp[] {
  const x = clampCoord(box.x);
  const y = clampCoord(box.y);
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  const ops: BaseOp[] = [];
  if (w !== item.w || h !== item.h) {
    ops.push({ type: 'editBoardItem', id: item.id, patch: { w, h } });
  }
  ops.push(
    ...moveOps(
      items,
      [{ id: item.id, x, y }],
      new Map([[item.id, { x, y, w, h }]]),
    ),
  );
  return ops;
}

/**
 * A new arrow from `from` to `to`: where it goes (its tail, clamped), its
 * box and its points, relative to that origin.
 */
export function arrowBetween(
  from: Point,
  to: Point,
): { at: Point; box: Box; points: number[] } {
  const at = { x: clampCoord(from.x), y: clampCoord(from.y) };
  return {
    at,
    box: { ...at, w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) },
    points: arrowPoints(at, from, to),
  };
}

/**
 * One end of an arrow moved to `at` (`which`: 0 the tail, 1 the head), as
 * an edit, or nothing when the arrow is where it was.
 */
export function endOps(
  arrow: BoardItem,
  ends: readonly [Point, Point],
  which: 0 | 1,
  at: Point,
): BaseOp[] {
  const [a, b] = ends;
  const points =
    which === 0 ? arrowPoints(arrow, at, b) : arrowPoints(arrow, a, at);
  return points.join() === arrow.points.join()
    ? []
    : [{ type: 'editBoardItem', id: arrow.id, patch: { points } }];
}
