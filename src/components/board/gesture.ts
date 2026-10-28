import {
  arrowEnds,
  arrowPoints,
  type BoardMove,
  type Box,
  bounds,
  constrainAngle,
  dragBox,
  HIT_TOLERANCE,
  hitTest,
  snapEnd,
  strokeOf,
} from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import type { BoardItem, BoardKind } from '#shared/types';
import { MIN_SIZE } from './metrics';
import { arrowBetween, endOps, resizeOps } from './ops';
import { draws, type Tool } from './tools';
import {
  boxBetween,
  type Corner,
  clampCoord,
  intersects,
  type Point,
  panBy,
  pinch,
  resizeBox,
  toBoard,
  type Viewport,
} from './viewport';

/**
 * The whiteboard's pointer gestures as a pure state machine (no React, no
 * DOM), so the tests can pin it down. A press starts a `Gesture`, each
 * move steps it, and lifting the pointer ends it. Every step returns the
 * next gesture and the `Effect`s it asks for, in order, as plain data;
 * `useBoardGestures` reads the DOM into the inputs and carries the
 * effects out (state, focus, ops through `run`).
 */

/** How far a pointer moves before a press becomes a drag, in px. */
export const DRAG_SLOP = 4;
/** How long a finger rests on empty board before it draws a marquee. */
export const LONG_PRESS_MS = 450;
/** Two clicks or taps this close together are a double one. */
export const DOUBLE_TAP_MS = 350;
/** How near the eraser must pass to a stroke, in screen px. */
export const ERASER_REACH = 8;

export type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'pinch'; start: Viewport; mid: Point; distance: number }
  | { kind: 'place'; tool: 'sticky' | 'text'; start: Point }
  | {
      kind: 'draw';
      tool: 'rect' | 'arrow';
      /** Where it began, on screen and on the board. */
      screen: Point;
      start: Point;
      end: Point;
      shift: boolean;
    }
  | { kind: 'ink'; points: number[] }
  | { kind: 'erase'; last: Point; ids: ReadonlySet<string> }
  | { kind: 'end'; id: string; which: 0 | 1; at: Point; shift: boolean }
  /** A finger on empty board: a pan once it moves, a marquee if it rests. */
  | { kind: 'press'; start: Point }
  | {
      kind: 'move';
      start: Point;
      origins: ReadonlyMap<string, Point>;
      moved: boolean;
      dx: number;
      dy: number;
      item: string;
      /** The pressed item was already selected (a click may narrow to it). */
      wasSelected: boolean;
      shift: boolean;
    }
  | { kind: 'marquee'; start: Point; base: readonly string[] }
  | {
      kind: 'resize';
      id: string;
      corner: Corner;
      start: Point;
      origin: Box;
      box: Box;
    };

/** Items being dragged: where each began, and how far they have gone. */
export interface Drag {
  origins: ReadonlyMap<string, Point>;
  dx: number;
  dy: number;
}

/** What is being drawn, before it is an item. */
export type Draft =
  | { kind: 'rect'; box: Box }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'ink'; points: number[] };

/** The last tap on an item, to tell a double one. */
export interface Tap {
  id: string;
  at: number;
}

/**
 * What a step asks for, carried out in order. The first group is what is
 * shown while the pointer is down; the rest changes the board.
 */
export type Effect =
  | { type: 'cancel' }
  | { type: 'preventDefault' }
  | { type: 'focusSurface' }
  /** A press on an item: its focus must not reselect. */
  | { type: 'pressing' }
  /** The pressed item takes focus, so the keys go on from it. */
  | { type: 'focusPressed' }
  | { type: 'view'; view: Viewport }
  | { type: 'panning'; on: boolean }
  | { type: 'draft'; draft: Draft | null }
  | { type: 'erasing'; ids: ReadonlySet<string> }
  | { type: 'endEdit'; edit: { id: string; points: number[] } | null }
  | { type: 'drag'; drag: Drag | null }
  | { type: 'resize'; resize: { id: string; box: Box } | null }
  | { type: 'marquee'; box: Box | null }
  | { type: 'longPress'; start: boolean }
  | { type: 'select'; ids: string[] }
  /** Drop these from the selection. */
  | { type: 'deselect'; ids: ReadonlySet<string> }
  | { type: 'announce'; text: string }
  /** A sticky, a text or a rect placed with a click, centred on `at`. */
  | { type: 'create'; kind: 'sticky' | 'text' | 'rect'; at: Point }
  /**
   * An item added as drawn; `pick`: then back to Select, with it selected
   * and focused.
   */
  | {
      type: 'add';
      kind: BoardKind;
      box: Box;
      points?: number[];
      at?: Point;
      pick: boolean;
    }
  /** Items moved, with their arrows following. */
  | { type: 'moveTo'; moves: BoardMove[] }
  /** Ops as one step; `after`, only once they were taken. */
  | { type: 'run'; ops: BaseOp[]; after?: Effect[] }
  /** An item's editor opened. */
  | { type: 'edit'; id: string };

