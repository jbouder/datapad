import {
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from 'react';
import type { BoardMove, Box } from '#shared/board';
import type { BaseOp } from '#shared/protocol';
import type { BoardItem, BoardKind } from '#shared/types';
import {
  type Draft,
  type Drag,
  type Effect,
  type Gesture,
  LONG_PRESS_MS,
  longPress,
  pointerDown,
  pointerMove,
  pointerUp,
  type Scene,
  type Step,
  type Tap,
} from './gesture';
import type { Tool } from './tools';
import type { Point, Viewport } from './viewport';

const NO_IDS: ReadonlySet<string> = new Set();

interface Options {
  svg: RefObject<SVGSVGElement | null>;
  surface: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<Viewport | null>;
  setView: (view: Viewport) => void;
  tool: Tool;
  /** Space is held: the pointer pans. */
  spaceRef: RefObject<boolean>;
  itemsRef: RefObject<readonly BoardItem[]>;
  byId: ReadonlyMap<string, BoardItem>;
  selectedRef: RefObject<string[]>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  /** A press on an item focuses it; that focus must not reselect. */
  pressing: RefObject<boolean>;
  screenPoint: (e: { clientX: number; clientY: number }) => Point;
  /** A pointer pressed, before anything else: the keys' mode ends. */
  onPress: () => void;
  setTool: (tool: Tool) => void;
  setAnnouncement: (text: string) => void;
  create: (kind: 'sticky' | 'text' | 'rect', at: Point) => void;
  addItem: (
    kind: BoardKind,
    box: Box,
    points?: number[],
    at?: Point,
  ) => string | null;
  run: (ops: BaseOp[]) => boolean;
  moveTo: (moves: BoardMove[]) => void;
  startEdit: (id: string) => void;
  focusItem: (id: string) => void;
}

/**
 * The board's pointers: reads each event into `gesture.ts`'s inputs,
 * keeps the gesture under way, and carries out the effects each step
 * asks for. What a gesture shows while the pointer is down (a drag, a
 * resize, a marquee, a draft, the strokes being erased, an arrow's end)
 * is state here; what it makes goes through `run`, as one step.
 */
export function useBoardGestures(o: Options) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<{ id: string; box: Box } | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Strokes the eraser has passed over, deleted when it lifts. */
  const [erasing, setErasing] = useState<ReadonlySet<string>>(NO_IDS);
  /** An arrow end being dragged: the arrow's points meanwhile. */
  const [endEdit, setEndEdit] = useState<{
    id: string;
    points: number[];
  } | null>(null);

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const cancelGesture = useCallback(() => {
    window.clearTimeout(timer.current);
    gesture.current = null;
    setDrag(null);
    setResize(null);
    setMarquee(null);
    setPanning(false);
    setDraft(null);
    setErasing(NO_IDS);
    setEndEdit(null);
  }, []);

  const scene = (view: Viewport): Scene => ({
    view,
    items: o.itemsRef.current,
    byId: o.byId,
    selected: o.selectedRef.current,
  });

  /** The effects, in order; `event` and `pressed` are the press's. */
  const apply = (
    effects: readonly Effect[],
    event?: { preventDefault: () => void },
    pressed?: Element | null,
  ) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'cancel':
          cancelGesture();
          break;
        case 'preventDefault':
          event?.preventDefault();
          break;
        case 'focusSurface':
          o.surface.current?.focus({ preventScroll: true });
          break;
        case 'pressing':
          o.pressing.current = true;
          break;
        case 'focusPressed':
          (pressed as SVGGElement | null)?.focus({ preventScroll: true });
          break;
        case 'view':
          o.setView(effect.view);
          break;
        case 'panning':
          setPanning(effect.on);
          break;
        case 'draft':
          setDraft(effect.draft);
          break;
        case 'erasing':
          setErasing(effect.ids);
          break;
        case 'endEdit':
          setEndEdit(effect.edit);
          break;
        case 'drag':
          setDrag(effect.drag);
          break;
        case 'resize':
          setResize(effect.resize);
          break;
        case 'marquee':
          setMarquee(effect.box);
          break;
        case 'longPress':
          window.clearTimeout(timer.current);
          if (effect.start) {
            timer.current = window.setTimeout(() => {
              const v = o.viewRef.current;
              if (v) advance(longPress(gesture.current, v));
            }, LONG_PRESS_MS);
          }
          break;
        case 'select':
          o.setSelected(effect.ids);
          break;
        case 'deselect': {
          const { ids } = effect;
          o.setSelected((s) => s.filter((id) => !ids.has(id)));
          break;
        }
        case 'announce':
          o.setAnnouncement(effect.text);
          break;
        case 'create':
          o.create(effect.kind, effect.at);
          break;
        case 'add': {
          const id = o.addItem(
            effect.kind,
            effect.box,
            effect.points,
            effect.at,
          );
          if (!id || !effect.pick) break;
          o.setTool('select');
          o.setSelected([id]);
          o.focusItem(id);
          break;
        }
        case 'moveTo':
          o.moveTo(effect.moves);
          break;
        case 'run':
          if (o.run(effect.ops) && effect.after) apply(effect.after);
          break;
        case 'edit':
          o.startEdit(effect.id);
          break;
      }
    }
  };

  /** A step taken: its effects carried out, then its gesture kept. */
  const advance = (
    step: Step,
    event?: { preventDefault: () => void },
    pressed?: Element | null,
  ) => {
    apply(step.effects, event, pressed);
    gesture.current = step.gesture;
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const v = o.viewRef.current;
    if (!v) return;
    o.onPress();
    const p = o.screenPoint(e);
    pointers.current.set(e.pointerId, p);
    o.svg.current?.setPointerCapture?.(e.pointerId);
    const target = e.target as Element;
    const handle = target.closest<SVGElement>('[data-handle]');
    const itemEl = target.closest<SVGElement>('[data-item-id]');
    advance(
      pointerDown(gesture.current, scene(v), {
        point: p,
        pointers: [...pointers.current.values()],
        button: e.button,
        touch: e.pointerType === 'touch',
        shift: e.shiftKey,
        spaceHeld: o.spaceRef.current,
        tool: o.tool,
        target: {
          item: itemEl?.dataset.itemId,
          handle: handle?.dataset.handle,
          end: handle?.dataset.end,
        },
      }),
      e,
      itemEl,
    );
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = o.screenPoint(e);
    const before = pointers.current.get(e.pointerId) ?? p;
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const v = o.viewRef.current;
    if (!g || !v) return;
    let samples: Point[] = [];
    if (g.kind === 'ink') {
      // Every sample the browser coalesced, so a fast stroke stays smooth.
      const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
      samples = (coalesced.length > 0 ? coalesced : [e.nativeEvent]).map(
        o.screenPoint,
      );
    }
    advance(
      pointerMove(g, scene(v), {
        point: p,
        before,
        pointers: [...pointers.current.values()],
        shift: e.shiftKey,
        samples,
      }),
    );
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = pointers.current.get(e.pointerId) ?? o.screenPoint(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const v = o.viewRef.current;
    o.pressing.current = false;
    if (!g || !v) return;
    const step = pointerUp(g, scene(v), {
      point: p,
      remaining: pointers.current.size,
      now: performance.now(),
      lastTap: lastTap.current,
    });
    lastTap.current = step.lastTap;
    advance(step);
  };

  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    o.pressing.current = false;
    cancelGesture();
  };

  const onContextMenu = (e: MouseEvent<SVGSVGElement>) => {
    if (gesture.current) e.preventDefault();
  };

  return {
    drag,
    resize,
    marquee,
    panning,
    draft,
    erasing,
    endEdit,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
    },
  };
}
