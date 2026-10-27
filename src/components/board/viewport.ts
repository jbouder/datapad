import type { Box } from '#shared/board';
import { LIMITS } from '#shared/limits';

/**
 * The whiteboard's viewport, as pure math (no DOM), so the tests can pin
 * it down. `x, y` is the board point at the screen's top-left corner and
 * `zoom` how many screen pixels one board unit takes: a screen point
 * `(sx, sy)` (relative to the board's element) is the board point
 * `(x + sx / zoom, y + sy / zoom)`.
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** One press of + or −. */
export const ZOOM_STEP = 1.25;
/** Room around the items when fitting, in screen pixels. */
export const FIT_PADDING = 48;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** A screen point (relative to the board's element) on the board. */
export function toBoard(view: Viewport, screen: Point): Point {
  return { x: view.x + screen.x / view.zoom, y: view.y + screen.y / view.zoom };
}

/** A board point on the screen (relative to the board's element). */
export function toScreen(view: Viewport, board: Point): Point {
  return {
    x: (board.x - view.x) * view.zoom,
    y: (board.y - view.y) * view.zoom,
  };
}

/** Move the view by a drag of `(dx, dy)` screen pixels. */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom };
}

/**
 * Zoom to `zoom` (clamped) keeping the board point under the screen point
 * `at` where it is: the wheel, a pinch and the corner buttons all zoom
 * around something.
 */
export function zoomAt(view: Viewport, at: Point, zoom: number): Viewport {
  const next = clampZoom(zoom);
  const fixed = toBoard(view, at);
  return { x: fixed.x - at.x / next, y: fixed.y - at.y / next, zoom: next };
}

/**
 * Where a two-finger gesture leaves the view: it began over `startMid`
 * with the fingers `startDistance` apart in `start`, and they are now
 * over `mid`, `distance` apart. The board point first under the fingers
 * stays under them, so one gesture pans and pinches at once.
 */
export function pinch(
  start: Viewport,
  startMid: Point,
  startDistance: number,
  mid: Point,
  distance: number,
): Viewport {
  const zoom = clampZoom(
    startDistance > 0 ? start.zoom * (distance / startDistance) : start.zoom,
  );
  const fixed = toBoard(start, startMid);
  return { x: fixed.x - mid.x / zoom, y: fixed.y - mid.y / zoom, zoom };
}

/**
 * The ctrl/cmd-wheel's (and a trackpad pinch's) zoom factor for a wheel
 * delta: smooth for a trackpad's small steps, one notch ≈ 10% for a mouse.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-50, Math.min(50, deltaY)) / 500);
}

/** The board box the screen shows, for an element `width × height`. */
export function visibleBox(view: Viewport, width: number, height: number): Box {
  return { x: view.x, y: view.y, w: width / view.zoom, h: height / view.zoom };
}

/** The SVG `viewBox` for the view on an element `width × height`. */
export function viewBoxOf(view: Viewport, width: number, height: number) {
  const box = visibleBox(view, width, height);
  return `${box.x} ${box.y} ${Math.max(box.w, 1)} ${Math.max(box.h, 1)}`;
}

/**
 * The view that shows `box` whole and centred on an element
 * `width × height`, never closer than 100% (a lone sticky is not blown
 * up) nor past the zoom limits.
 */
export function fitTo(
  box: Box,
  width: number,
  height: number,
  padding = FIT_PADDING,
): Viewport {
  const roomW = Math.max(1, width - 2 * padding);
  const roomH = Math.max(1, height - 2 * padding);
  const zoom = clampZoom(
    Math.min(1, roomW / Math.max(box.w, 1), roomH / Math.max(box.h, 1)),
  );
  return {
    x: box.x + box.w / 2 - width / (2 * zoom),
    y: box.y + box.h / 2 - height / (2 * zoom),
    zoom,
  };
}

/**
 * The view centred on `box`: at the current zoom, but at least 100% so
 * its words can be read, and never so close that it is cut off (a search
 * result opening the board on one item).
 */
export function centreOn(
  view: Viewport,
  box: Box,
  width: number,
  height: number,
  padding = FIT_PADDING,
): Viewport {
  const roomW = Math.max(1, width - 2 * padding);
  const roomH = Math.max(1, height - 2 * padding);
  const zoom = clampZoom(
    Math.min(
      Math.max(view.zoom, 1),
      roomW / Math.max(box.w, 1),
      roomH / Math.max(box.h, 1),
    ),
  );
  return {
    x: box.x + box.w / 2 - width / (2 * zoom),
    y: box.y + box.h / 2 - height / (2 * zoom),
    zoom,
  };
}

/** The view a new board opens on: the origin in the middle, at 100%. */
export function centred(width: number, height: number): Viewport {
  return { x: -width / 2, y: -height / 2, zoom: 1 };
}

/** The box around every box given; null for none. */
export function union(boxes: Iterable<Box>): Box | null {
  let out: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const b of boxes) {
    if (!out) {
      out = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
      continue;
    }
    out.x0 = Math.min(out.x0, b.x);
    out.y0 = Math.min(out.y0, b.y);
    out.x1 = Math.max(out.x1, b.x + b.w);
    out.y1 = Math.max(out.y1, b.y + b.h);
  }
  return out
    ? { x: out.x0, y: out.y0, w: out.x1 - out.x0, h: out.y1 - out.y0 }
    : null;
}

/** Whether two boxes overlap (touching counts). */
export function intersects(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

/** The box between two corners, either way round. */
export function boxBetween(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/**
 * The grid's spacing in board units at `zoom`: 20 units, doubled until
 * the dots are at least 12px apart on screen, so there is a grid at every
 * zoom without a haze of dots when zoomed out.
 */
export function gridStep(zoom: number): number {
  let step = 20;
  while (step * zoom < 12) step *= 2;
  return step;
}

/** A board coordinate, whole and inside the model's bounds. */
export function clampCoord(n: number): number {
  const max = LIMITS.boardCoordMax;
  return Math.round(Math.min(max, Math.max(-max, n)));
}

/** A remembered viewport from storage, or null if it is not one. */
export function parseViewport(raw: unknown): Viewport | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof zoom !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }
  return { x, y, zoom: clampZoom(zoom) };
}

/** Which corner of a box a resize handle holds. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * The box a corner handle leaves when dragged by `(dx, dy)` board units:
 * the opposite corner stays put, and neither side goes under `min`.
 */
export function resizeBox(
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
  min: number,
): Box {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const w = Math.max(min, west ? box.w - dx : box.w + dx);
  const h = Math.max(min, north ? box.h - dy : box.h + dy);
  return {
    x: west ? box.x + box.w - w : box.x,
    y: north ? box.y + box.h - h : box.y,
    w,
    h,
  };
}
