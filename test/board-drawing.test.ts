import { describe, expect, it } from 'vitest';
import {
  arrowEnds,
  arrowPoints,
  attachedTo,
  constrainAngle,
  dragBox,
  dropTarget,
  followBox,
  nearestEdge,
  onEdge,
  reaim,
  snapEnd,
  strokeOf,
} from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BoardItem } from '#shared/types';

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
    color: 'neutral',
    text: '',
    points: [],
    ...overrides,
  };
}

/** An arrow from `a` to `b`, its `x, y` at `a`. */
function arrow(id: string, a: [number, number], b: [number, number], z = 9) {
  const [ax, ay] = a;
  return item(id, {
    kind: 'arrow',
    x: ax,
    y: ay,
    w: 0,
    h: 0,
    z,
    points: arrowPoints(
      { x: ax, y: ay },
      { x: ax, y: ay },
      { x: b[0], y: b[1] },
    ),
  });
}

describe('drawing a rect and an arrow', () => {
  it('dragBox spans the drag either way, and shift makes a square', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 50, y: 30 })).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 20,
    });
    expect(dragBox({ x: 50, y: 30 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 20,
    });
    // Up and to the left, squared on the longer side.
    expect(dragBox({ x: 50, y: 50 }, { x: 40, y: 20 }, true)).toEqual({
      x: 20,
      y: 20,
      w: 30,
      h: 30,
    });
  });

  it('constrainAngle turns to the nearest 45°, keeping the length', () => {
    const flat = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(flat.y).toBe(0);
    expect(flat.x).toBeCloseTo(Math.hypot(100, 10), 9);
    const d = constrainAngle({ x: 10, y: 10 }, { x: 60, y: 70 });
    expect(d.x - 10).toBeCloseTo(d.y - 10, 9);
    expect(Math.hypot(d.x - 10, d.y - 10)).toBeCloseTo(Math.hypot(50, 60), 9);
    const up = constrainAngle({ x: 0, y: 0 }, { x: -3, y: -80 });
    expect(up.x).toBe(0);
    expect(up.y).toBeCloseTo(-Math.hypot(3, 80), 9);
    expect(constrainAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('arrowPoints and arrowEnds are relative to the arrow’s x, y', () => {
    const a = arrow('a', [100, 50], [300, 150]);
    expect(a.points).toEqual([0, 0, 200, 100]);
    expect(arrowEnds(a)).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 150 },
    ]);
  });
});

describe('ink', () => {
  it('strokeOf simplifies, fits inkPointsMax and is relative to its corner', () => {
    // A wavy line of 3000 points: far more than an item may hold.
    const raw: number[] = [];
    for (let i = 0; i < 3000; i += 1)
      raw.push(50 + i, 80 + 40 * Math.sin(i / 7));
    const stroke = strokeOf(raw, 0.1, LIMITS.inkPointsMax);
    expect(stroke.points.length).toBeLessThanOrEqual(LIMITS.inkPointsMax);
    expect(stroke.points.length % 2).toBe(0);
    expect(stroke.x).toBe(50);
    expect(stroke.y).toBeCloseTo(40, 0);
    expect(stroke.w).toBe(2999);
    // Relative: the first point sits at the stroke's own left edge.
    expect(stroke.points[0]).toBe(0);
    expect(Math.min(...stroke.points.filter((_, i) => i % 2 === 1))).toBe(0);
  });

  it('a straight stroke keeps its two ends; a tap is one point', () => {
    expect(strokeOf([0, 0, 5, 5, 10, 10], 1, 100)).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      points: [0, 0, 10, 10],
    });
    expect(strokeOf([7, 9], 1, 100)).toEqual({
      x: 7,
      y: 9,
      w: 0,
      h: 0,
      points: [0, 0],
    });
  });
});