export interface Step {
  gesture: Gesture | null;
  effects: Effect[];
}

/** The board as a gesture sees it. */
export interface Scene {
  view: Viewport;
  items: readonly BoardItem[];
  byId: ReadonlyMap<string, BoardItem>;
  selected: string[];
}

/** What was under a press: an item, a corner handle or an arrow's end. */
export interface Target {
  /** The item pressed (`data-item-id`). */
  item?: string;
  /** A handle (`data-handle`): a corner, or `end` on an arrow's end. */
  handle?: string;
  /** Which end of an arrow (`data-end`). */
  end?: string;
}

export interface Down {
  /** Where, on screen (relative to the board's element). */
  point: Point;
  /** Every pointer now down, this one included. */
  pointers: readonly Point[];
  button: number;
  touch: boolean;
  shift: boolean;
  /** Space is held: the pointer pans. */
  spaceHeld: boolean;
  tool: Tool;
  target: Target;
}

export interface Move {
  point: Point;
  /** Where this pointer was before. */
  before: Point;
  pointers: readonly Point[];
  shift: boolean;
  /** Every sample the browser coalesced into this move, on screen. */
  samples: readonly Point[];
}

export interface Up {
  point: Point;
  /** How many pointers are still down. */
  remaining: number;
  /** A clock in ms (`performance.now()`), for a double tap. */
  now: number;
  lastTap: Tap | null;
}

const NO_IDS: ReadonlySet<string> = new Set();

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** The items a marquee touches. */
export function hits(items: readonly BoardItem[], box: Box): string[] {
  return items.filter((b) => intersects(box, bounds(b))).map((b) => b.id);
}

/** Ink strokes within reach of the eraser's path from `a` to `b`. */
export function strokesNear(
  items: readonly BoardItem[],
  a: Point,
  b: Point,
  zoom: number,
): string[] {
  const reach = Math.max(HIT_TOLERANCE, ERASER_REACH / zoom);
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / reach),
  );
  const out: string[] = [];
  for (const item of items) {
    if (item.kind !== 'ink') continue;
    for (let i = 0; i <= steps; i += 1) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const y = a.y + ((b.y - a.y) * i) / steps;
      if (hitTest(item, x, y, reach)) {
        out.push(item.id);
        break;
      }
    }
  }
  return out;
}

/**
 * A pointer pressed. `current` is the gesture under way, kept when a
 * third finger lands or the press does nothing.
 */
