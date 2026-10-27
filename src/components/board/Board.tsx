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
import { type Box, bounds, itemsOf, nextZ } from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import {
  BOARD_COLORS,
  type BoardColor,
  type BoardItem,
  type BoardKind,
} from '#shared/types';
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
import { TOOLS, type Tool, Toolbar } from '@/components/board/Toolbar';
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

type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'pinch'; start: Viewport; mid: Point; distance: number }
  | { kind: 'place'; tool: Exclude<Tool, 'select'>; start: Point }
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

  const moveTo = useCallback(
    (moves: { id: string; x: number; y: number }[]) => {
      const changed = moves.filter((m) => {
        const item = byId.get(m.id);
        return item && (item.x !== m.x || item.y !== m.y);
      });
      if (changed.length === 0) return;
      for (let i = 0; i < changed.length; i += LIMITS.batchMax) {
        actions.moveBoardItems({
          moves: changed.slice(i, i + LIMITS.batchMax),
        });
      }
    },
    [actions, byId],
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
      if (!actions.deleteBoardItems({ ids: gone.map((b) => b.id) })) return;
      setSelected([]);
      const [first] = gone;
      show(
        gone.length === 1 && first
          ? `Deleted ${KIND_LABELS[first.kind].toLowerCase()}`
          : `Deleted ${gone.length} items`,
        () => {
          sendOps(
            gone.map((item) => ({ type: 'addBoardItem' as const, item })),
          );
        },
      );
    },
    [actions, byId, sendOps, show],
  );

  const recolor = useCallback(
    (next: BoardColor) => {
      setColor(next);
      const ops: BaseOp[] = selectedRef.current.flatMap((id) => {
        const item = byId.get(id);
        return item && item.color !== next
          ? [{ type: 'editBoardItem' as const, id, patch: { color: next } }]
          : [];
      });
      if (ops.length > 0) sendOps(ops);
    },
    [byId, sendOps],
  );

  const create = useCallback(
    (kind: Extract<BoardKind, 'sticky' | 'text'>, at: Point) => {
      const id = newId();
      const box =
        kind === 'sticky'
          ? {
              x: at.x - STICKY_SIZE / 2,
              y: at.y - STICKY_SIZE / 2,
              w: STICKY_SIZE,
              h: STICKY_SIZE,
            }
          : (() => {
              const m = measureText('');
              return {
                x: at.x - TEXT_PAD,
                y: at.y - TEXT_FONT / 2 - TEXT_PAD,
                ...m,
              };
            })();
      const ok = actions.addBoardItem({
        item: {
          id,
          boardId,
          kind,
          x: clampCoord(box.x),
          y: clampCoord(box.y),
          w: box.w,
          h: box.h,
          z: nextZ(itemsRef.current),
          color,
          text: '',
          points: [],
        },
      });
      if (!ok) return;
      setTool('select');
      setSelected([id]);
      if (focusFrame.current !== undefined) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = undefined;
      }
      setEditing({ id, fresh: true });
    },
    [actions, boardId, color],
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

  const finishEdit = useCallback(
    (text: string | null) => {
      const current = editing;
      if (!current) return;
      setEditing(null);
      const item = byId.get(current.id);
      if (!item) return;
      const value = text ?? item.text;
      if (current.fresh && item.kind === 'text' && value.trim() === '') {
        // Free text with nothing in it is no item at all.
        actions.deleteBoardItems({ ids: [item.id] });
        setSelected([]);
        surface.current?.focus({ preventScroll: true });
        return;
      }
      if (text !== null && text !== item.text) {
        const patch: { text: string; w?: number; h?: number } = { text };
        if (item.kind === 'text') Object.assign(patch, measureText(text));
        actions.editBoardItem({ id: item.id, patch });
      }
      focusItem(item.id);
    },
    [editing, byId, actions, focusItem],
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
  }, []);

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
    if (tool !== 'select') {
      gesture.current = { kind: 'place', tool, start: p };
      return;
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
        if (x !== item.x || y !== item.y) {
          ops.push({ type: 'moveBoardItems', moves: [{ id: item.id, x, y }] });
        }
        if (w !== item.w || h !== item.h) {
          ops.push({ type: 'editBoardItem', id: item.id, patch: { w, h } });
        }
        if (ops.length > 0) sendOps(ops);
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
    if (mod || e.altKey) return;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const toolKey = TOOLS.find(
      (t) => (t === 'select' ? 'v' : t === 'sticky' ? 's' : 't') === lower,
    );
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
      if (tool === 'sticky' || tool === 'text') {
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
          V selects, S adds a sticky note, T adds text, 1 to 5 pick a color. Tab
          moves between items; arrow keys move the selection, Enter edits it,
          Delete removes it.
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
            items.map((item) => {
              const box = placed(item);
              const isSelected = selected.includes(item.id);
              const moving = Boolean(
                drag?.origins.has(item.id) || resize?.id === item.id,
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
