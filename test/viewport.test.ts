import { describe, expect, it } from 'vitest';
import {
  boxBetween,
  centred,
  centreOn,
  clampCoord,
  clampZoom,
  fitTo,
  gridStep,
  intersects,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  parseViewport,
  pinch,
  resizeBox,
  toBoard,
  toScreen,
  union,
  type Viewport,
  viewBoxOf,
  wheelZoomFactor,
  zoomAt,
} from '../src/components/board/viewport';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('screen and board coordinates', () => {
  const view: Viewport = { x: -100, y: 50, zoom: 2 };

  it('turns a screen point into a board point and back', () => {
    expect(toBoard(view, { x: 0, y: 0 })).toEqual({ x: -100, y: 50 });
    expect(toBoard(view, { x: 200, y: 100 })).toEqual({ x: 0, y: 100 });
    expect(toScreen(view, { x: 0, y: 100 })).toEqual({ x: 200, y: 100 });
    const p = { x: 37.5, y: -12.25 };
    close(toScreen(view, toBoard(view, p)), p);
  });

  it('pans by screen pixels, whatever the zoom', () => {
    const moved = panBy(view, 40, -20);
    expect(moved).toEqual({ x: -120, y: 60, zoom: 2 });
    // The board point that was under (0, 0) is now under (40, -20).
    close(toScreen(moved, { x: -100, y: 50 }), { x: 40, y: -20 });
  });

  it('gives the viewBox the screen shows', () => {
    expect(viewBoxOf(view, 800, 600)).toBe('-100 50 400 300');
    expect(viewBoxOf(centred(800, 600), 800, 600)).toBe('-400 -300 800 600');
  });
});

describe('zoom', () => {
  it('clamps to 0.1× and 4×', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('zooms around a point: the board point under it stays', () => {
    const view: Viewport = { x: 10, y: 20, zoom: 1 };
    const at = { x: 300, y: 200 };
    const under = toBoard(view, at);
    for (const zoom of [0.1, 0.5, 2, 4]) {
      const next = zoomAt(view, at, zoom);
      expect(next.zoom).toBe(zoom);
      close(toBoard(next, at), under);
    }
    // Past the limit, it stops at the limit and still keeps the point.
    const far = zoomAt(view, at, 40);
    expect(far.zoom).toBe(MAX_ZOOM);
    close(toBoard(far, at), under);
  });

  it('pinches and pans at once', () => {
    const start: Viewport = { x: 0, y: 0, zoom: 1 };
    const startMid = { x: 100, y: 100 };
    const under = toBoard(start, startMid);
    // Fingers twice as far apart, and 50px to the right.
    const next = pinch(start, startMid, 100, { x: 150, y: 100 }, 200);
    expect(next.zoom).toBe(2);
    close(toBoard(next, { x: 150, y: 100 }), under);
    // Fingers that never spread only pan.
    const panned = pinch(start, startMid, 100, { x: 120, y: 90 }, 100);
    expect(panned).toEqual({ x: -20, y: 10, zoom: 1 });
  });

  it('turns wheel deltas into gentle factors', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    // A big mouse notch is capped, so one notch is about 10%.
    expect(wheelZoomFactor(1000)).toBeCloseTo(wheelZoomFactor(50), 10);
  });
});

describe('fit', () => {
  it('centres a box and shows it whole', () => {
    const box = { x: 0, y: 0, w: 2000, h: 1000 };
    const view = fitTo(box, 1000, 600, 50);
    expect(view.zoom).toBeCloseTo(0.45, 6);
    close(toScreen(view, { x: 1000, y: 500 }), { x: 500, y: 300 });
  });

  it('never blows a small board up past 100%', () => {
    const view = fitTo({ x: 10, y: 10, w: 200, h: 200 }, 1000, 600);
    expect(view.zoom).toBe(1);
    close(toScreen(view, { x: 110, y: 110 }), { x: 500, y: 300 });
  });

  it('stops at the smallest zoom for a huge board', () => {
    const view = fitTo({ x: 0, y: 0, w: 1e6, h: 1e6 }, 1000, 600);
    expect(view.zoom).toBe(MIN_ZOOM);
  });
});

describe('boxes', () => {
  it('unions, intersects and spans two corners', () => {
    expect(union([])).toBeNull();
    expect(
      union([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -5, y: 20, w: 10, h: 5 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 15, h: 25 });
    expect(boxBetween({ x: 10, y: 0 }, { x: 0, y: 5 })).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 5,
    });
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 11, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('resizes from a corner, holding the opposite one', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    expect(resizeBox(box, 'se', 20, 10, 40)).toEqual({
      x: 0,
      y: 0,
      w: 120,
      h: 110,
    });
    expect(resizeBox(box, 'nw', 20, 10, 40)).toEqual({
      x: 20,
      y: 10,
      w: 80,
      h: 90,
    });
    // Never under the minimum; the far corner still holds.
    expect(resizeBox(box, 'ne', 0, 500, 40)).toEqual({
      x: 0,
      y: 60,
      w: 100,
      h: 40,
    });
  });
});

describe('the grid and storage', () => {
  it('spaces the dots at least 12px apart on screen', () => {
    expect(gridStep(1)).toBe(20);
    expect(gridStep(4)).toBe(20);
    expect(gridStep(0.5)).toBe(40);
    expect(gridStep(0.1)).toBe(160);
    for (const zoom of [0.1, 0.13, 0.3, 0.59, 1, 2.5]) {
      expect(gridStep(zoom) * zoom).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps coordinates whole and on the board', () => {
    expect(clampCoord(10.6)).toBe(11);
    expect(clampCoord(1e9)).toBe(100_000);
    expect(clampCoord(-1e9)).toBe(-100_000);
  });

  it('reads a remembered viewport, or nothing', () => {
    expect(parseViewport({ x: 1, y: 2, zoom: 3 })).toEqual({
      x: 1,
      y: 2,
      zoom: 3,
    });
    expect(parseViewport({ x: 1, y: 2, zoom: 30 })).toEqual({
      x: 1,
      y: 2,
      zoom: MAX_ZOOM,
    });
    expect(parseViewport({ x: '1', y: 2, zoom: 1 })).toBeNull();
    expect(parseViewport({ x: Number.NaN, y: 2, zoom: 1 })).toBeNull();
    expect(parseViewport(null)).toBeNull();
  });
});

describe('centreOn', () => {
  const box = { x: 1000, y: 500, w: 200, h: 200 };
  const middle = (v: Viewport, w: number, h: number) =>
    toBoard(v, { x: w / 2, y: h / 2 });

  it('centres the box at the current zoom when it is at least 100%', () => {
    const v = centreOn({ x: 0, y: 0, zoom: 1.5 }, box, 800, 600);
    expect(v.zoom).toBe(1.5);
    close(middle(v, 800, 600), { x: 1100, y: 600 });
  });

  it('zooms in to 100% from further out', () => {
    const v = centreOn({ x: 0, y: 0, zoom: 0.25 }, box, 800, 600);
    expect(v.zoom).toBe(1);
    close(middle(v, 800, 600), { x: 1100, y: 600 });
  });

  it('never cuts the box off on a small screen', () => {
    const v = centreOn({ x: 0, y: 0, zoom: 2 }, box, 300, 600);
    expect(v.zoom * box.w).toBeLessThanOrEqual(300);
    close(middle(v, 300, 600), { x: 1100, y: 600 });
  });
});
