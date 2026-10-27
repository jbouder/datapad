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

/* ---------- drawing: ink, rects, arrows and what arrows attach to ---------- */

export interface Point {
  x: number;
  y: number;
}

const tenth = (n: number) => Math.round(n * 10) / 10;
const hundredth = (n: number) => Math.round(n * 100) / 100;

/**
 * An ink stroke from the board points it was drawn through: simplified
 * with `simplify()` (at `tolerance`, doubled until it fits in `max`
 * coordinates) and made relative to its top-left, which becomes the
 * item's `x, y`. Coordinates are rounded to a tenth of a unit.
 */
export function strokeOf(
  points: number[],
  tolerance: number,
  max: number,
): Box & { points: number[] } {
  let tol = Math.max(tolerance, 0.01);
  let kept = simplify(points, tol);
  while (kept.length > max) {
    tol *= 2;
    kept = simplify(points, tol);
  }
  const box = bounds({ kind: 'ink', x: 0, y: 0, w: 0, h: 0, points: kept });
  const x = tenth(box.x);
  const y = tenth(box.y);
  return {
    x,
    y,
    w: tenth(box.w),
    h: tenth(box.h),
    points: kept.map((n, i) => tenth(n - (i % 2 === 0 ? x : y))),
  };
}

/** The box from `a` to `b`; with `square`, its shorter side grown to match. */
export function dragBox(a: Point, b: Point, square = false): Box {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return {
    x: Math.min(a.x, a.x + dx),
    y: Math.min(a.y, a.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

/** `to`, turned about `from` to the nearest multiple of 45°. */
export function constrainAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...to };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Exact on the axes, not 1e-14 off them.
  const clean = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);
  return {
    x: from.x + clean(length * Math.cos(angle)),
    y: from.y + clean(length * Math.sin(angle)),
  };
}

/** Kinds an arrow's end attaches to. */
export function attachable(item: Pick<BoardItem, 'kind'>): boolean {
  return item.kind === 'sticky' || item.kind === 'rect';
}

/** How near a box's border a point must be to count as on it. */
export const EDGE_TOLERANCE = 0.5;

/** The point on a box's border nearest to `p` (inside it or out). */
export function nearestEdge(box: Box, p: Point): Point {
  const x = Math.min(box.x + box.w, Math.max(box.x, p.x));
  const y = Math.min(box.y + box.h, Math.max(box.y, p.y));
  if (x !== p.x || y !== p.y) return { x, y };
  // Inside: out to whichever side is closest.
  const left = p.x - box.x;
  const right = box.x + box.w - p.x;
  const top = p.y - box.y;
  const bottom = box.y + box.h - p.y;
  const least = Math.min(left, right, top, bottom);
  if (least === left) return { x: box.x, y: p.y };
  if (least === right) return { x: box.x + box.w, y: p.y };
  if (least === top) return { x: p.x, y: box.y };
  return { x: p.x, y: box.y + box.h };
}

/** Whether `p` lies on a box's border. */
export function onEdge(
  box: Box,
  p: Point,
  tolerance = EDGE_TOLERANCE,
): boolean {
  const near = nearestEdge(box, p);
  return Math.hypot(near.x - p.x, near.y - p.y) <= tolerance;
}

/** An arrow's two ends, on the board. */
export function arrowEnds(
  arrow: Pick<BoardItem, 'x' | 'y' | 'points'>,
): [Point, Point] {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = arrow.points;
  return [
    { x: arrow.x + x0, y: arrow.y + y0 },
    { x: arrow.x + x1, y: arrow.y + y1 },
  ];
}

/** An arrow's `points` for two board points, relative to its `x, y`. */
export function arrowPoints(
  arrow: Pick<BoardItem, 'x' | 'y'>,
  a: Point,
  b: Point,
): number[] {
  return [
    hundredth(a.x - arrow.x),
    hundredth(a.y - arrow.y),
    hundredth(b.x - arrow.x),
    hundredth(b.y - arrow.y),
  ];
}

/**
 * What a released arrow end lands on: the topmost sticky or rect under
 * `p` (other than `except`), or undefined. `items` is in drawing order.
 */
export function dropTarget(
  items: readonly BoardItem[],
  p: Point,
  except?: string,
): BoardItem | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const b = items[i];
    if (b && b.id !== except && attachable(b) && hitTest(b, p.x, p.y, 0)) {
      return b;
    }
  }
  return undefined;
}

/**
 * Where a released arrow end goes: onto the nearest edge of the sticky or
 * rect it was dropped on, where it stays attached; anywhere else, where
 * it was let go.
 */
export function snapEnd(
  items: readonly BoardItem[],
  p: Point,
  except?: string,
): Point {
  const target = dropTarget(items, p, except);
  return target ? nearestEdge(target, p) : p;
}

/**
 * The sticky or rect an arrow end is attached to: the topmost one whose
 * border it lies on. An attachment is nothing more than that, an end on
 * an edge (where `snapEnd()` puts it), so the model needs nothing new.
 */
export function attachedTo(
  items: readonly BoardItem[],
  p: Point,
): BoardItem | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const b = items[i];
    if (b && attachable(b) && onEdge(b, p)) return b;
  }
  return undefined;
}

/** `p` on the border of `from`, at the same place on the border of `to`. */
export function followBox(p: Point, from: Box, to: Box): Point {
  const fx = from.w === 0 ? 0 : (p.x - from.x) / from.w;
  const fy = from.h === 0 ? 0 : (p.y - from.y) / from.h;
  return { x: to.x + fx * to.w, y: to.y + fy * to.h };
}

export interface BoardMove {
  id: string;
  x: number;
  y: number;
  points?: number[];
}

/**
 * The arrows that follow when stickies or rects move or resize: every
 * arrow with an end attached to one of `changed` (its new box, by id) is
 * re-aimed so that end keeps its place on the item's border. An arrow in
 * `skip` (it is moving itself) is left alone. Each is a `moveBoardItems`
 * move: the arrow keeps its `x, y` and its `points` change.
 */
export function reaim(
  items: readonly BoardItem[],
  changed: ReadonlyMap<string, Box>,
  skip: ReadonlySet<string> = new Set(),
): Required<BoardMove>[] {
  if (changed.size === 0) return [];
  const out: Required<BoardMove>[] = [];
  for (const arrow of items) {
    if (arrow.kind !== 'arrow' || skip.has(arrow.id)) continue;
    let touched = false;
    const [a, b] = arrowEnds(arrow).map((end) => {
      const host = attachedTo(items, end);
      const to = host ? changed.get(host.id) : undefined;
      if (!host || !to) return end;
      touched = true;
      return followBox(end, host, to);
    }) as [Point, Point];
    if (!touched) continue;
    out.push({
      id: arrow.id,
      x: arrow.x,
      y: arrow.y,
      points: arrowPoints(arrow, a, b),
    });
  }
  return out;
}
