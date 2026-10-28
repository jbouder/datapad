import {
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
  connect,
  growBox,
  itemsOf,
  nextZ,
  reaim,
} from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import type { BoardColor, BoardItem, BoardKind } from '#shared/types';
import { EditBar } from '@/components/board/EditBar';
import type { Draft } from '@/components/board/gesture';
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
import { moveOps, nudgeMoves, recolorOps } from '@/components/board/ops';
import { type Tool, Toolbar } from '@/components/board/Toolbar';
import { useBoardGestures } from '@/components/board/useBoardGestures';
import { useBoardKeys } from '@/components/board/useBoardKeys';
import { useHistory } from '@/components/board/useHistory';
import {
  readViewport,
  useViewport,
  viewportKey,
} from '@/components/board/useViewport';
import {
  type Corner,
  centred,
  centreOn,
  clampCoord,
  fitTo,
  gridStep,
  intersects,
  type Point,
  panBy,
  union,
  viewBoxOf,
  visibleBox,
  wheelZoomFactor,
  ZOOM_STEP,
  zoomAt,
} from '@/components/board/viewport';
import { ZoomControls } from '@/components/board/ZoomControls';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { BOARD_ITEM_PARAM, setQuery, useQuery } from '@/lib/router';
import { useSpaces } from '@/providers/DatapadProvider';
import { useToast } from '@/providers/ToastProvider';

