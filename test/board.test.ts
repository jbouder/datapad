import { describe, expect, it } from 'vitest';
import {
  bounds,
  byZ,
  checkShape,
  HIT_TOLERANCE,
  hitTest,
  itemsOf,
  nextZ,
  segmentDistance,
  simplify,
} from '#shared/board';
import type { BoardItem, Snapshot } from '#shared/types';

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

describe('simplify', () => {
  it('drops points on a straight line, keeping both ends', () => {
    const line = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
    expect(simplify(line, 0.5)).toEqual([0, 0, 5, 5]);
  });

  it('keeps a corner that sticks out past the tolerance', () => {
    const corner = [0, 0, 5, 0.1, 10, 0, 10, 5, 10, 10];
    expect(simplify(corner, 1)).toEqual([0, 0, 10, 0, 10, 10]);
    // A looser tolerance lets the corner go too.
    expect(simplify(corner, 10)).toEqual([0, 0, 10, 10]);
  });

  it('never returns more than it was given, and keeps short strokes whole', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([3, 4], 1)).toEqual([3, 4]);
    expect(simplify([0, 0, 9, 9], 1)).toEqual([0, 0, 9, 9]);
    // A trailing odd coordinate is not a point.
    expect(simplify([0, 0, 9, 9, 7], 1)).toEqual([0, 0, 9, 9]);
    // A jagged stroke: every result is within the input, ends first and last.
    const jagged: number[] = [];
    for (let i = 0; i < 500; i += 1) jagged.push(i, (i * 37) % 23);
    for (const tolerance of [0, 0.5, 2, 8, 50]) {
      const out = simplify(jagged, tolerance);
      expect(out.length).toBeLessThanOrEqual(jagged.length);
      expect(out.length % 2).toBe(0);
      expect(out.slice(0, 2)).toEqual(jagged.slice(0, 2));
      expect(out.slice(-2)).toEqual(jagged.slice(-2));
    }
    // Zero tolerance keeps every point that is off the line.
    expect(simplify(jagged, 0).length).toBeGreaterThan(4);
  });

  it('leaves its input alone', () => {
    const line = Object.freeze([0, 0, 1, 1, 2, 2]) as number[];
    expect(simplify(line, 1)).toEqual([0, 0, 2, 2]);
    expect(line).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('segmentDistance', () => {
  it('measures to the segment, not the infinite line', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    // Past the end: the distance to the end point.
    expect(segmentDistance(13, 4, 0, 0, 10, 0)).toBe(5);
    // A zero-length segment is a point.
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('bounds', () => {
  it('is the box for a sticky, a text or a rect', () => {
    expect(bounds(item('s', { x: 10, y: 20, w: 30, h: 40 }))).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
  });

  it('wraps an arrow’s or an ink stroke’s points, relative to x, y', () => {
    const arrow = item('a', {
      kind: 'arrow',
      x: 100,
      y: 100,
      w: 0,
      h: 0,
      points: [50, -10, -20, 30],
    });
    expect(bounds(arrow)).toEqual({ x: 80, y: 90, w: 70, h: 40 });
    const ink = item('i', {
      kind: 'ink',
      x: 5,
      y: 5,
      points: [0, 0, 10, 2, 4, 9],
    });
    expect(bounds(ink)).toEqual({ x: 5, y: 5, w: 10, h: 9 });
    expect(
      bounds(item('d', { kind: 'ink', x: 1, y: 2, points: [3, 4] })),
    ).toEqual({ x: 4, y: 6, w: 0, h: 0 });
  });
});

describe('hitTest', () => {
  it('hits inside a rect’s box (no rotation), with the tolerance around it', () => {
    const rect = item('r', { kind: 'rect', x: 100, y: 100, w: 50, h: 20 });
    expect(hitTest(rect, 125, 110)).toBe(true);
    expect(hitTest(rect, 100, 100)).toBe(true);
    expect(hitTest(rect, 150 + HIT_TOLERANCE, 110)).toBe(true);
    expect(hitTest(rect, 151 + HIT_TOLERANCE, 110)).toBe(false);
    expect(hitTest(rect, 125, 90, 0)).toBe(false);
    // Outside the box along its diagonal: a rotated rect would hit, this
    // one does not.
    expect(hitTest(rect, 170, 140)).toBe(false);
  });

  it('hits an arrow within the tolerance of its segment only', () => {
    const arrow = item('a', {
      kind: 'arrow',
      x: 10,
      y: 10,
      points: [0, 0, 100, 0],
    });
    expect(hitTest(arrow, 60, 14)).toBe(true);
    expect(hitTest(arrow, 60, 10 + HIT_TOLERANCE + 1)).toBe(false);
    // Past its end, though on its line.
    expect(hitTest(arrow, 120, 10)).toBe(false);
    expect(hitTest(arrow, 60, 14, 2)).toBe(false);
  });

  it('hits any segment of an ink stroke, and a one-point dot', () => {
    const ink = item('i', {
      kind: 'ink',
      x: 0,
      y: 0,
      points: [0, 0, 50, 0, 50, 50],
    });
    expect(hitTest(ink, 25, 2)).toBe(true);
    expect(hitTest(ink, 52, 30)).toBe(true);
    // Inside the corner the stroke turns around, but on neither segment.
    expect(hitTest(ink, 25, 25)).toBe(false);
    const dot = item('d', { kind: 'ink', x: 10, y: 10, points: [0, 0] });
    expect(hitTest(dot, 12, 12)).toBe(true);
    expect(hitTest(dot, 30, 30)).toBe(false);
  });
});

describe('checkShape', () => {
  it('wants two ends on an arrow, a point on ink, none on the rest', () => {
    expect(checkShape({ kind: 'arrow', points: [0, 0, 1, 1] })).toBeNull();
    expect(checkShape({ kind: 'arrow', points: [0, 0] })).toBe(
      'An arrow has two ends',
    );
    expect(checkShape({ kind: 'ink', points: [0, 0] })).toBeNull();
    expect(checkShape({ kind: 'ink', points: [] })).toBe(
      'An ink stroke needs a point',
    );
    expect(checkShape({ kind: 'sticky', points: [] })).toBeNull();
    expect(checkShape({ kind: 'rect', points: [0, 0] })).toBe(
      'Only arrows and ink have points',
    );
  });
});

describe('nextZ', () => {
  it('is one above the highest, 0 on an empty board', () => {
    expect(nextZ([])).toBe(0);
    expect(nextZ([{ z: 3 }, { z: -2 }, { z: 7 }])).toBe(8);
    expect(nextZ([{ z: -5 }])).toBe(-4);
  });
});

describe('itemsOf', () => {
  const boardItems: Snapshot['boardItems'] = {
    c: item('c', { z: 2 }),
    a: item('a', { z: 0 }),
    b2: item('b2', { z: 1 }),
    b1: item('b1', { z: 1 }),
    g: item('g', { boardId: 'general', z: -1 }),
  };

  it('is one board’s items in drawing order, ties by id', () => {
    expect(itemsOf(boardItems, 'p1').map((b) => b.id)).toEqual([
      'a',
      'b1',
      'b2',
      'c',
    ]);
    expect(itemsOf(boardItems, 'general').map((b) => b.id)).toEqual(['g']);
    expect(itemsOf(boardItems, 'nowhere')).toEqual([]);
    expect([...Object.values(boardItems)].sort(byZ)[0]?.id).toBe('g');
  });

  it('returns the same array until the items change, for any board', () => {
    const first = itemsOf(boardItems, 'p1');
    expect(itemsOf(boardItems, 'general')).toBe(itemsOf(boardItems, 'general'));
    expect(itemsOf(boardItems, 'p1')).toBe(first);
    const next = { ...boardItems, d: item('d', { z: 9 }) };
    expect(itemsOf(next, 'p1')).not.toBe(first);
    expect(itemsOf(next, 'p1').at(-1)?.id).toBe('d');
  });
});