export function pointerDown(
  current: Gesture | null,
  scene: Scene,
  down: Down,
): Step {
  const { view: v, byId, selected } = scene;
  const p = down.point;
  const keep: Step = { gesture: current, effects: [] };

  if (down.pointers.length === 2) {
    // A second finger: whatever the first was doing becomes a pinch.
    const [a, b] = down.pointers;
    if (!a || !b) return { gesture: null, effects: [{ type: 'cancel' }] };
    return {
      gesture: {
        kind: 'pinch',
        start: v,
        mid: midpoint(a, b),
        distance: Math.hypot(a.x - b.x, a.y - b.y),
      },
      effects: [{ type: 'cancel' }],
    };
  }
  if (down.pointers.length > 2) return keep;

  const { item: id, handle, end } = down.target;
  // The editor's blur saves it; the board takes focus for its keys.
  const effects: Effect[] = id ? [] : [{ type: 'focusSurface' }];

  if (down.button === 1 || down.spaceHeld) {
    effects.push({ type: 'preventDefault' }, { type: 'panning', on: true });
    return { gesture: { kind: 'pan', last: p }, effects };
  }
  const tool = down.tool;
  if (draws(tool)) {
    // One finger (or the mouse) draws; a second finger turns it into a
    // pinch, and what was drawn so far is dropped.
    effects.push({ type: 'focusSurface' });
    const at = toBoard(v, p);
    if (tool === 'ink') {
      effects.push({
        type: 'draft',
        draft: { kind: 'ink', points: [at.x, at.y] },
      });
      return { gesture: { kind: 'ink', points: [at.x, at.y] }, effects };
    }
    if (tool === 'eraser') {
      const ids = new Set(strokesNear(scene.items, at, at, v.zoom));
      effects.push({ type: 'erasing', ids });
      return { gesture: { kind: 'erase', last: at, ids }, effects };
    }
    return {
      gesture: {
        kind: 'draw',
        tool,
        screen: p,
        start: at,
        end: at,
        shift: down.shift,
      },
      effects,
    };
  }
  if (tool !== 'select') {
    return { gesture: { kind: 'place', tool, start: p }, effects };
  }
  const [only] = selected;
  const one = only ? byId.get(only) : undefined;
  if (end && one?.kind === 'arrow') {
    const which = end === 'start' ? 0 : 1;
    effects.push({
      type: 'endEdit',
      edit: { id: one.id, points: one.points },
    });
    return {
      gesture: {
        kind: 'end',
        id: one.id,
        which,
        at: arrowEnds(one)[which],
        shift: down.shift,
      },
      effects,
    };
  }
  if (handle && one) {
    const box = { x: one.x, y: one.y, w: one.w, h: one.h };
    return {
      gesture: {
        kind: 'resize',
        id: one.id,
        corner: handle as Corner,
        start: toBoard(v, p),
        origin: box,
        box,
      },
      effects,
    };
  }
  if (id && byId.has(id)) {
    const wasSelected = selected.includes(id);
    let next = selected;
    if (down.shift) {
      next = wasSelected ? selected.filter((s) => s !== id) : [...selected, id];
    } else if (!wasSelected) {
      next = [id];
    }
    effects.push({ type: 'pressing' }, { type: 'select', ids: next });
    if (!next.includes(id)) return { gesture: current, effects };
    effects.push({ type: 'focusPressed' });
    const origins = new Map<string, Point>();
    for (const s of next) {
      const item = byId.get(s);
      if (item) origins.set(s, { x: item.x, y: item.y });
    }
    return {
      gesture: {
        kind: 'move',
        start: p,
        origins,
        moved: false,
        dx: 0,
        dy: 0,
        item: id,
        wasSelected,
        shift: down.shift,
      },
      effects,
    };
  }
  if (down.touch) {
    // One finger on empty board pans; resting a moment draws a marquee.
    effects.push({ type: 'longPress', start: true });
    return { gesture: { kind: 'press', start: p }, effects };
  }
  const base = down.shift ? selected : [];
  if (!down.shift) effects.push({ type: 'select', ids: [] });
  const start = toBoard(v, p);
  effects.push({ type: 'marquee', box: { ...start, w: 0, h: 0 } });
  return { gesture: { kind: 'marquee', start, base }, effects };
}

/** A finger rested on empty board: it draws a marquee from there. */
export function longPress(current: Gesture | null, view: Viewport): Step {
  if (current?.kind !== 'press') return { gesture: current, effects: [] };
  const start = toBoard(view, current.start);
  return {
    gesture: { kind: 'marquee', start, base: [] },
    effects: [
      { type: 'select', ids: [] },
      { type: 'marquee', box: { ...start, w: 0, h: 0 } },
    ],
  };
}