/** A rectangle placed with a click (or Enter) rather than drawn. */
const RECT_SIZE = { w: 160, h: 100 };

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
 * pointer until it is dropped. The pointers are `useBoardGestures` (over
 * the pure `gesture.ts`), the keys `useBoardKeys`.
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
  const [editing, setEditing] = useState<Editing | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  spaceRef.current = spaceHeld;
  const [announcement, setAnnouncement] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;

  /** A press on an item focuses it; that focus must not reselect. */
  const pressing = useRef(false);

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
    if (ids.length === 1 && item?.kind === 'arrow') {
      return 'Selected Arrow. Enter re-aims its head, Shift Enter its tail';
    }
    if (ids.length === 1 && item) return `Selected ${itemName(item, people)}`;
    return `${ids.length} items selected`;
  };
  /**
   * Said in place of the next selection's description, when what changed
   * the selection says more (an undo, a new item). A key or a press
   * forgets it.
   */
  const queued = useRef<string | null>(null);
  const announce = useCallback((text: string) => {
    queued.current = text;
    setAnnouncement(text);
  }, []);
  const selection = selected.join(' ');
  const firstAnnounce = useRef(true);
  useEffect(() => {
    if (firstAnnounce.current) {
      firstAnnounce.current = false;
      return;
    }
    setAnnouncement(
      queued.current ?? describe.current(selection ? selection.split(' ') : []),
    );
    queued.current = null;
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

  const moveTo = useCallback(
    (moves: BoardMove[]) => {
      const ops = moveOps(itemsRef.current, moves);
      if (ops.length > 0) run(ops);
    },
    [run],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      moveTo(nudgeMoves(byId, selectedRef.current, dx, dy));
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
    if (undoStep()) announce('Undone');
    keepFocus();
  }, [undoStep, keepFocus, announce]);
  const redo = useCallback(() => {
    if (redoStep()) announce('Redone');
    keepFocus();
  }, [redoStep, keepFocus, announce]);

  const recolor = useCallback(
    (next: BoardColor) => {
      setColor(next);
      const ops = recolorOps(byId, selectedRef.current, next);
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

  /**
   * A sticky, a text or a rect, centred on `at`, selected and (for a
   * sticky or text, or anything placed from the keyboard: `write`) open
   * to type in.
   */
  const create = useCallback(
    (
      kind: Extract<BoardKind, 'sticky' | 'text' | 'rect'>,
      at: Point,
      write = false,
    ) => {
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
      announce(`Added ${KIND_LABELS[kind].toLowerCase()}`);
      setSelected([id]);
      if (focusFrame.current !== undefined) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = undefined;
      }
      // A rect's label is optional: a click leaves it to be asked for.
      if (kind === 'rect' && !write) focusItem(id);
      else setEditing({ id, fresh: true });
    },
    [addItem, focusItem, announce],
  );

  /**
   * Alt+arrows: the selected stickies, texts and rects `dw` wider and
   * `dh` taller (their top-left stays), with the arrows on them
   * following, as one step.
   */
  const resizeBy = useCallback(
    (dw: number, dh: number) => {
      const resized = new Map<string, Box>();
      const ops: BaseOp[] = [];
      let any = false;
      for (const id of selectedRef.current) {
        const item = byId.get(id);
        if (!item || !resizable(item.kind)) continue;
        any = true;
        const box = growBox(item, dw, dh, MIN_SIZE);
        if (box.w === item.w && box.h === item.h) continue;
        resized.set(id, box);
        ops.push({
          type: 'editBoardItem',
          id,
          patch: { w: box.w, h: box.h },
        });
      }
      if (!any) {
        setAnnouncement('Only sticky notes, text and rectangles resize');
        return;
      }
      if (ops.length === 0) {
        setAnnouncement('As small as it goes');
        return;
      }
      ops.push(
        ...moveOps(
          itemsRef.current,
          [...resized].map(([id, b]) => ({ id, x: b.x, y: b.y })),
          resized,
        ),
      );
      if (!run(ops)) return;
      const [only] = [...resized.values()];
      setAnnouncement(
        resized.size === 1 && only
          ? `${only.w} wide, ${only.h} high`
          : `Resized ${resized.size} items`,
      );
    },
    [byId, run],
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

  /*
   * `?item=<id>` (a ⌘K result): once the board has its first view, select
   * that item, centre it and give it focus, then drop the key so moving
   * on does not snap back. An id that is no longer there just opens the
   * board.
   */
  const target = useQuery().get(BOARD_ITEM_PARAM);
  const hasView = view !== null;
  useEffect(() => {
    if (!target || !loaded || !size || !hasView) return;
    const item = byId.get(target);
    setQuery({ [BOARD_ITEM_PARAM]: null }, { replace: true });
    if (!item) return;
    setView((v) => centreOn(v, bounds(item), size.w, size.h));
    setSelected([item.id]);
    focusItem(item.id);
  }, [target, loaded, size, hasView, byId, setView, focusItem]);

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

  /* ---------- keys and pointers ---------- */

  const { mode, modeRef, cancelMode, onKeyDown } = useBoardKeys({
    surface,
    svg,
    viewRef,
    center,
    itemsRef,
    byId,
    people,
    selectedRef,
    select,
    editing: editing !== null,
    tool,
    setTool,
    setSpaceHeld,
    queued,
    setAnnouncement,
    announce,
    create,
    addItem,
    startEdit,
    focusItem,
    run,
    nudge,
    resizeBy,
    recolor,
    restack,
    remove,
    undo,
    redo,
  });

  const { drag, resize, marquee, panning, draft, erasing, endEdit, handlers } =
    useBoardGestures({
      svg,
      surface,
      viewRef,
      setView,
      tool,
      spaceRef,
      itemsRef,
      byId,
      selectedRef,
      setSelected,
      pressing,
      screenPoint,
      onPress: () => {
        queued.current = null;
        if (modeRef.current) cancelMode(false);
      },
      setTool,
      setAnnouncement,
      create,
      addItem,
      run,
      moveTo,
      startEdit,
      focusItem,
    });

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
    if (mode?.kind === 'aim') {
      const arrow = byId.get(mode.id);
      if (arrow) {
        const [a, b] = arrowEnds(arrow);
        out.set(
          arrow.id,
          mode.which === 0
            ? arrowPoints(arrow, mode.at, b)
            : arrowPoints(arrow, a, mode.at),
        );
      }
    }
    return out;
  }, [drag, resize, endEdit, mode, items, byId]);

  const onItemFocus = (item: BoardItem) => {
    if (pressing.current) return;
    // Picking where a keyboard arrow goes leaves the selection alone.
    if (!modeRef.current && !selectedRef.current.includes(item.id)) {
      select([item.id]);
    }
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
  const connectFrom =
    mode?.kind === 'connect' ? byId.get(mode.from) : undefined;
  const connectTo =
    mode?.kind === 'connect' && mode.to ? byId.get(mode.to) : undefined;
  const connectLine =
    connectFrom && connectTo ? connect(connectFrom, connectTo) : null;
  const hint =
    mode?.kind === 'connect'
      ? connectTo
        ? 'Enter draws the arrow · Tab picks another · Esc cancels'
        : 'Tab to the item the arrow points to · Esc cancels'
      : mode?.kind === 'aim'
        ? `Re-aiming the ${mode.which === 1 ? 'head' : 'tail'}: Tab picks an item, arrow keys move it · Enter confirms · Esc cancels`
        : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the board's keys, from the toolbar and the application region alike
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Focus gone from the board: aiming an arrow ends, nothing drawn.
        const next = e.relatedTarget as Node | null;
        if (modeRef.current && !e.currentTarget.contains(next)) {
          cancelMode(false);
        }
      }}
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
          an arrow, P draws freehand and E erases; with S, T or R picked, Enter
          places one in the middle of the view. 1 to 5 pick a color. Tab moves
          between items; arrow keys move the selection, Alt with the arrow keys
          resizes it, Enter edits it, Delete removes it, ] brings it to the
          front and [ sends it to the back. With A picked, Enter draws an arrow
          from the selected item to the one you Tab to; on a selected arrow,
          Enter re-aims its head and Shift Enter its tail. Command Z undoes and
          Shift Command Z redoes.
        </p>
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: the region is named; its items carry their own names */}
        <svg
          ref={svg}
          className="absolute inset-0 size-full"
          viewBox={view && size ? viewBoxOf(view, size.w, size.h) : '0 0 1 1'}
          {...handlers}
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
                  data-target={
                    (mode?.to !== undefined && mode.to === item.id) || undefined
                  }
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
          {connectLine && (
            <DraftShape
              draft={{
                kind: 'arrow',
                from: connectLine[0],
                to: connectLine[1],
              }}
              color={color}
            />
          )}
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
      {hint && (
        // Shown for the eye; the live region below reads it out.
        <p
          aria-hidden
          data-board-hint
          className="pointer-events-none absolute inset-x-4 top-15 z-10 mx-auto w-fit max-w-md border bg-background/95 px-3 py-1.5 text-center text-sm shadow-sm desk:top-3"
        >
          {hint}
        </p>
      )}
      <Toolbar
        tool={tool}
        onTool={(t) => {
          if (modeRef.current) cancelMode(false);
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
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
          onReset={zoomReset}
          onFit={fit}
        />
      )}
      <p role="status" data-board-status className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

const NONE: readonly BoardItem[] = [];

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
