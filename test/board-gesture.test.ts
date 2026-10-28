import { describe, expect, it } from 'vitest';
import type { BoardItem } from '#shared/types';
import {
  DOUBLE_TAP_MS,
  type Down,
  DRAG_SLOP,
  type Effect,
  type Gesture,
  hits,
  longPress,
  type Move,
  pointerDown,
  pointerMove,
  pointerUp,
  type Scene,
  strokesNear,
  type Up,
} from '../src/components/board/gesture';
import { MIN_SIZE } from '../src/components/board/metrics';
import {
  arrowBetween,
  endOps,
  moveOps,
  nudgeMoves,
  recolorOps,
  resizeOps,
} from '../src/components/board/ops';
import type { Viewport } from '../src/components/board/viewport';

/** The whiteboard's pointer gestures (#243): pure steps, effects as data. */

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

const VIEW: Viewport = { x: 0, y: 0, zoom: 1 };

function scene(
  items: BoardItem[],
  selected: string[] = [],
  view: Viewport = VIEW,
): Scene {
  return {
    view,
    items,
    byId: new Map(items.map((b) => [b.id, b])),
    selected,
  };
}

function down(overrides: Partial<Down> = {}): Down {
  const point = overrides.point ?? { x: 500, y: 500 };
  return {
    point,
    pointers: [point],
    button: 0,
    touch: false,
    shift: false,
    spaceHeld: false,
    tool: 'select',
    target: {},
    ...overrides,
  };
}

function move(overrides: Partial<Move> & Pick<Move, 'point'>): Move {
  return {
    before: overrides.point,
    pointers: [overrides.point],
    shift: false,
    samples: [overrides.point],
    ...overrides,
  };
}

function up(overrides: Partial<Up> & Pick<Up, 'point'>): Up {
  return { remaining: 0, now: 1000, lastTap: null, ...overrides };
}

const types = (effects: Effect[]) => effects.map((e) => e.type);
const find = <T extends Effect['type']>(effects: Effect[], type: T) =>
  effects.find((e): e is Extract<Effect, { type: T }> => e.type === type);

