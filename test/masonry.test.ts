import { describe, expect, it } from 'vitest';
import { masonryColumns, masonryPlaces } from '../src/lib/masonry';

describe('masonry', () => {
  it('fits columns to the width: one on a phone, at most three', () => {
    expect(masonryColumns(380, 12)).toBe(1);
    expect(masonryColumns(600, 12)).toBe(2);
    expect(masonryColumns(900, 12)).toBe(3);
    expect(masonryColumns(2400, 12)).toBe(3);
    expect(masonryColumns(0, 12)).toBe(1);
  });

  it('packs into the shortest column, leftmost on a tie, with no holes', () => {
    const { places, height } = masonryPlaces([100, 50, 80, 30, 40], 3, 10);
    expect(places).toEqual([
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 2, top: 0 },
      { column: 1, top: 60 },
      { column: 2, top: 90 },
    ]);
    // Each starts no higher than the one before: the reading order.
    const tops = places.map((p) => p.top);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(height).toBe(130);
  });

  it('is one column of everything in order', () => {
    const { places, height } = masonryPlaces([10, 20], 1, 4);
    expect(places).toEqual([
      { column: 0, top: 0 },
      { column: 0, top: 14 },
    ]);
    expect(height).toBe(34);
    expect(masonryPlaces([], 2, 4).height).toBe(0);
  });
});
