import { describe, expect, it } from 'vitest';
import {
  arrowEnds,
  arrowPoints,
  attachedTo,
  connect,
  connectable,
  edgeToward,
  growBox,
  middle,
  nextTarget,
  onEdge,
} from '#shared/board';
import type { BoardItem } from '#shared/types';

/** The keyboard's whiteboard geometry (#222): resize, and arrows drawn without a drag. */

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

describe('growBox', () => {
  const box = { x: 10, y: 20, w: 200, h: 100 };

  it('grows and shrinks from the top-left, which stays put', () => {
    expect(growBox(box, 1, 0, 40)).toEqual({ x: 10, y: 20, w: 201, h: 100 });
    expect(growBox(box, 0, 10, 40)).toEqual({ x: 10, y: 20, w: 200, h: 110 });
    expect(growBox(box, -10, -1, 40)).toEqual({ x: 10, y: 20, w: 190, h: 99 });
  });

  it('stops at the smallest size', () => {
    expect(growBox({ ...box, w: 45 }, -10, 0, 40).w).toBe(40);
    expect(growBox({ ...box, w: 40 }, -1, 0, 40).w).toBe(40);
  });

  it('never grows a box already under the smallest size on a shrink', () => {
    expect(growBox({ ...box, h: 30 }, 0, -1, 40).h).toBe(30);
    expect(growBox({ ...box, h: 30 }, 0, 1, 40).h).toBe(31);
  });
});

describe('edgeToward and connect', () => {
  const left = { x: 0, y: 0, w: 200, h: 200 };
  const right = { x: 300, y: 0, w: 200, h: 200 };
  const below = { x: 0, y: 300, w: 200, h: 200 };

  it('leaves a box by the side facing the point', () => {
    expect(edgeToward(left, { x: 1000, y: 100 })).toEqual({ x: 200, y: 100 });
    expect(edgeToward(left, { x: -50, y: 100 })).toEqual({ x: 0, y: 100 });
    expect(edgeToward(left, { x: 100, y: 900 })).toEqual({ x: 100, y: 200 });
    expect(edgeToward(left, { x: 100, y: -9 })).toEqual({ x: 100, y: 0 });
    // Up and to the right, steeper than the corner: out of the top.
    const out = edgeToward(left, { x: 200, y: -200 });
    expect(out.y).toBe(0);
    expect(out.x).toBeCloseTo(400 / 3, 9);
  });

  it('picks a side when the point is its own middle', () => {
    expect(edgeToward(left, middle(left))).toEqual({ x: 200, y: 100 });
  });

  it('joins two boxes between their facing edges', () => {
    expect(connect(left, right)).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ]);
    expect(connect(left, below)).toEqual([
      { x: 100, y: 200 },
      { x: 100, y: 300 },
    ]);
  });

  it('draws an arrow whose ends stay attached to both', () => {
    const a = item('a', left);
    const b = item('b', right);
    const [from, to] = connect(a, b);
    const origin = { x: Math.round(from.x), y: Math.round(from.y) };
    const arrow = item('arrow', {
      kind: 'arrow',
      ...origin,
      z: 2,
      points: arrowPoints(origin, from, to),
    });
    const [p, q] = arrowEnds(arrow);
    expect(onEdge(a, p) && onEdge(b, q)).toBe(true);
    expect(attachedTo([a, b, arrow], p)?.id).toBe('a');
    expect(attachedTo([a, b, arrow], q)?.id).toBe('b');
  });
});

describe('nextTarget', () => {
  const items = [
    item('a'),
    item('ink', { kind: 'ink', points: [0, 0, 5, 5] }),
    item('b', { kind: 'text' }),
    item('arrow', { kind: 'arrow', points: [0, 0, 1, 1] }),
    item('c', { kind: 'rect' }),
  ];

  it('steps through stickies, text and rects only, in drawing order', () => {
    expect(items.filter(connectable).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(nextTarget(items, 'a', 1)?.id).toBe('b');
    expect(nextTarget(items, 'b', 1)?.id).toBe('c');
    expect(nextTarget(items, 'c', 1)?.id).toBe('a');
    expect(nextTarget(items, 'a', -1)?.id).toBe('c');
  });

  it('starts at either end with nothing picked yet', () => {
    expect(nextTarget(items, undefined, 1)?.id).toBe('a');
    expect(nextTarget(items, undefined, -1)?.id).toBe('c');
    expect(nextTarget(items, 'arrow', 1)?.id).toBe('a');
  });

  it('passes over the item the arrow starts from', () => {
    expect(nextTarget(items, 'a', 1, 'a')?.id).toBe('b');
    expect(nextTarget(items, 'b', 1, 'c')?.id).toBe('a');
    expect(nextTarget(items, 'a', -1, 'c')?.id).toBe('b');
  });

  it('finds nothing when there is nothing else', () => {
    expect(nextTarget([item('a')], 'a', 1, 'a')).toBeUndefined();
    expect(nextTarget([], undefined, 1)).toBeUndefined();
  });
});