describe('pressing', () => {
  it('turns a second finger into a pinch, dropping what the first did', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const first: Gesture = { kind: 'ink', points: [0, 0] };
    const step = pointerDown(
      first,
      scene([]),
      down({ point: b, pointers: [a, b], touch: true }),
    );
    expect(step.gesture).toEqual({
      kind: 'pinch',
      start: VIEW,
      mid: { x: 50, y: 0 },
      distance: 100,
    });
    expect(types(step.effects)).toEqual(['cancel']);
  });

  it('ignores a third finger', () => {
    const pinch: Gesture = {
      kind: 'pinch',
      start: VIEW,
      mid: { x: 0, y: 0 },
      distance: 1,
    };
    const p = { x: 1, y: 1 };
    const step = pointerDown(pinch, scene([]), down({ pointers: [p, p, p] }));
    expect(step).toEqual({ gesture: pinch, effects: [] });
  });

  it('pans with the middle button or with Space held', () => {
    for (const d of [down({ button: 1 }), down({ spaceHeld: true })]) {
      const step = pointerDown(null, scene([]), d);
      expect(step.gesture).toEqual({ kind: 'pan', last: d.point });
      expect(types(step.effects)).toEqual([
        'focusSurface',
        'preventDefault',
        'panning',
      ]);
    }
  });

  it('starts a stroke, a rect or an arrow with a drawing tool', () => {
    const view = { x: 10, y: 20, zoom: 2 };
    const ink = pointerDown(null, scene([], [], view), down({ tool: 'ink' }));
    expect(ink.gesture).toEqual({ kind: 'ink', points: [260, 270] });
    expect(find(ink.effects, 'draft')?.draft).toEqual({
      kind: 'ink',
      points: [260, 270],
    });
    const rect = pointerDown(
      null,
      scene([], [], view),
      down({ tool: 'rect', shift: true }),
    );
    expect(rect.gesture).toMatchObject({
      kind: 'draw',
      tool: 'rect',
      screen: { x: 500, y: 500 },
      start: { x: 260, y: 270 },
      shift: true,
    });
  });

  it('erases the strokes under the eraser from the first touch', () => {
    const stroke = item('s', {
      kind: 'ink',
      w: 100,
      h: 0,
      points: [0, 0, 100, 0],
    });
    const step = pointerDown(
      null,
      scene([stroke]),
      down({ tool: 'eraser', point: { x: 50, y: 2 } }),
    );
    expect(step.gesture).toMatchObject({ kind: 'erase', ids: new Set(['s']) });
    expect(find(step.effects, 'erasing')?.ids).toEqual(new Set(['s']));
  });

  it('places a sticky or a text where the pointer lifts', () => {
    const step = pointerDown(null, scene([]), down({ tool: 'sticky' }));
    expect(step.gesture).toEqual({
      kind: 'place',
      tool: 'sticky',
      start: { x: 500, y: 500 },
    });
  });

  it('grabs the end of the selected arrow', () => {
    const arrow = item('a', {
      kind: 'arrow',
      x: 10,
      y: 10,
      points: [0, 0, 90, 0],
    });
    const step = pointerDown(
      null,
      scene([arrow], ['a']),
      down({ target: { handle: 'end', end: 'end' } }),
    );
    expect(step.gesture).toMatchObject({
      kind: 'end',
      id: 'a',
      which: 1,
      at: { x: 100, y: 10 },
    });
    expect(find(step.effects, 'endEdit')?.edit).toEqual({
      id: 'a',
      points: [0, 0, 90, 0],
    });
  });

  it('grabs a corner of the selected item', () => {
    const sticky = item('s', { x: 10, y: 20 });
    const step = pointerDown(
      null,
      scene([sticky], ['s']),
      down({ target: { handle: 'se' }, point: { x: 210, y: 220 } }),
    );
    expect(step.gesture).toMatchObject({
      kind: 'resize',
      id: 's',
      corner: 'se',
      start: { x: 210, y: 220 },
      origin: { x: 10, y: 20, w: 200, h: 200 },
    });
  });

  it('selects the item pressed and gets ready to move it', () => {
    const a = item('a');
    const b = item('b', { x: 300 });
    const step = pointerDown(
      null,
      scene([a, b], ['b']),
      down({ target: { item: 'a' } }),
    );
    expect(types(step.effects)).toEqual(['pressing', 'select', 'focusPressed']);
    expect(find(step.effects, 'select')?.ids).toEqual(['a']);
    expect(step.gesture).toMatchObject({
      kind: 'move',
      item: 'a',
      wasSelected: false,
      origins: new Map([['a', { x: 0, y: 0 }]]),
    });
  });

  it('moves the whole selection from any item in it', () => {
    const a = item('a');
    const b = item('b', { x: 300 });
    const step = pointerDown(
      null,
      scene([a, b], ['a', 'b']),
      down({ target: { item: 'b' } }),
    );
    expect(step.gesture).toMatchObject({ kind: 'move', wasSelected: true });
    expect(
      step.gesture?.kind === 'move' && [...step.gesture.origins.keys()],
    ).toEqual(['a', 'b']);
  });

  it('drops an item from the selection with Shift, and starts nothing', () => {
    const step = pointerDown(
      null,
      scene([item('a'), item('b')], ['a', 'b']),
      down({ target: { item: 'a' }, shift: true }),
    );
    expect(find(step.effects, 'select')?.ids).toEqual(['b']);
    expect(types(step.effects)).not.toContain('focusPressed');
    expect(step.gesture).toBeNull();
  });

  it('waits on a finger on empty board, for a pan or a long press', () => {
    const step = pointerDown(null, scene([]), down({ touch: true }));
    expect(step.gesture).toEqual({ kind: 'press', start: { x: 500, y: 500 } });
    expect(find(step.effects, 'longPress')).toEqual({
      type: 'longPress',
      start: true,
    });
  });

  it('draws a marquee from empty board with the mouse', () => {
    const step = pointerDown(null, scene([item('a')], ['a']), down());
    expect(step.gesture).toEqual({
      kind: 'marquee',
      start: { x: 500, y: 500 },
      base: [],
    });
    expect(find(step.effects, 'select')?.ids).toEqual([]);
    const shifted = pointerDown(
      null,
      scene([item('a')], ['a']),
      down({ shift: true }),
    );
    expect(shifted.gesture).toMatchObject({ base: ['a'] });
    expect(types(shifted.effects)).not.toContain('select');
  });
});

