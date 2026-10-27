import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  itemsOf,
  nextZ,
  reaim,
  snapEnd,
  strokeOf,
} from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import {
  BOARD_COLORS,
  type BoardColor,
  type BoardItem,
  type BoardKind,
} from '#shared/types';
import { EditBar } from '@/components/board/EditBar';
import { ItemEditor } from '@/components/board/ItemEditor';
import {
  hasText,
  ItemShape,
  itemName,
  KIND_LABELS,
  MIN_SIZE,
  measureText,
  plainText,
  resizable,
  STICKY_SIZE,
  TEXT_FONT,
  TEXT_PAD,
} from '@/components/board/items';
import {
  draws,
  TOOL_INFO,
  TOOLS,
  type Tool,
  Toolbar,
} from '@/components/board/Toolbar';
import { useHistory } from '@/components/board/useHistory';
import {
  readViewport,
  useViewport,
  viewportKey,
} from '@/components/board/useViewport';
import {
  boxBetween,
  type Corner,
  centred,
  clampCoord,
  fitTo,
  gridStep,
  intersects,
  type Point,
  panBy,
  pinch,
  resizeBox,
  toBoard,
  union,
  type Viewport,
  viewBoxOf,
  visibleBox,
  wheelZoomFactor,
  zoomAt,
} from '@/components/board/viewport';
import { ZoomControls } from '@/components/board/ZoomControls';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { useSpaces } from '@/providers/DatapadProvider';
import { useToast } from '@/providers/ToastProvider';

/** How far a pointer moves before a press becomes a drag, in px. */
const DRAG_SLOP = 4;
/** How long a finger rests on empty board before it draws a marquee. */
const LONG_PRESS_MS = 450;
/** Two clicks or taps this close together are a double one. */
const DOUBLE_TAP_MS = 350;
/** A rectangle placed with a click (or Enter) rather than drawn. */
const RECT_SIZE = { w: 160, h: 100 };
/** How near the eraser must pass to a stroke, in screen px. */
const ERASER_REACH = 8;

type Gesture =
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
  | { kind: 'erase'; last: Point; ids: Set<string> }
  | { kind: 'end'; id: string; which: 0 | 1; at: Point; shift: boolean }
  | { kind: 'press'; start: Point; timer: number }
  | {
      kind: 'move';
      start: Point;
      origins: Map<string, Point>;
      moved: boolean;
      dx: number;
      dy: number;
      item: string;
      /** The pressed item was already selected (a click may narrow to it). */
      wasSelected: boolean;
      shift: boolean;
    }
  | { kind: 'marquee'; start: Point; base: string[] }
  | {
      kind: 'resize';
      id: string;
      corner: Corner;
      start: Point;
      origin: Box;
      box: Box;
    };

interface Drag {
  origins: Map<string, Point>;
  dx: number;
  dy: number;
}

/** What is being drawn, before it is an item. */
type Draft =
  | { kind: 'rect'; box: Box }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'ink'; points: number[] };

interface Editing {
  id: string;
  /** Made just now: an empty one is removed rather than kept. */
  fresh: boolean;
}

/**
 * A whiteboard: one `<svg>` whose `viewBox` is the viewport, the board's
 * items drawn in `z` order, the toolbar and the zoom controls. Every
 * change is an op through `useDatapad()`; a drag, a marquee and a resize
 * are local until the pointer comes up, then one op. Remote moves slide
 * in with a `transform` transition; the item being dragged keeps to the
 * pointer until it is dropped.
 */
