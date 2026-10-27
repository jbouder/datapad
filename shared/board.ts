import { lastCall } from './select';
import type { BoardItem, Snapshot } from './types';

/**
 * Whiteboards (M12): the pure geometry the canvas shares with the reducer.
 * An item's `x, y, w, h` are board units; an ink stroke's or an arrow's
 * `points` are flat `[x0, y0, x1, y1, …]` pairs relative to `x, y`.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Shape = Pick<BoardItem, 'kind' | 'x' | 'y' | 'w' | 'h' | 'points'>;

/** How near a pointer must be to a line to hit it, in board units. */
export const HIT_TOLERANCE = 6;

/** Why an item's points do not fit its kind, or null when they do. */
export function checkShape(
  item: Pick<BoardItem, 'kind' | 'points'>,
): string | null {
  const n = item.points.length;
  switch (item.kind) {
    case 'arrow':
      return n === 4 ? null : 'An arrow has two ends';
    case 'ink':
      return n >= 2 ? null : 'An ink stroke needs a point';
    default:
      return n === 0 ? null : 'Only arrows and ink have points';
  }
}

/** The distance from `(px, py)` to the segment `(ax, ay)`–`(bx, by)`. */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker over flat pairs: drops points that lie within
 * `tolerance` of the line between the points kept around them. Keeps the
 * first and last point, and never returns more than it was given (a
 * trailing odd coordinate is dropped).
 */
export function simplify(points: number[], tolerance: number): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= 2) return points.slice(0, n * 2);
  const at = (i: number, k: 0 | 1) => points[i * 2 + k] ?? 0;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // A stack, not recursion: a long stroke would go deep.
  const stack: Array<[number, number]> = [[0, n - 1]];
  for (let span = stack.pop(); span; span = stack.pop()) {
    const [first, last] = span;
    let worst = -1;
    let far = 0;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistance(
        at(i, 0),
        at(i, 1),
        at(first, 0),
        at(first, 1),
        at(last, 0),
        at(last, 1),
      );
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst !== -1 && far > tolerance) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push(at(i, 0), at(i, 1));
  }
  return out;
}

function isLine(item: Pick<BoardItem, 'kind'>): boolean {
  return item.kind === 'arrow' || item.kind === 'ink';
}

/**
 * Where an item sits on the board: its box, or for an arrow or an ink
 * stroke the box around its points.
 */
export function bounds(item: Shape): Box {
  if (!isLine(item)) return { x: item.x, y: item.y, w: item.w, h: item.h };
  const { points } = item;
  if (points.length < 2) return { x: item.x, y: item.y, w: 0, h: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i] ?? 0;
    const py = points[i + 1] ?? 0;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return {
    x: item.x + minX,
    y: item.y + minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * Whether the board point `(x, y)` hits an item: inside a sticky's, a
 * text's or a rect's box (items never rotate), or within `tolerance` of
 * an arrow's line or any segment of an ink stroke.
 */
export function hitTest(
  item: Shape,
  x: number,
  y: number,
  tolerance = HIT_TOLERANCE,
): boolean {
  if (!isLine(item)) {
    return (
      x >= item.x - tolerance &&
      x <= item.x + item.w + tolerance &&
      y >= item.y - tolerance &&
      y <= item.y + item.h + tolerance
    );
  }
  const { points } = item;
  const px = x - item.x;
  const py = y - item.y;
  if (points.length === 2) {
    // A dot: one point.
    return (
      Math.hypot(px - (points[0] ?? 0), py - (points[1] ?? 0)) <= tolerance
    );
  }
  for (let i = 0; i + 3 < points.length; i += 2) {
    const d = segmentDistance(
      px,
      py,
      points[i] ?? 0,
      points[i + 1] ?? 0,
      points[i + 2] ?? 0,
      points[i + 3] ?? 0,
    );
    if (d <= tolerance) return true;
  }
  return false;
}

/** The `z` that draws on top of every item given (0 on an empty board). */
export function nextZ(items: Iterable<Pick<BoardItem, 'z'>>): number {
  let max: number | null = null;
  for (const b of items) if (max === null || b.z > max) max = b.z;
  return max === null ? 0 : max + 1;
}

/** Drawing order: by `z`, then id, so ties draw the same everywhere. */
export function byZ(a: BoardItem, b: BoardItem): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const NONE: readonly BoardItem[] = Object.freeze([]);

/** Every board's items in drawing order, by board id. */
const byBoard = lastCall(
  (boardItems: Snapshot['boardItems']): Map<string, BoardItem[]> => {
    const out = new Map<string, BoardItem[]>();
    for (const b of Object.values(boardItems)) {
      const list = out.get(b.boardId);
      if (list) list.push(b);
      else out.set(b.boardId, [b]);
    }
    for (const list of out.values()) list.sort(byZ);
    return out;
  },
);

/**
 * One board's items in drawing order (lowest `z` first). The same array
 * until `boardItems` changes, whichever board is asked for.
 */
export function itemsOf(
  boardItems: Snapshot['boardItems'],
  boardId: string,
): readonly BoardItem[] {
  return byBoard(boardItems).get(boardId) ?? NONE;
}