describe('a long press', () => {
  it('turns a resting finger into a marquee', () => {
    const step = longPress(
      { kind: 'press', start: { x: 40, y: 60 } },
      {
        x: 0,
        y: 0,
        zoom: 2,
      },
    );
    expect(step.gesture).toEqual({
      kind: 'marquee',
      start: { x: 20, y: 30 },
      base: [],
    });
    expect(types(step.effects)).toEqual(['select', 'marquee']);
  });

  it('does nothing once the finger has moved on', () => {
    const pan: Gesture = { kind: 'pan', last: { x: 0, y: 0 } };
    expect(longPress(pan, VIEW)).toEqual({ gesture: pan, effects: [] });
  });
});

describe('moving', () => {
  it('pans by how far the pointer went', () => {
    const step = pointerMove(
      { kind: 'pan', last: { x: 0, y: 0 } },
      scene([], [], { x: 0, y: 0, zoom: 2 }),
      move({ point: { x: 10, y: -20 } }),
    );
    expect(step.gesture).toEqual({ kind: 'pan', last: { x: 10, y: -20 } });
    expect(find(step.effects, 'view')?.view).toEqual({ x: -5, y: 10, zoom: 2 });
  });

  it('zooms a pinch around its middle', () => {
    const g: Gesture = {
      kind: 'pinch',
      start: VIEW,
      mid: { x: 50, y: 0 },
      distance: 100,
    };
    const step = pointerMove(
      g,
      scene([]),
      move({
        point: { x: 200, y: 0 },
        pointers: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
      }),
    );
    expect(find(step.effects, 'view')?.view.zoom).toBeCloseTo(2);
  });

  it('shows no draft until a draw passes the slop', () => {
    const g: Gesture = {
      kind: 'draw',
      tool: 'rect',
      screen: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      shift: false,
    };
    const near = pointerMove(
      g,
      scene([]),
      move({ point: { x: DRAG_SLOP, y: 0 } }),
    );
    expect(find(near.effects, 'draft')?.draft).toBeNull();
    const far = pointerMove(g, scene([]), move({ point: { x: 50, y: 30 } }));
    expect(find(far.effects, 'draft')?.draft).toEqual({
      kind: 'rect',
      box: { x: 0, y: 0, w: 50, h: 30 },
    });
    expect(far.gesture).toMatchObject({ end: { x: 50, y: 30 } });
  });

  it('holds an arrow to 45° steps with Shift', () => {
    const g: Gesture = {
      kind: 'draw',
      tool: 'arrow',
      screen: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      shift: false,
    };
    const step = pointerMove(
      g,
      scene([]),
      move({ point: { x: 100, y: 3 }, shift: true }),
    );
    const draft = find(step.effects, 'draft')?.draft;
    expect(draft?.kind === 'arrow' && draft.to.y).toBeCloseTo(0);
  });

  it('adds every coalesced sample to a stroke', () => {
    const step = pointerMove(
      { kind: 'ink', points: [0, 0] },
      scene([]),
      move({
        point: { x: 2, y: 2 },
        samples: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
    );
    expect(step.gesture).toEqual({ kind: 'ink', points: [0, 0, 1, 1, 2, 2] });
  });

  it('collects the strokes the eraser passes over', () => {
    const stroke = item('s', {
      kind: 'ink',
      x: 0,
      y: 100,
      w: 0,
      h: 100,
      points: [0, 0, 0, 100],
    });
    const g: Gesture = {
      kind: 'erase',
      last: { x: -50, y: 150 },
      ids: new Set(),
    };
    const step = pointerMove(
      g,
      scene([stroke]),
      move({ point: { x: 50, y: 150 } }),
    );
    expect(step.gesture).toMatchObject({ ids: new Set(['s']) });
    expect(find(step.effects, 'erasing')?.ids).toEqual(new Set(['s']));
    const again = pointerMove(
      step.gesture as Gesture,
      scene([stroke]),
      move({ point: { x: 60, y: 150 } }),
    );
    expect(again.effects).toEqual([]);
  });

  it('turns a press that moves into a pan', () => {
    const g: Gesture = { kind: 'press', start: { x: 0, y: 0 } };
    expect(pointerMove(g, scene([]), move({ point: { x: 2, y: 0 } }))).toEqual({
      gesture: g,
      effects: [],
    });
    const step = pointerMove(
      g,
      scene([]),
      move({ point: { x: 20, y: 0 }, before: { x: 2, y: 0 } }),
    );
    expect(step.gesture).toEqual({ kind: 'pan', last: { x: 20, y: 0 } });
    expect(types(step.effects)).toEqual(['longPress', 'view', 'panning']);
    expect(find(step.effects, 'view')?.view).toEqual({ x: -18, y: 0, zoom: 1 });
  });

  it('drags only past the slop, in board units', () => {
    const g: Gesture = {
      kind: 'move',
      start: { x: 0, y: 0 },
      origins: new Map([['a', { x: 0, y: 0 }]]),
      moved: false,
      dx: 0,
      dy: 0,
      item: 'a',
      wasSelected: false,
      shift: false,
    };
    const view = { x: 0, y: 0, zoom: 2 };
    expect(
      pointerMove(g, scene([], [], view), move({ point: { x: 3, y: 0 } }))
        .effects,
    ).toEqual([]);
    const step = pointerMove(
      g,
      scene([], [], view),
      move({ point: { x: 40, y: 20 } }),
    );
    expect(step.gesture).toMatchObject({ moved: true, dx: 20, dy: 10 });
    expect(find(step.effects, 'drag')?.drag).toMatchObject({ dx: 20, dy: 10 });
  });

  it('selects what a marquee touches, on top of the base', () => {
    const a = item('a', { x: 0, y: 0, w: 50, h: 50 });
    const b = item('b', { x: 500, y: 500, w: 50, h: 50 });
    const step = pointerMove(
      { kind: 'marquee', start: { x: -10, y: -10 }, base: ['b'] },
      scene([a, b]),
      move({ point: { x: 20, y: 20 } }),
    );
    expect(find(step.effects, 'marquee')?.box).toEqual({
      x: -10,
      y: -10,
      w: 30,
      h: 30,
    });
    expect(find(step.effects, 'select')?.ids).toEqual(['b', 'a']);
  });

  it('resizes from a corner, never below the smallest size', () => {
    const origin = { x: 0, y: 0, w: 200, h: 200 };
    const step = pointerMove(
      {
        kind: 'resize',
        id: 's',
        corner: 'se',
        start: { x: 200, y: 200 },
        origin,
        box: origin,
      },
      scene([]),
      move({ point: { x: -500, y: 300 } }),
    );
    expect(find(step.effects, 'resize')?.resize).toEqual({
      id: 's',
      box: { x: 0, y: 0, w: MIN_SIZE, h: 300 },
    });
  });
});

describe('lifting', () => {
  it('ends a pinch only when the last finger lifts', () => {
    const g: Gesture = {
      kind: 'pinch',
      start: VIEW,
      mid: { x: 0, y: 0 },
      distance: 1,
    };
    const p = { x: 0, y: 0 };
    expect(
      pointerUp(g, scene([]), up({ point: p, remaining: 1 })).gesture,
    ).toBe(g);
    expect(pointerUp(g, scene([]), up({ point: p })).gesture).toBeNull();
  });

  it('places a sticky where the pointer lifts', () => {
    const step = pointerUp(
      { kind: 'place', tool: 'sticky', start: { x: 0, y: 0 } },
      scene([], [], { x: 100, y: 0, zoom: 1 }),
      up({ point: { x: 10, y: 20 } }),
    );
    expect(step.gesture).toBeNull();
    expect(step.effects).toEqual([
      { type: 'create', kind: 'sticky', at: { x: 110, y: 20 } },
    ]);
  });

  it('places a rect on a click, adds one on a drag', () => {
    const g: Gesture = {
      kind: 'draw',
      tool: 'rect',
      screen: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      end: { x: 80, y: 40 },
      shift: false,
    };
    expect(
      pointerUp(g, scene([]), up({ point: { x: 1, y: 1 } })).effects,
    ).toEqual([
      { type: 'draft', draft: null },
      { type: 'create', kind: 'rect', at: { x: 0, y: 0 } },
    ]);
    expect(
      pointerUp(g, scene([]), up({ point: { x: 80, y: 40 } })).effects,
    ).toEqual([
      { type: 'draft', draft: null },
      {
        type: 'add',
        kind: 'rect',
        box: { x: 0, y: 0, w: 80, h: 40 },
        pick: true,
      },
    ]);
  });

  it('adds an arrow drawn, snapped to what its ends land on', () => {
    const sticky = item('s', { x: 100, y: -50, w: 100, h: 100 });
    const g: Gesture = {
      kind: 'draw',
      tool: 'arrow',
      screen: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      end: { x: 150, y: 0 },
      shift: false,
    };
    const step = pointerUp(g, scene([sticky]), up({ point: { x: 150, y: 0 } }));
    const add = find(step.effects, 'add');
    expect(add).toMatchObject({
      kind: 'arrow',
      pick: true,
      at: { x: 0, y: 0 },
    });
    expect(add?.points).toEqual([0, 0, 100, 0]);
    const click = pointerUp(g, scene([]), up({ point: { x: 1, y: 0 } }));
    expect(types(click.effects)).toEqual(['draft']);
  });

  it('adds the stroke drawn, simplified', () => {
    const step = pointerUp(
      { kind: 'ink', points: [0, 0, 50, 0, 100, 0] },
      scene([]),
      up({ point: { x: 100, y: 0 } }),
    );
    const add = find(step.effects, 'add');
    expect(add).toMatchObject({ kind: 'ink', pick: false });
    expect(add?.points).toEqual([0, 0, 100, 0]);
  });

  it('deletes the strokes erased, as one step', () => {
    const stroke = item('s', { kind: 'ink' });
    const step = pointerUp(
      { kind: 'erase', last: { x: 0, y: 0 }, ids: new Set(['s', 'gone']) },
      scene([stroke]),
      up({ point: { x: 0, y: 0 } }),
    );
    const run = find(step.effects, 'run');
    expect(run?.ops).toEqual([{ type: 'deleteBoardItems', ids: ['s'] }]);
    expect(run?.after).toEqual([
      { type: 'deselect', ids: new Set(['s', 'gone']) },
      { type: 'announce', text: 'Erased a drawing' },
    ]);
    const nothing = pointerUp(
      { kind: 'erase', last: { x: 0, y: 0 }, ids: new Set(['gone']) },
      scene([stroke]),
      up({ point: { x: 0, y: 0 } }),
    );
    expect(types(nothing.effects)).toEqual(['erasing']);
  });

  it('moves an arrow end, holding on to the edge it lands on', () => {
    const sticky = item('s', { x: 100, y: -50, w: 100, h: 100 });
    const arrow = item('a', { kind: 'arrow', points: [0, 0, 50, 0] });
    const step = pointerUp(
      { kind: 'end', id: 'a', which: 1, at: { x: 120, y: 0 }, shift: false },
      scene([sticky, arrow]),
      up({ point: { x: 0, y: 0 } }),
    );
    expect(step.effects).toEqual([
      { type: 'endEdit', edit: null },
      {
        type: 'run',
        ops: [
          { type: 'editBoardItem', id: 'a', patch: { points: [0, 0, 100, 0] } },
        ],
      },
    ]);
  });

  it('clears the selection on a tap on empty board', () => {
    const step = pointerUp(
      { kind: 'press', start: { x: 0, y: 0 } },
      scene([]),
      up({ point: { x: 0, y: 0 } }),
    );
    expect(step.effects).toEqual([
      { type: 'longPress', start: false },
      { type: 'select', ids: [] },
    ]);
  });

  const press = (overrides: Partial<Extract<Gesture, { kind: 'move' }>> = {}) =>
    ({
      kind: 'move',
      start: { x: 0, y: 0 },
      origins: new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 300, y: 0 }],
      ]),
      moved: false,
      dx: 0,
      dy: 0,
      item: 'a',
      wasSelected: true,
      shift: false,
      ...overrides,
    }) satisfies Gesture;

  it('moves what was dragged, to whole units', () => {
    const step = pointerUp(
      press({ moved: true, dx: 10.4, dy: -3.6 }),
      scene([item('a'), item('b', { x: 300 })]),
      up({ point: { x: 0, y: 0 } }),
    );
    expect(step.effects).toEqual([
      {
        type: 'moveTo',
        moves: [
          { id: 'a', x: 10, y: -4 },
          { id: 'b', x: 310, y: -4 },
        ],
      },
      { type: 'drag', drag: null },
    ]);
  });

  it('narrows to the item clicked, and opens it on a double click', () => {
    const s = scene([item('a'), item('b')]);
    const first = pointerUp(
      press(),
      s,
      up({ point: { x: 0, y: 0 }, now: 1000 }),
    );
    expect(first.effects).toEqual([
      { type: 'drag', drag: null },
      { type: 'select', ids: ['a'] },
    ]);
    expect(first.lastTap).toEqual({ id: 'a', at: 1000 });
    const second = pointerUp(
      press(),
      s,
      up({ point: { x: 0, y: 0 }, now: 1100, lastTap: first.lastTap }),
    );
    expect(find(second.effects, 'edit')).toEqual({ type: 'edit', id: 'a' });
    expect(second.lastTap).toBeNull();
    const slow = pointerUp(
      press(),
      s,
      up({
        point: { x: 0, y: 0 },
        now: 1000 + DOUBLE_TAP_MS,
        lastTap: first.lastTap,
      }),
    );
    expect(types(slow.effects)).not.toContain('edit');
    const shifted = pointerUp(
      press({ shift: true }),
      s,
      up({ point: { x: 0, y: 0 } }),
    );
    expect(types(shifted.effects)).toEqual(['drag']);
  });

  it('resizes as one step, with the item moved after its new size', () => {
    const sticky = item('s');
    const step = pointerUp(
      {
        kind: 'resize',
        id: 's',
        corner: 'nw',
        start: { x: 0, y: 0 },
        origin: { x: 0, y: 0, w: 200, h: 200 },
        box: { x: 50.4, y: 20, w: 149.6, h: 180 },
      },
      scene([sticky]),
      up({ point: { x: 0, y: 0 } }),
    );
    expect(step.effects).toEqual([
      { type: 'resize', resize: null },
      {
        type: 'run',
        ops: [
          { type: 'editBoardItem', id: 's', patch: { w: 150, h: 180 } },
          { type: 'moveBoardItems', moves: [{ id: 's', x: 50, y: 20 }] },
        ],
      },
    ]);
  });
});