/** A pointer moved while `g` is under way. */
export function pointerMove(g: Gesture, scene: Scene, move: Move): Step {
  const { view: v } = scene;
  const p = move.point;
  const same: Step = { gesture: g, effects: [] };
  switch (g.kind) {
    case 'pinch': {
      const [a, b] = move.pointers;
      if (!a || !b) return same;
      return {
        gesture: g,
        effects: [
          {
            type: 'view',
            view: pinch(
              g.start,
              g.mid,
              g.distance,
              midpoint(a, b),
              Math.hypot(a.x - b.x, a.y - b.y),
            ),
          },
        ],
      };
    }
    case 'pan':
      return {
        gesture: { kind: 'pan', last: p },
        effects: [
          { type: 'view', view: panBy(v, p.x - g.last.x, p.y - g.last.y) },
        ],
      };
    case 'draw': {
      const next = { ...g, end: toBoard(v, p), shift: move.shift };
      if (Math.hypot(p.x - g.screen.x, p.y - g.screen.y) <= DRAG_SLOP) {
        return { gesture: next, effects: [{ type: 'draft', draft: null }] };
      }
      return {
        gesture: next,
        effects: [
          {
            type: 'draft',
            draft:
              next.tool === 'rect'
                ? {
                    kind: 'rect',
                    box: dragBox(next.start, next.end, next.shift),
                  }
                : {
                    kind: 'arrow',
                    from: next.start,
                    to: next.shift
                      ? constrainAngle(next.start, next.end)
                      : next.end,
                  },
          },
        ],
      };
    }
    case 'ink': {
      // Every sample the browser coalesced, so a fast stroke stays smooth.
      const points = [...g.points];
      for (const s of move.samples) {
        const at = toBoard(v, s);
        points.push(at.x, at.y);
      }
      return {
        gesture: { kind: 'ink', points },
        effects: [{ type: 'draft', draft: { kind: 'ink', points } }],
      };
    }
    case 'erase': {
      const at = toBoard(v, p);
      const found = strokesNear(scene.items, g.last, at, v.zoom).filter(
        (id) => !g.ids.has(id),
      );
      if (found.length === 0) {
        return { gesture: { ...g, last: at }, effects: [] };
      }
      const ids = new Set([...g.ids, ...found]);
      return {
        gesture: { kind: 'erase', last: at, ids },
        effects: [{ type: 'erasing', ids }],
      };
    }
    case 'end': {
      const arrow = scene.byId.get(g.id);
      if (!arrow) return same;
      const [a, b] = arrowEnds(arrow);
      const other = g.which === 0 ? b : a;
      let at = toBoard(v, p);
      if (move.shift) at = constrainAngle(other, at);
      return {
        gesture: { ...g, at, shift: move.shift },
        effects: [
          {
            type: 'endEdit',
            edit: {
              id: g.id,
              points:
                g.which === 0
                  ? arrowPoints(arrow, at, b)
                  : arrowPoints(arrow, a, at),
            },
          },
        ],
      };
    }
    case 'place':
    case 'press': {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= DRAG_SLOP) {
        return same;
      }
      const effects: Effect[] =
        g.kind === 'press' ? [{ type: 'longPress', start: false }] : [];
      effects.push(
        {
          type: 'view',
          view: panBy(v, p.x - move.before.x, p.y - move.before.y),
        },
        { type: 'panning', on: true },
      );
      return { gesture: { kind: 'pan', last: p }, effects };
    }
    case 'move': {
      const sx = p.x - g.start.x;
      const sy = p.y - g.start.y;
      if (!g.moved && Math.hypot(sx, sy) <= DRAG_SLOP) return same;
      const next = { ...g, moved: true, dx: sx / v.zoom, dy: sy / v.zoom };
      return {
        gesture: next,
        effects: [
          {
            type: 'drag',
            drag: { origins: next.origins, dx: next.dx, dy: next.dy },
          },
        ],
      };
    }
    case 'marquee': {
      const box = boxBetween(g.start, toBoard(v, p));
      return {
        gesture: g,
        effects: [
          { type: 'marquee', box },
          {
            type: 'select',
            ids: [...new Set([...g.base, ...hits(scene.items, box)])],
          },
        ],
      };
    }
    case 'resize': {
      const at = toBoard(v, p);
      const box = resizeBox(
        g.origin,
        g.corner,
        at.x - g.start.x,
        at.y - g.start.y,
        MIN_SIZE,
      );
      return {
        gesture: { ...g, box },
        effects: [{ type: 'resize', resize: { id: g.id, box } }],
      };
    }
  }
}

/** A rect or an arrow drawn: added, selected, and back to Select. */
function finishDraw(
  g: Extract<Gesture, { kind: 'draw' }>,
  scene: Scene,
  screen: Point,
): Effect[] {
  const dragged = Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y);
  if (g.tool === 'rect') {
    if (dragged <= DRAG_SLOP)
      return [{ type: 'create', kind: 'rect', at: g.start }];
    const box = dragBox(g.start, g.end, g.shift);
    if (box.w < 1 || box.h < 1) return [];
    return [{ type: 'add', kind: 'rect', box, pick: true }];
  }
  if (dragged <= DRAG_SLOP) return [];
  const from = snapEnd(scene.items, g.start);
  const to = snapEnd(
    scene.items,
    g.shift ? constrainAngle(g.start, g.end) : g.end,
  );
  if (Math.hypot(to.x - from.x, to.y - from.y) < 2 / scene.view.zoom) return [];
  const { at, box, points } = arrowBetween(from, to);
  return [{ type: 'add', kind: 'arrow', box, points, at, pick: true }];
}