describe('arrows attach to stickies and rects', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('nearestEdge: from outside, the closest border point; from inside, out the nearest side', () => {
    expect(nearestEdge(box, { x: 50, y: 150 })).toEqual({ x: 100, y: 150 });
    expect(nearestEdge(box, { x: 350, y: 250 })).toEqual({ x: 300, y: 200 });
    expect(nearestEdge(box, { x: 120, y: 160 })).toEqual({ x: 100, y: 160 });
    expect(nearestEdge(box, { x: 200, y: 190 })).toEqual({ x: 200, y: 200 });
    expect(nearestEdge(box, { x: 290, y: 150 })).toEqual({ x: 300, y: 150 });
    expect(nearestEdge(box, { x: 200, y: 104 })).toEqual({ x: 200, y: 100 });
  });

  it('onEdge is within half a unit of the border', () => {
    expect(onEdge(box, { x: 100, y: 150 })).toBe(true);
    expect(onEdge(box, { x: 100.4, y: 150 })).toBe(true);
    expect(onEdge(box, { x: 99.6, y: 150 })).toBe(true);
    expect(onEdge(box, { x: 102, y: 150 })).toBe(false);
    expect(onEdge(box, { x: 200, y: 150 })).toBe(false);
  });

  it('snapEnd lands on the topmost sticky or rect, never text, ink or itself', () => {
    const items = [
      item('low', { x: 0, y: 0, w: 300, h: 300, z: 0 }),
      item('high', { kind: 'rect', ...box, z: 1 }),
      item('words', { kind: 'text', x: 400, y: 0, w: 100, h: 40, z: 2 }),
    ];
    expect(dropTarget(items, { x: 150, y: 150 })?.id).toBe('high');
    expect(dropTarget(items, { x: 150, y: 150 }, 'high')?.id).toBe('low');
    expect(dropTarget(items, { x: 450, y: 20 })).toBeUndefined();
    expect(snapEnd(items, { x: 150, y: 150 })).toEqual({ x: 100, y: 150 });
    // Over nothing it stays where it was let go.
    expect(snapEnd(items, { x: 600, y: 600 })).toEqual({ x: 600, y: 600 });
  });

  it('attachedTo finds the item whose edge an end lies on', () => {
    const items = [
      item('s', { ...box }),
      item('r', { kind: 'rect', x: 500, y: 0, w: 50, h: 50 }),
    ];
    expect(attachedTo(items, { x: 300, y: 130 })?.id).toBe('s');
    expect(attachedTo(items, { x: 525, y: 50 })?.id).toBe('r');
    expect(attachedTo(items, { x: 200, y: 150 })).toBeUndefined();
  });

  it('followBox keeps the place on the border through a move and a resize', () => {
    const p = { x: 300, y: 125 }; // right edge, a quarter down
    expect(followBox(p, box, { ...box, x: 150, y: 0 })).toEqual({
      x: 350,
      y: 25,
    });
    expect(followBox(p, box, { x: 100, y: 100, w: 400, h: 200 })).toEqual({
      x: 500,
      y: 150,
    });
  });

  it('reaim moves attached ends with their item and leaves the rest', () => {
    const s = item('s', { ...box });
    const r = item('r', { kind: 'rect', x: 600, y: 100, w: 100, h: 100 });
    // From the sticky's right edge to the rect's left edge.
    const both = arrow('both', [300, 150], [600, 150]);
    // From empty board to the sticky's top edge.
    const one = arrow('one', [200, 0], [200, 100]);
    // Near the sticky, not on it.
    const free = arrow('free', [310, 300], [400, 300]);
    const items = [s, r, both, one, free];

    const moved = reaim(
      items,
      new Map([['s', { x: 150, y: 120, w: 200, h: 100 }]]),
    );
    expect(moved).toEqual([
      // Its start followed the sticky by (50, 20); the rect end stayed.
      { id: 'both', x: 300, y: 150, points: [50, 20, 300, 0] },
      { id: 'one', x: 200, y: 0, points: [0, 0, 50, 120] },
    ]);
    // The re-aimed ends are still on the moved sticky's edge.
    const after = items.map((b) =>
      b.id === 's' ? { ...b, x: 150, y: 120 } : b,
    );
    const next = { ...both, points: moved[0]?.points ?? [] };
    expect(attachedTo(after, arrowEnds(next)[0])?.id).toBe('s');

    // An arrow that moves itself keeps its shape.
    expect(
      reaim(items, new Map([['s', { ...box, x: 120 }]]), new Set(['both'])),
    ).toEqual([{ id: 'one', x: 200, y: 0, points: [0, 0, 20, 100] }]);
    // Nothing moved, nothing to do.
    expect(reaim(items, new Map())).toEqual([]);
  });
});