describe('hit tests', () => {
  it('finds what a marquee touches', () => {
    const items = [
      item('a', { w: 10, h: 10 }),
      item('b', { x: 100, w: 10, h: 10 }),
    ];
    expect(hits(items, { x: 5, y: 5, w: 10, h: 10 })).toEqual(['a']);
  });

  it('finds strokes along the eraser’s whole path, not just its ends', () => {
    const stroke = item('s', {
      kind: 'ink',
      x: 50,
      y: 0,
      w: 0,
      h: 10,
      points: [0, 0, 0, 10],
    });
    expect(strokesNear([stroke], { x: 0, y: 5 }, { x: 100, y: 5 }, 1)).toEqual([
      's',
    ]);
    expect(
      strokesNear([stroke], { x: 0, y: 50 }, { x: 100, y: 50 }, 1),
    ).toEqual([]);
    expect(strokesNear([item('t')], { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toEqual(
      [],
    );
  });
});

describe('op builders', () => {
  it('moves an item and re-aims the arrows attached to it', () => {
    const sticky = item('s', { w: 100, h: 100 });
    const arrow = item('a', {
      kind: 'arrow',
      x: 100,
      y: 50,
      points: [0, 0, 100, 0],
    });
    const ops = moveOps([sticky, arrow], [{ id: 's', x: 20, y: 0 }]);
    expect(ops).toEqual([
      {
        type: 'moveBoardItems',
        moves: [{ id: 's', x: 20, y: 0 }, expect.objectContaining({ id: 'a' })],
      },
    ]);
    expect(moveOps([sticky], [{ id: 's', x: 0, y: 0 }])).toEqual([]);
  });

  it('nudges and recolors the selection', () => {
    const byId = new Map([
      ['a', item('a', { color: 'warn' })],
      ['b', item('b', { x: 10 })],
    ]);
    expect(nudgeMoves(byId, ['a', 'b', 'gone'], 5, -5)).toEqual([
      { id: 'a', x: 5, y: -5 },
      { id: 'b', x: 15, y: -5 },
    ]);
    expect(recolorOps(byId, ['a', 'b'], 'warn')).toEqual([
      { type: 'editBoardItem', id: 'b', patch: { color: 'warn' } },
    ]);
  });

  it('builds a new arrow from its tail', () => {
    expect(arrowBetween({ x: 10.2, y: 20 }, { x: 0, y: 60 })).toEqual({
      at: { x: 10, y: 20 },
      box: { x: 10, y: 20, w: 10.2, h: 40 },
      points: [0.2, 0, -10, 40],
    });
  });

  it('leaves an arrow end where it was as no op', () => {
    const arrow = item('a', { kind: 'arrow', points: [0, 0, 50, 0] });
    const ends = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ] as const;
    expect(endOps(arrow, ends, 1, { x: 50, y: 0 })).toEqual([]);
    expect(endOps(arrow, ends, 0, { x: 0, y: 10 })).toEqual([
      { type: 'editBoardItem', id: 'a', patch: { points: [0, 10, 50, 0] } },
    ]);
  });

  it('sends no resize for a box that did not change', () => {
    const sticky = item('s');
    expect(resizeOps([sticky], sticky, { x: 0, y: 0, w: 200, h: 200 })).toEqual(
      [],
    );
  });
});