/**
 * A pointer lifted while `g` is under way: what it made. Also returns the
 * last tap, for the next one to tell a double tap.
 */
export function pointerUp(
  g: Gesture,
  scene: Scene,
  up: Up,
): Step & { lastTap: Tap | null } {
  const { view: v, byId } = scene;
  const p = up.point;
  const lastTap = up.lastTap;
  if (g.kind === 'pinch') {
    // The other finger lifting ends it too; it never turns into a drag.
    return { gesture: up.remaining === 0 ? null : g, effects: [], lastTap };
  }
  const done = (effects: Effect[], tap: Tap | null = lastTap) => ({
    gesture: null,
    effects,
    lastTap: tap,
  });
  switch (g.kind) {
    case 'pan':
      return done([{ type: 'panning', on: false }]);
    case 'place':
      return done([{ type: 'create', kind: g.tool, at: toBoard(v, p) }]);
    case 'draw':
      return done([{ type: 'draft', draft: null }, ...finishDraw(g, scene, p)]);
    case 'ink': {
      // Simplified to within a screen pixel, and to `inkPointsMax` at most.
      const stroke = strokeOf(g.points, 1 / v.zoom, LIMITS.inkPointsMax);
      return done([
        { type: 'draft', draft: null },
        {
          type: 'add',
          kind: 'ink',
          box: stroke,
          points: stroke.points,
          pick: false,
        },
      ]);
    }
    case 'erase': {
      const effects: Effect[] = [{ type: 'erasing', ids: NO_IDS }];
      const ids = [...g.ids].filter((id) => byId.has(id));
      if (ids.length > 0) {
        effects.push({
          type: 'run',
          ops: [{ type: 'deleteBoardItems', ids }],
          after: [
            { type: 'deselect', ids: g.ids },
            {
              type: 'announce',
              text:
                ids.length === 1
                  ? 'Erased a drawing'
                  : `Erased ${ids.length} drawings`,
            },
          ],
        });
      }
      return done(effects);
    }
    case 'end': {
      const effects: Effect[] = [{ type: 'endEdit', edit: null }];
      const arrow = byId.get(g.id);
      if (!arrow) return done(effects);
      // Dropped on a sticky or a rect, the end holds on to its edge.
      const at = snapEnd(scene.items, g.at, arrow.id);
      const ops = endOps(arrow, arrowEnds(arrow), g.which, at);
      if (ops.length > 0) effects.push({ type: 'run', ops });
      return done(effects);
    }
    case 'press':
      return done([
        { type: 'longPress', start: false },
        { type: 'select', ids: [] },
      ]);
    case 'move': {
      if (g.moved) {
        return done([
          {
            type: 'moveTo',
            moves: [...g.origins].map(([id, o]) => ({
              id,
              x: clampCoord(o.x + g.dx),
              y: clampCoord(o.y + g.dy),
            })),
          },
          { type: 'drag', drag: null },
        ]);
      }
      const effects: Effect[] = [{ type: 'drag', drag: null }];
      // A click on one of several selected narrows to it.
      if (g.wasSelected && !g.shift) {
        effects.push({ type: 'select', ids: [g.item] });
      }
      // A double click (or two taps) on a sticky or text opens its
      // editor. Counted here, not from `dblclick`: the board holds the
      // pointer, so the click events land on it, not on the item.
      if (
        lastTap &&
        lastTap.id === g.item &&
        up.now - lastTap.at < DOUBLE_TAP_MS
      ) {
        effects.push({ type: 'edit', id: g.item });
        return done(effects, null);
      }
      return done(effects, { id: g.item, at: up.now });
    }
    case 'marquee':
      return done([{ type: 'marquee', box: null }]);
    case 'resize': {
      const effects: Effect[] = [{ type: 'resize', resize: null }];
      const item = byId.get(g.id);
      if (!item) return done(effects);
      const ops = resizeOps(scene.items, item, g.box);
      if (ops.length > 0) effects.push({ type: 'run', ops });
      return done(effects);
    }
  }
}