export function Board({ boardId, label }: { boardId: string; label: string }) {
  const { state, actions } = useDatapad();
  const { current: space } = useSpaces();
  const { show } = useToast();
  const people = state?.people ?? {};
  const items = state ? itemsOf(state.boardItems, boardId) : NONE;
  const byId = useMemo(() => new Map(items.map((b) => [b.id, b])), [items]);

  const surface = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const { view, viewRef, setView } = useViewport(
    viewportKey(boardId, space.id),
  );

  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState<BoardColor>('warn');
  const [selectedRaw, setSelected] = useState<string[]>([]);
  // Another device may delete what is selected here.
  const selected = useMemo(
    () => selectedRaw.filter((id) => byId.has(id)),
    [selectedRaw, byId],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<{ id: string; box: Box } | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  spaceRef.current = spaceHeld;
  const [announcement, setAnnouncement] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Strokes the eraser has passed over, deleted when it lifts. */
  const [erasing, setErasing] = useState<ReadonlySet<string>>(NO_IDS);
  /** An arrow end being dragged: the arrow's points meanwhile. */
  const [endEdit, setEndEdit] = useState<{
    id: string;
    points: number[];
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  /** A press on an item focuses it; that focus must not reselect. */
  const pressing = useRef(false);
  const lastTap = useRef<{ id: string; at: number } | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  /* ---------- size and the first view ---------- */

  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s && s.w === r.width && s.h === r.height
          ? s
          : { w: r.width, h: r.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitBox = useCallback(
    () => union(itemsRef.current.map((b) => bounds(b))),
    [],
  );

  const loaded = state !== null;
  useEffect(() => {
    if (viewRef.current || !size || !loaded || size.w === 0) return;
    const box = fitBox();
    setView(
      readViewport(viewportKey(boardId, space.id)) ??
        (box ? fitTo(box, size.w, size.h) : centred(size.w, size.h)),
    );
  }, [size, loaded, boardId, space.id, setView, viewRef, fitBox]);

  /* ---------- helpers ---------- */

  const screenPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const r = svg.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  const center = useCallback(
    (): Point => ({ x: (size?.w ?? 0) / 2, y: (size?.h ?? 0) / 2 }),
    [size],
  );

  /** Where an item is drawn now: a drag or a resize in progress moves it. */
  const placed = useCallback(
    (item: BoardItem): Box => {
      if (resize?.id === item.id) return resize.box;
      const origin = drag?.origins.get(item.id);
      if (drag && origin) {
        return {
          x: origin.x + drag.dx,
          y: origin.y + drag.dy,
          w: item.w,
          h: item.h,
        };
      }
      return { x: item.x, y: item.y, w: item.w, h: item.h };
    },
    [drag, resize],
  );

  /**
   * Arrows drawn other than as stored: the ones attached to what is being
   * dragged or resized follow it, and an end being dragged moves.
   */
  const livePoints = useMemo(() => {
    const out = new Map<string, number[]>();
    if (drag || resize) {
      const boxes = new Map<string, Box>();
      if (resize) boxes.set(resize.id, resize.box);
      if (drag) {
        for (const [id, o] of drag.origins) {
          const item = byId.get(id);
          if (item) {
            boxes.set(id, {
              x: o.x + drag.dx,
              y: o.y + drag.dy,
              w: item.w,
              h: item.h,
            });
          }
        }
      }
      const moving = new Set(drag?.origins.keys() ?? []);
      for (const m of reaim(items, boxes, moving)) out.set(m.id, m.points);
    }
    if (endEdit) out.set(endEdit.id, endEdit.points);
    return out;
  }, [drag, resize, endEdit, items, byId]);

  const select = useCallback((ids: string[]) => {
    setSelected(ids);
  }, []);

  // The selection, read out (a live region): what it is, or how many.
  // Only a change of selection is announced, not every edit to it.
  const describe = useRef<(ids: string[]) => string>(() => '');
  describe.current = (ids) => {
    const [only] = ids;
    const item = only ? byId.get(only) : undefined;
    if (ids.length === 0) return 'Nothing selected';
    if (ids.length === 1 && item) return `Selected ${itemName(item, people)}`;
    return `${ids.length} items selected`;
  };
  const selection = selected.join(' ');
  const firstAnnounce = useRef(true);
  useEffect(() => {
    if (firstAnnounce.current) {
      firstAnnounce.current = false;
      return;
    }
    setAnnouncement(describe.current(selection ? selection.split(' ') : []));
  }, [selection]);

  /* ---------- ops ---------- */

  /** Ops as one op, or as batches (up to `batchMax` each). */
  const sendOps = useCallback(
    (ops: BaseOp[]) => {
      const [only] = ops;
      if (ops.length === 1 && only) {
        const { type, ...rest } = only;
        const action = actions[type] as (input: unknown) => unknown;
        return Boolean(action(rest));
      }
      let ok = true;
      for (let i = 0; i < ops.length; i += LIMITS.batchMax) {
        ok = actions.batch({ ops: ops.slice(i, i + LIMITS.batchMax) }) && ok;
      }
      return ok;
    },
    [actions],
  );

  const history = useHistory(stateRef, sendOps);
  const {
    run,
    clear: clearHistory,
    forgetLast,
    undo: undoStep,
    redo: redoStep,
    canUndo,
    canRedo,
  } = history;
  // Undo is for this board while it is open: another board starts afresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleared when the board changes
  useEffect(() => clearHistory(), [boardId, space.id, clearHistory]);

  /**
   * The moves for items going to new places, with the arrows attached to
   * them re-aimed, as `moveBoardItems` ops (up to `batchMax` moves each).
   * Arrows moving themselves keep their shape.
   */
  const moveOps = useCallback(
    (moves: BoardMove[], resized = new Map<string, Box>()): BaseOp[] => {
      const all = itemsRef.current;
      const boxes = new Map(resized);
      for (const m of moves) {
        const item = byId.get(m.id);
        if (item && !boxes.has(m.id)) {
          boxes.set(m.id, { x: m.x, y: m.y, w: item.w, h: item.h });
        }
      }
      const moving = new Set(moves.map((m) => m.id));
      const changed = [...moves, ...reaim(all, boxes, moving)].filter((m) => {
        const item = byId.get(m.id);
        return (
          item &&
          (item.x !== m.x ||
            item.y !== m.y ||
            (m.points !== undefined && m.points.join() !== item.points.join()))
        );
      });
      const ops: BaseOp[] = [];
      for (let i = 0; i < changed.length; i += LIMITS.batchMax) {
        ops.push({
          type: 'moveBoardItems',
          moves: changed.slice(i, i + LIMITS.batchMax),
        });
      }
      return ops;
    },
    [byId],
  );

  const moveTo = useCallback(
    (moves: BoardMove[]) => {
      const ops = moveOps(moves);
      if (ops.length > 0) run(ops);
    },
    [moveOps, run],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      moveTo(
        selectedRef.current.flatMap((id) => {
          const item = byId.get(id);
          return item
            ? [
                {
                  id,
                  x: clampCoord(item.x + dx),
                  y: clampCoord(item.y + dy),
                },
              ]
            : [];
        }),
      );
    },
    [byId, moveTo],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const gone = ids
        .map((id) => byId.get(id))
        .filter((b): b is BoardItem => Boolean(b));
      if (gone.length === 0) return;
      if (!run([{ type: 'deleteBoardItems', ids: gone.map((b) => b.id) }])) {
        return;
      }
      setSelected([]);
      const [first] = gone;
      show(
        gone.length === 1 && first
          ? `Deleted ${KIND_LABELS[first.kind].toLowerCase()}`
          : `Deleted ${gone.length} items`,
        () => {
          // A step of its own: ⌘Z after it deletes them again.
          run(gone.map((item) => ({ type: 'addBoardItem' as const, item })));
        },
      );
    },
    [byId, run, show],
  );

  /** To the top (`]`) or the bottom (`[`) of the board. */
  const restack = useCallback(
    (to: 'top' | 'bottom') => {
      const ids = selectedRef.current;
      if (ids.length === 0) return;
      run([
        {
          type: to === 'top' ? 'raiseBoardItems' : 'lowerBoardItems',
          ids,
        },
      ]);
      setAnnouncement(to === 'top' ? 'Brought to front' : 'Sent to back');
    },
    [run],
  );

  /**
   * After an undo or a redo: if it took away the item that had focus, the
   * board takes it, so the keys go on working.
   */
  const keepFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        surface.current?.focus({ preventScroll: true });
      }
    });
  }, []);
  const undo = useCallback(() => {
    if (undoStep()) setAnnouncement('Undone');
    keepFocus();
  }, [undoStep, keepFocus]);
  const redo = useCallback(() => {
    if (redoStep()) setAnnouncement('Redone');
    keepFocus();
  }, [redoStep, keepFocus]);

  const recolor = useCallback(
    (next: BoardColor) => {
      setColor(next);
      const ops: BaseOp[] = selectedRef.current.flatMap((id) => {
        const item = byId.get(id);
        return item && item.color !== next
          ? [{ type: 'editBoardItem' as const, id, patch: { color: next } }]
          : [];
      });
      if (ops.length > 0) run(ops);
    },
    [byId, run],
  );

  /** A focus waiting for the next frame; a new editor cancels it. */
  const focusFrame = useRef<number | undefined>(undefined);
  const focusItem = useCallback((id: string) => {
    if (focusFrame.current !== undefined) {
      cancelAnimationFrame(focusFrame.current);
    }
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined;
      const el = svg.current?.querySelector<SVGGElement>(
        `[data-item-id="${CSS.escape(id)}"]`,
      );
      if (el) {
        pressing.current = true;
        el.focus({ preventScroll: true });
        pressing.current = false;
      } else {
        surface.current?.focus({ preventScroll: true });
      }
    });
  }, []);

  /**
   * Adds an item of the current color on top of the board, as one step
   * undo takes back. Returns its id, or null when it was refused.
   */
  const addItem = useCallback(
    (
      kind: BoardKind,
      box: Box,
      points: number[] = [],
      at: Point = { x: box.x, y: box.y },
    ) => {
      const id = newId();
      const ok = run([
        {
          type: 'addBoardItem',
          item: {
            id,
            boardId,
            kind,
            x: clampCoord(at.x),
            y: clampCoord(at.y),
            w: Math.round(box.w),
            h: Math.round(box.h),
            z: nextZ(itemsRef.current),
            color,
            text: '',
            points,
          },
        },
      ]);
      return ok ? id : null;
    },
    [run, boardId, color],
  );

  const create = useCallback(
    (kind: Extract<BoardKind, 'sticky' | 'text' | 'rect'>, at: Point) => {
      const box =
        kind === 'sticky'
          ? {
              x: at.x - STICKY_SIZE / 2,
              y: at.y - STICKY_SIZE / 2,
              w: STICKY_SIZE,
              h: STICKY_SIZE,
            }
          : kind === 'rect'
            ? {
                x: at.x - RECT_SIZE.w / 2,
                y: at.y - RECT_SIZE.h / 2,
                ...RECT_SIZE,
              }
            : (() => {
                const m = measureText('');
                return {
                  x: at.x - TEXT_PAD,
                  y: at.y - TEXT_FONT / 2 - TEXT_PAD,
                  ...m,
                };
              })();
      const id = addItem(kind, box);
      if (!id) return;
      setTool('select');
      setSelected([id]);
      if (focusFrame.current !== undefined) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = undefined;
      }
      // A rect's label is optional: it is edited when asked for.
      if (kind === 'rect') focusItem(id);
      else setEditing({ id, fresh: true });
    },
    [addItem, focusItem],
  );

  const finishEdit = useCallback(
    (text: string | null) => {
      const current = editing;
      if (!current) return;
      setEditing(null);
      const item = byId.get(current.id);
      if (!item) return;
      const value = text ?? item.text;
      if (current.fresh && item.kind === 'text' && value.trim() === '') {
        // Free text with nothing in it is no item at all, nor a step.
        forgetLast((ops) =>
          ops.some(
            (op) => op.type === 'deleteBoardItems' && op.ids.includes(item.id),
          ),
        );
        actions.deleteBoardItems({ ids: [item.id] });
        setSelected([]);
        surface.current?.focus({ preventScroll: true });
        return;
      }
      if (text !== null && text !== item.text) {
        const patch: { text: string; w?: number; h?: number } = { text };
        if (item.kind === 'text') Object.assign(patch, measureText(text));
        run([{ type: 'editBoardItem', id: item.id, patch }]);
      }
      focusItem(item.id);
    },
    [editing, byId, actions, focusItem, forgetLast, run],
  );

  const startEdit = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (!item || !hasText(item.kind)) return;
      setSelected([id]);
      if (focusFrame.current !== undefined) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = undefined;
      }
      setEditing((e) => (e?.id === id ? e : { id, fresh: false }));
    },
    [byId],
  );

  const fit = useCallback(() => {
    if (!size) return;
    const box = fitBox();
    setView(box ? fitTo(box, size.w, size.h) : centred(size.w, size.h));
  }, [size, fitBox, setView]);

  const zoomBy = useCallback(
    (factor: number) => setView((v) => zoomAt(v, center(), v.zoom * factor)),
    [center, setView],
  );
  const zoomReset = useCallback(
    () => setView((v) => zoomAt(v, center(), 1)),
    [center, setView],
  );

  /* ---------- the wheel: pan, or zoom around the pointer ---------- */

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const at = screenPoint(e);
        setView((v) => zoomAt(v, at, v.zoom * wheelZoomFactor(dy)));
      } else if (e.shiftKey && dx === 0) {
        setView((v) => panBy(v, -dy, 0));
      } else {
        setView((v) => panBy(v, -dx, -dy));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [screenPoint, setView]);

  // Space held: the pointer pans. Let go anywhere and it stops.
  useEffect(() => {
    if (!spaceHeld) return;
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [spaceHeld]);

  /* ---------- pointers ---------- */

  const hits = useCallback((box: Box) => {
    return itemsRef.current
      .filter((b) => intersects(box, bounds(b)))
      .map((b) => b.id);
  }, []);

  const cancelGesture = useCallback(() => {
    const g = gesture.current;
    if (g?.kind === 'press') window.clearTimeout(g.timer);
    gesture.current = null;
    setDrag(null);
    setResize(null);
    setMarquee(null);
    setPanning(false);
    setDraft(null);
    setErasing(NO_IDS);
    setEndEdit(null);
  }, []);

  /** Ink strokes within reach of the eraser's path from `a` to `b`. */
  const strokesNear = useCallback((a: Point, b: Point, zoom: number) => {
    const reach = Math.max(HIT_TOLERANCE, ERASER_REACH / zoom);
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / reach),
    );
    const out: string[] = [];
    for (const item of itemsRef.current) {
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
  }, []);

  /** A rect or an arrow drawn: added, selected, and back to Select. */
  const finishDraw = (
    g: Extract<Gesture, { kind: 'draw' }>,
    screen: Point,
    v: Viewport,
  ) => {
    const dragged = Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y);
    let id: string | null = null;
    if (g.tool === 'rect') {
      if (dragged <= DRAG_SLOP) {
        create('rect', g.start);
        return;
      }
      const box = dragBox(g.start, g.end, g.shift);
      if (box.w < 1 || box.h < 1) return;
      id = addItem('rect', box);
    } else {
      if (dragged <= DRAG_SLOP) return;
      const items = itemsRef.current;
      const from = snapEnd(items, g.start);
      const to = snapEnd(
        items,
        g.shift ? constrainAngle(g.start, g.end) : g.end,
      );
      if (Math.hypot(to.x - from.x, to.y - from.y) < 2 / v.zoom) return;
      const origin = { x: clampCoord(from.x), y: clampCoord(from.y) };
      id = addItem(
        'arrow',
        {
          ...origin,
          w: Math.abs(to.x - from.x),
          h: Math.abs(to.y - from.y),
        },
        arrowPoints(origin, from, to),
        origin,
      );
    }
    if (!id) return;
    setTool('select');
    setSelected([id]);
    focusItem(id);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const v = viewRef.current;
    if (!v) return;
    const p = screenPoint(e);
    pointers.current.set(e.pointerId, p);
    svg.current?.setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 2) {
      // A second finger: whatever the first was doing becomes a pinch.
      cancelGesture();
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      gesture.current = {
        kind: 'pinch',
        start: v,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        distance: Math.hypot(a.x - b.x, a.y - b.y),
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const target = e.target as Element;
    const handle = target.closest<SVGElement>('[data-handle]');
    const itemEl = target.closest<SVGElement>('[data-item-id]');
    const id = itemEl?.dataset.itemId;
    if (!itemEl) {
      // The editor's blur saves it; the board takes focus for its keys.
      surface.current?.focus({ preventScroll: true });
    }

    if (e.button === 1 || spaceRef.current) {
      e.preventDefault();
      gesture.current = { kind: 'pan', last: p };
      setPanning(true);
      return;
    }
    if (draws(tool)) {
      // One finger (or the mouse) draws; a second finger turns it into a
      // pinch, and what was drawn so far is dropped.
      surface.current?.focus({ preventScroll: true });
      const at = toBoard(v, p);
      if (tool === 'ink') {
        gesture.current = { kind: 'ink', points: [at.x, at.y] };
        setDraft({ kind: 'ink', points: [at.x, at.y] });
      } else if (tool === 'eraser') {
        const ids = new Set(strokesNear(at, at, v.zoom));
        gesture.current = { kind: 'erase', last: at, ids };
        setErasing(ids);
      } else {
        gesture.current = {
          kind: 'draw',
          tool,
          screen: p,
          start: at,
          end: at,
          shift: e.shiftKey,
        };
      }
      return;
    }
    if (tool !== 'select') {
      gesture.current = { kind: 'place', tool, start: p };
      return;
    }
    const end = handle?.dataset.end;
    if (end) {
      const [only] = selectedRef.current;
      const arrow = only ? byId.get(only) : undefined;
      if (arrow?.kind === 'arrow') {
        const which = end === 'start' ? 0 : 1;
        gesture.current = {
          kind: 'end',
          id: arrow.id,
          which,
          at: arrowEnds(arrow)[which],
          shift: e.shiftKey,
        };
        setEndEdit({ id: arrow.id, points: arrow.points });
        return;
      }
    }
    if (handle) {
      const [only] = selectedRef.current;
      const item = only ? byId.get(only) : undefined;
      if (item) {
        gesture.current = {
          kind: 'resize',
          id: item.id,
          corner: handle.dataset.handle as Corner,
          start: toBoard(v, p),
          origin: { x: item.x, y: item.y, w: item.w, h: item.h },
          box: { x: item.x, y: item.y, w: item.w, h: item.h },
        };
        return;
      }
    }
    if (id && byId.has(id)) {
      pressing.current = true;
      const current = selectedRef.current;
      const wasSelected = current.includes(id);
      let next = current;
      if (e.shiftKey) {
        next = wasSelected ? current.filter((s) => s !== id) : [...current, id];
      } else if (!wasSelected) {
        next = [id];
      }
      select(next);
      if (!next.includes(id)) return;
      // The pressed item holds focus, so the keys go on from it.
      (itemEl as SVGGElement).focus({ preventScroll: true });
      const origins = new Map<string, Point>();
      for (const s of next) {
        const item = byId.get(s);
        if (item) origins.set(s, { x: item.x, y: item.y });
      }
      gesture.current = {
        kind: 'move',
        start: p,
        origins,
        moved: false,
        dx: 0,
        dy: 0,
        item: id,
        wasSelected,
        shift: e.shiftKey,
      };
      return;
    }
    if (e.pointerType === 'touch') {
      // One finger on empty board pans; resting a moment draws a marquee.
      const timer = window.setTimeout(() => {
        const g = gesture.current;
        if (g?.kind !== 'press') return;
        const start = toBoard(viewRef.current ?? v, g.start);
        gesture.current = { kind: 'marquee', start, base: [] };
        select([]);
        setMarquee({ ...start, w: 0, h: 0 });
      }, LONG_PRESS_MS);
      gesture.current = { kind: 'press', start: p, timer };
      return;
    }
    const base = e.shiftKey ? selectedRef.current : [];
    if (!e.shiftKey) select([]);
    const start = toBoard(v, p);
    gesture.current = { kind: 'marquee', start, base };
    setMarquee({ ...start, w: 0, h: 0 });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = screenPoint(e);
    const before = pointers.current.get(e.pointerId) ?? p;
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const v = viewRef.current;
    if (!g || !v) return;
    switch (g.kind) {
      case 'pinch': {
        const [a, b] = [...pointers.current.values()];
        if (!a || !b) return;
        setView(
          pinch(
            g.start,
            g.mid,
            g.distance,
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            Math.hypot(a.x - b.x, a.y - b.y),
          ),
        );
        return;
      }
      case 'pan':
        setView(panBy(v, p.x - g.last.x, p.y - g.last.y));
        gesture.current = { kind: 'pan', last: p };
        return;
      case 'draw': {
        g.end = toBoard(v, p);
        g.shift = e.shiftKey;
        if (Math.hypot(p.x - g.screen.x, p.y - g.screen.y) <= DRAG_SLOP) {
          setDraft(null);
          return;
        }
        setDraft(
          g.tool === 'rect'
            ? { kind: 'rect', box: dragBox(g.start, g.end, g.shift) }
            : {
                kind: 'arrow',
                from: g.start,
                to: g.shift ? constrainAngle(g.start, g.end) : g.end,
              },
        );
        return;
      }
      case 'ink': {
        // Every sample the browser coalesced, so a fast stroke stays smooth.
        const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const s of samples.length > 0 ? samples : [e.nativeEvent]) {
          const at = toBoard(v, screenPoint(s));
          g.points.push(at.x, at.y);
        }
        setDraft({ kind: 'ink', points: [...g.points] });
        return;
      }
      case 'erase': {
        const at = toBoard(v, p);
        const found = strokesNear(g.last, at, v.zoom).filter(
          (id) => !g.ids.has(id),
        );
        g.last = at;
        if (found.length > 0) {
          for (const id of found) g.ids.add(id);
          setErasing(new Set(g.ids));
        }
        return;
      }
      case 'end': {
        const arrow = byId.get(g.id);
        if (!arrow) return;
        const [a, b] = arrowEnds(arrow);
        const other = g.which === 0 ? b : a;
        let at = toBoard(v, p);
        if (e.shiftKey) at = constrainAngle(other, at);
        g.at = at;
        g.shift = e.shiftKey;
        setEndEdit({
          id: g.id,
          points:
            g.which === 0
              ? arrowPoints(arrow, at, b)
              : arrowPoints(arrow, a, at),
        });
        return;
      }
      case 'place':
      case 'press':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > DRAG_SLOP) {
          if (g.kind === 'press') window.clearTimeout(g.timer);
          setView(panBy(v, p.x - before.x, p.y - before.y));
          gesture.current = { kind: 'pan', last: p };
          setPanning(true);
        }
        return;
      case 'move': {
        const sx = p.x - g.start.x;
        const sy = p.y - g.start.y;
        if (!g.moved && Math.hypot(sx, sy) <= DRAG_SLOP) return;
        g.moved = true;
        g.dx = sx / v.zoom;
        g.dy = sy / v.zoom;
        setDrag({ origins: g.origins, dx: g.dx, dy: g.dy });
        return;
      }
      case 'marquee': {
        const box = boxBetween(g.start, toBoard(v, p));
        setMarquee(box);
        const inside = hits(box);
        select([...new Set([...g.base, ...inside])]);
        return;
      }
      case 'resize': {
        const at = toBoard(v, p);
        g.box = resizeBox(
          g.origin,
          g.corner,
          at.x - g.start.x,
          at.y - g.start.y,
          MIN_SIZE,
        );
        setResize({ id: g.id, box: g.box });
        return;
      }
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = pointers.current.get(e.pointerId) ?? screenPoint(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const v = viewRef.current;
    pressing.current = false;
    if (!g || !v) return;
    if (g.kind === 'pinch') {
      // The other finger lifting ends it too; it never turns into a drag.
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    switch (g.kind) {
      case 'pan':
        setPanning(false);
        return;
      case 'place':
        create(g.tool, toBoard(v, p));
        return;
      case 'draw':
        setDraft(null);
        finishDraw(g, p, v);
        return;
      case 'ink': {
        setDraft(null);
        // Simplified to within a screen pixel, and to `inkPointsMax` at most.
        const stroke = strokeOf(g.points, 1 / v.zoom, LIMITS.inkPointsMax);
        addItem('ink', stroke, stroke.points);
        return;
      }
      case 'erase':
        setErasing(NO_IDS);
        if (g.ids.size > 0) {
          const ids = [...g.ids].filter((id) => byId.has(id));
          if (ids.length > 0 && run([{ type: 'deleteBoardItems', ids }])) {
            setSelected((s) => s.filter((id) => !g.ids.has(id)));
            setAnnouncement(
              ids.length === 1
                ? 'Erased a drawing'
                : `Erased ${ids.length} drawings`,
            );
          }
        }
        return;
      case 'end': {
        setEndEdit(null);
        const arrow = byId.get(g.id);
        if (!arrow) return;
        const [a, b] = arrowEnds(arrow);
        // Dropped on a sticky or a rect, the end holds on to its edge.
        const at = snapEnd(itemsRef.current, g.at, arrow.id);
        const points =
          g.which === 0 ? arrowPoints(arrow, at, b) : arrowPoints(arrow, a, at);
        if (points.join() !== arrow.points.join()) {
          run([{ type: 'editBoardItem', id: arrow.id, patch: { points } }]);
        }
        return;
      }
      case 'press':
        window.clearTimeout(g.timer);
        select([]);
        return;
      case 'move': {
        if (g.moved) {
          moveTo(
            [...g.origins].map(([id, o]) => ({
              id,
              x: clampCoord(o.x + g.dx),
              y: clampCoord(o.y + g.dy),
            })),
          );
          setDrag(null);
          return;
        }
        setDrag(null);
        // A click on one of several selected narrows to it.
        if (g.wasSelected && !g.shift) select([g.item]);
        // A double click (or two taps) on a sticky or text opens its
        // editor. Counted here, not from `dblclick`: the board holds the
        // pointer, so the click events land on it, not on the item.
        {
          const now = performance.now();
          const last = lastTap.current;
          if (last && last.id === g.item && now - last.at < DOUBLE_TAP_MS) {
            lastTap.current = null;
            startEdit(g.item);
          } else {
            lastTap.current = { id: g.item, at: now };
          }
        }
        return;
      }
      case 'marquee':
        setMarquee(null);
        return;
      case 'resize': {
        const { box } = g;
        setResize(null);
        const item = byId.get(g.id);
        if (!item) return;
        const x = clampCoord(box.x);
        const y = clampCoord(box.y);
        const w = Math.round(box.w);
        const h = Math.round(box.h);
        const ops: BaseOp[] = [];
        if (w !== item.w || h !== item.h) {
          ops.push({ type: 'editBoardItem', id: item.id, patch: { w, h } });
        }
        // Its own move and its arrows' re-aiming, after the new size.
        ops.push(
          ...moveOps(
            [{ id: item.id, x, y }],
            new Map([[item.id, { x, y, w, h }]]),
          ),
        );
        if (ops.length > 0) run(ops);
        return;
      }
    }
  };

  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    pressing.current = false;
    cancelGesture();
  };

  /* ---------- keys ---------- */

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || editing) return;
    const target = e.target as Element;
    if (target.closest('textarea, input')) return;
    const onBoard = surface.current?.contains(target) ?? false;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'a' && onBoard) {
      e.preventDefault();
      select(itemsRef.current.map((b) => b.id));
      return;
    }
    // ⌘Z undoes, ⇧⌘Z (or Ctrl+Y) redoes: this board's steps only.
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod || e.altKey) return;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const toolKey = TOOLS.find((t) => TOOL_INFO[t].key.toLowerCase() === lower);
    if (toolKey && !e.shiftKey) {
      e.preventDefault();
      setTool(toolKey);
      return;
    }
    const digit = Number(key);
    if (key.length === 1 && digit >= 1 && digit <= BOARD_COLORS.length) {
      const next = BOARD_COLORS[digit - 1];
      if (next) {
        e.preventDefault();
        recolor(next);
      }
      return;
    }
    if ((key === ']' || key === '[') && selectedRef.current.length > 0) {
      e.preventDefault();
      restack(key === ']' ? 'top' : 'bottom');
      return;
    }
    if (key === 'Escape') {
      if (tool !== 'select') {
        e.preventDefault();
        setTool('select');
      } else if (selectedRef.current.length > 0) {
        e.preventDefault();
        select([]);
        surface.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (!onBoard) return;
    if (key === ' ') {
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
      return;
    }
    if (
      (key === 'Delete' || key === 'Backspace') &&
      selectedRef.current.length > 0
    ) {
      e.preventDefault();
      remove(selectedRef.current);
      surface.current?.focus({ preventScroll: true });
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[key];
    if (arrow && selectedRef.current.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudge(arrow[0] * step, arrow[1] * step);
      return;
    }
    if (key === 'Enter') {
      if (tool === 'sticky' || tool === 'text' || tool === 'rect') {
        e.preventDefault();
        const v = viewRef.current;
        if (v) create(tool, toBoard(v, center()));
        return;
      }
      const [only] = selectedRef.current;
      if (selectedRef.current.length === 1 && only) {
        e.preventDefault();
        startEdit(only);
      }
    }
  };

  const onItemFocus = (item: BoardItem) => {
    if (pressing.current) return;
    if (!selectedRef.current.includes(item.id)) select([item.id]);
    // Tabbed to something off screen: bring it into view.
    const v = viewRef.current;
    if (!v || !size) return;
    const box = bounds(item);
    if (!intersects(visibleBox(v, size.w, size.h), box)) {
      setView({
        ...v,
        x: box.x + box.w / 2 - size.w / (2 * v.zoom),
        y: box.y + box.h / 2 - size.h / (2 * v.zoom),
      });
    }
  };

  /* ---------- drawing ---------- */

  const gridId = `board-grid-${useId().replace(/[^\w-]/g, '')}`;
  const step = view ? gridStep(view.zoom) : 20;
  const dot = view ? 1.25 / view.zoom : 1;
  const visible = view && size ? visibleBox(view, size.w, size.h) : null;

  const single =
    selected.length === 1 && selected[0] ? byId.get(selected[0]) : undefined;
  const handleBox =
    single && resizable(single.kind) && !editing ? placed(single) : null;
  const editingItem = editing ? byId.get(editing.id) : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the board's keys, from the toolbar and the application region alike
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
    >
      <div
        ref={surface}
        role="application"
        aria-label={label}
        aria-describedby={`${gridId}-help`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: an application region takes focus for its keys
        tabIndex={0}
        data-tool={tool}
        data-panning={panning || undefined}
        data-pan-ready={(spaceHeld && !panning) || undefined}
        className="board-surface relative min-h-0 flex-1 overflow-clip bg-background outline-ring/50 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <p id={`${gridId}-help`} className="sr-only">
          V selects, S adds a sticky note, T adds text, R draws a rectangle, A
          an arrow, P draws freehand and E erases; 1 to 5 pick a color. Tab
          moves between items; arrow keys move the selection, Enter edits it,
          Delete removes it, ] brings it to the front and [ sends it to the
          back. Command Z undoes and Shift Command Z redoes.
        </p>
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: the region is named; its items carry their own names */}
        <svg
          ref={svg}
          className="absolute inset-0 size-full"
          viewBox={view && size ? viewBoxOf(view, size.w, size.h) : '0 0 1 1'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={(e) => {
            if (gesture.current) e.preventDefault();
          }}
        >
          <defs>
            <pattern
              id={gridId}
              patternUnits="userSpaceOnUse"
              width={step}
              height={step}
            >
              <circle
                cx={step / 2}
                cy={step / 2}
                r={dot}
                className="fill-muted-foreground/40"
              />
            </pattern>
          </defs>
          {visible && (
            <rect
              x={visible.x - step}
              y={visible.y - step}
              width={visible.w + 2 * step}
              height={visible.h + 2 * step}
              fill={`url(#${gridId})`}
              aria-hidden
            />
          )}
          {view &&
            items.map((stored) => {
              const points = livePoints.get(stored.id);
              const item = points ? { ...stored, points } : stored;
              const box = placed(item);
              const isSelected = selected.includes(item.id);
              const moving = Boolean(
                drag?.origins.has(item.id) || resize?.id === item.id || points,
              );
              const local = bounds({ ...item, x: 0, y: 0, w: box.w, h: box.h });
              const pad = 4 / view.zoom;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG item cannot be a <button>
                <g
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={itemName(item, people)}
                  data-item-id={item.id}
                  data-color={item.color}
                  data-kind={item.kind}
                  data-selected={isSelected || undefined}
                  data-dragging={moving || undefined}
                  data-erasing={erasing.has(item.id) || undefined}
                  className="board-item"
                  style={{ transform: `translate(${box.x}px, ${box.y}px)` }}
                  onFocus={() => onItemFocus(item)}
                >
                  <rect
                    className="board-ring"
                    x={local.x - pad}
                    y={local.y - pad}
                    width={local.w + 2 * pad}
                    height={local.h + 2 * pad}
                  />
                  <ItemShape
                    item={item}
                    box={box}
                    text={
                      editing?.id === item.id
                        ? ''
                        : plainText(item.text, people)
                    }
                  />
                </g>
              );
            })}
          {view && handleBox && <Handles box={handleBox} zoom={view.zoom} />}
          {view && single?.kind === 'arrow' && !editing && (
            <EndHandles
              arrow={{
                ...single,
                points: livePoints.get(single.id) ?? single.points,
              }}
              zoom={view.zoom}
            />
          )}
          {draft && <DraftShape draft={draft} color={color} />}
          {marquee && (
            <rect
              className="board-marquee"
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
            />
          )}
          {editingItem && view && (
            <ItemEditor
              key={editingItem.id}
              item={editingItem}
              box={placed(editingItem)}
              onDone={finishEdit}
            />
          )}
        </svg>
      </div>
      <Toolbar
        tool={tool}
        onTool={(t) => {
          setTool(t);
        }}
        color={color}
        onColor={recolor}
      />
      <EditBar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        selected={selected.length}
        onFront={() => restack('top')}
        onBack={() => restack('bottom')}
        onDelete={() => remove(selectedRef.current)}
      />
      {view && (
        <ZoomControls
          zoom={view.zoom}
          onZoomIn={() => zoomBy(1.25)}
          onZoomOut={() => zoomBy(1 / 1.25)}
          onReset={zoomReset}
          onFit={fit}
        />
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

const NONE: readonly BoardItem[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

/** An arrow's two ends, to drag: 10px circles, 44px to a finger. */
function EndHandles({ arrow, zoom }: { arrow: BoardItem; zoom: number }) {
  const size = 5 / zoom;
  const reach = 22 / zoom;
  return (
    <g aria-hidden>
      {arrowEnds(arrow).map((p, i) => (
        <g
          key={i === 0 ? 'start' : 'end'}
          data-handle="end"
          data-end={i === 0 ? 'start' : 'end'}
          style={{ cursor: 'move' }}
        >
          <circle cx={p.x} cy={p.y} r={reach} fill="transparent" />
          <circle className="board-handle" cx={p.x} cy={p.y} r={size} />
        </g>
      ))}
    </g>
  );
}

/** What is being drawn, in the current color, before it is an item. */
function DraftShape({ draft, color }: { draft: Draft; color: BoardColor }) {
  const item: BoardItem =
    draft.kind === 'rect'
      ? {
          ...DRAFT,
          kind: 'rect',
          x: draft.box.x,
          y: draft.box.y,
          w: draft.box.w,
          h: draft.box.h,
          color,
        }
      : draft.kind === 'arrow'
        ? {
            ...DRAFT,
            kind: 'arrow',
            x: draft.from.x,
            y: draft.from.y,
            color,
            points: arrowPoints(draft.from, draft.from, draft.to),
          }
        : { ...DRAFT, kind: 'ink', color, points: draft.points };
  return (
    <g
      aria-hidden
      className="board-item board-draft"
      data-color={color}
      data-kind={item.kind}
      style={{ transform: `translate(${item.x}px, ${item.y}px)` }}
    >
      <ItemShape item={item} box={item} text="" />
    </g>
  );
}

const DRAFT: BoardItem = {
  id: 'draft',
  boardId: '',
  kind: 'rect',
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  z: 0,
  color: 'neutral',
  text: '',
  points: [],
};

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/** The corner handles: 10px squares, 44px to a finger. */
function Handles({ box, zoom }: { box: Box; zoom: number }) {
  const size = 10 / zoom;
  const reach = 44 / zoom;
  return (
    <g aria-hidden>
      {CORNERS.map((corner) => {
        const x = corner.endsWith('w') ? box.x : box.x + box.w;
        const y = corner.startsWith('n') ? box.y : box.y + box.h;
        const cursor =
          corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
        return (
          <g key={corner} data-handle={corner} style={{ cursor }}>
            <rect
              x={x - reach / 2}
              y={y - reach / 2}
              width={reach}
              height={reach}
              fill="transparent"
            />
            <rect
              className="board-handle"
              x={x - size / 2}
              y={y - size / 2}
              width={size}
              height={size}
            />
          </g>
        );
      })}
    </g>
  );
}
