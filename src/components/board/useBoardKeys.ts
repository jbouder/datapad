import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react';
import {
  arrowEnds,
  attachedTo,
  type Box,
  connect,
  connectable,
  edgeToward,
  nextTarget,
  snapEnd,
} from '#shared/board';
import type { BaseOp } from '#shared/protocol';
import { BOARD_BIG_STEP, BOARD_STEP } from '#shared/shortcuts';
import {
  BOARD_COLORS,
  type BoardColor,
  type BoardItem,
  type BoardKind,
  type Person,
} from '#shared/types';
import { itemName } from '@/components/board/items';
import { arrowBetween, endOps } from '@/components/board/ops';
import { TOOL_INFO, TOOLS, type Tool } from '@/components/board/Toolbar';
import {
  clampCoord,
  type Point,
  toBoard,
  type Viewport,
} from '@/components/board/viewport';

/**
 * Drawing an arrow (`connect`: from an item to the one Tab picks) or
 * re-aiming one end of an arrow (`aim`: Tab picks an item, the arrow keys
 * move the end), from the keyboard. Nothing is sent until Enter; Escape
 * leaves the board as it was.
 */
export type KeyMode =
  | { kind: 'connect'; from: string; to?: string }
  | { kind: 'aim'; id: string; which: 0 | 1; at: Point; to?: string };

/** What a tool key says, for the tools Enter also works with. */
const TOOL_HINTS: Partial<Record<Tool, string>> = {
  sticky:
    'Sticky note: click to place one, or press Enter for the middle of the view',
  text: 'Text: click to place it, or press Enter for the middle of the view',
  rect: 'Rectangle: drag to draw one, or press Enter for the middle of the view',
  arrow:
    'Arrow: drag to draw one, or press Enter to draw one from the selected item',
};

/** The arrow keys, as a step on the board. */
const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Options {
  surface: RefObject<HTMLDivElement | null>;
  svg: RefObject<SVGSVGElement | null>;
  viewRef: RefObject<Viewport | null>;
  /** The middle of the view, on screen. */
  center: () => Point;
  itemsRef: RefObject<readonly BoardItem[]>;
  byId: ReadonlyMap<string, BoardItem>;
  people: Record<string, Person>;
  selectedRef: RefObject<string[]>;
  select: (ids: string[]) => void;
  /** An item's editor is open: the keys are its. */
  editing: boolean;
  tool: Tool;
  setTool: (tool: Tool) => void;
  setSpaceHeld: (held: boolean) => void;
  /** The announcement waiting for the next selection; a key forgets it. */
  queued: RefObject<string | null>;
  setAnnouncement: (text: string) => void;
  announce: (text: string) => void;
  create: (
    kind: Extract<BoardKind, 'sticky' | 'text' | 'rect'>,
    at: Point,
    write?: boolean,
  ) => void;
  addItem: (
    kind: BoardKind,
    box: Box,
    points?: number[],
    at?: Point,
  ) => string | null;
  startEdit: (id: string) => void;
  focusItem: (id: string) => void;
  run: (ops: BaseOp[]) => boolean;
  nudge: (dx: number, dy: number) => void;
  resizeBy: (dw: number, dh: number) => void;
  recolor: (color: BoardColor) => void;
  restack: (to: 'top' | 'bottom') => void;
  remove: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * The board's keys: tools, colors, the selection (select all, move,
 * resize, restack, delete, edit), undo and redo, Space to pan, and arrows
 * drawn or re-aimed from the keyboard (`KeyMode`). `onKeyDown` goes on the
 * element around the board and its toolbar.
 */
export function useBoardKeys(o: Options) {
  const [mode, setModeState] = useState<KeyMode | null>(null);
  const modeRef = useRef(mode);
  const setMode = useCallback((next: KeyMode | null) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  /** Focus an item now (a key moved to it), not on the next frame. */
  const focusNow = (id: string) => {
    o.svg.current
      ?.querySelector<SVGGElement>(`[data-item-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  };

  /** Leaves the mode with nothing changed; `back` returns focus to it. */
  const cancelMode = (back = true) => {
    const m = modeRef.current;
    if (!m) return;
    setMode(null);
    o.setAnnouncement(
      m.kind === 'connect' ? 'Arrow cancelled' : 'Re-aiming cancelled',
    );
    if (back) focusNow(m.kind === 'connect' ? m.from : m.id);
  };

  /** The arrow tool's Enter: an arrow from the selected item, once aimed. */
  const startConnect = () => {
    const ids = o.selectedRef.current;
    const from = ids.length === 1 && ids[0] ? o.byId.get(ids[0]) : undefined;
    if (!from || !connectable(from)) {
      o.setAnnouncement(
        'Select the sticky note, text or rectangle the arrow starts from (Tab to it), then press Enter',
      );
      return;
    }
    setMode({ kind: 'connect', from: from.id });
    o.setAnnouncement(
      `Drawing an arrow from ${itemName(from, o.people)}. Tab to the item it points to, then press Enter to draw it, or Escape to cancel`,
    );
  };

  /** Enter (the head) or Shift+Enter (the tail) on a selected arrow. */
  const startAim = (arrow: BoardItem, which: 0 | 1) => {
    setMode({ kind: 'aim', id: arrow.id, which, at: arrowEnds(arrow)[which] });
    o.setAnnouncement(
      `Re-aiming the arrow’s ${which === 1 ? 'head' : 'tail'}. Tab to the item it should point to, or move it with the arrow keys; Enter to confirm, Escape to cancel`,
    );
  };

  /** Tab (or Shift+Tab) while aiming: the next item to point to. */
  const pickTarget = (step: 1 | -1) => {
    const m = modeRef.current;
    if (!m) return;
    const all = o.itemsRef.current;
    const current =
      m.to ?? (m.kind === 'connect' ? m.from : attachedTo(all, m.at)?.id);
    const next = nextTarget(
      all,
      current,
      step,
      m.kind === 'connect' ? m.from : undefined,
    );
    if (!next) {
      o.setAnnouncement('There is nothing else on the board to point to');
      return;
    }
    if (m.kind === 'connect') {
      setMode({ ...m, to: next.id });
      o.setAnnouncement(
        `To ${itemName(next, o.people)}. Enter draws the arrow, Escape cancels`,
      );
    } else {
      const arrow = o.byId.get(m.id);
      if (!arrow) {
        cancelMode(false);
        return;
      }
      const other = arrowEnds(arrow)[m.which === 0 ? 1 : 0];
      setMode({ ...m, to: next.id, at: edgeToward(next, other) });
      o.setAnnouncement(
        `To ${itemName(next, o.people)}. Enter confirms, Escape cancels`,
      );
    }
    focusNow(next.id);
  };

  /** The arrow keys while re-aiming: the end moves on its own. */
  const moveEnd = (dx: number, dy: number) => {
    const m = modeRef.current;
    if (m?.kind !== 'aim') return;
    setMode({
      ...m,
      to: undefined,
      at: { x: clampCoord(m.at.x + dx), y: clampCoord(m.at.y + dy) },
    });
    if (m.to) focusNow(m.id);
  };

  /** Enter while aiming: the arrow drawn, or its end moved, as one step. */
  const commitMode = () => {
    const m = modeRef.current;
    if (!m) return;
    if (m.kind === 'connect') {
      const from = o.byId.get(m.from);
      const to = m.to ? o.byId.get(m.to) : undefined;
      if (!from) {
        cancelMode(false);
        return;
      }
      if (!to) {
        o.setAnnouncement('Tab to the item the arrow points to first');
        return;
      }
      setMode(null);
      const [a, b] = connect(from, to);
      const arrow = arrowBetween(a, b);
      const id = o.addItem('arrow', arrow.box, arrow.points, arrow.at);
      if (!id) {
        focusNow(from.id);
        return;
      }
      o.setTool('select');
      o.announce(
        `Drew an arrow from ${itemName(from, o.people)} to ${itemName(to, o.people)}`,
      );
      o.select([id]);
      o.focusItem(id);
      return;
    }
    setMode(null);
    const arrow = o.byId.get(m.id);
    if (!arrow) return;
    const ends = arrowEnds(arrow);
    const [a, b] = ends;
    const to = m.to ? o.byId.get(m.to) : undefined;
    const at = to
      ? edgeToward(to, m.which === 0 ? b : a)
      : snapEnd(o.itemsRef.current, m.at, arrow.id);
    const ops = endOps(arrow, ends, m.which, at);
    if (ops.length > 0) o.run(ops);
    const host = to ?? attachedTo(o.itemsRef.current, at);
    const end = m.which === 1 ? 'head' : 'tail';
    o.setAnnouncement(
      host
        ? `The arrow’s ${end} points to ${itemName(host, o.people)}`
        : `Moved the arrow’s ${end}`,
    );
    o.focusItem(arrow.id);
  };

  /** Keys while aiming: Tab picks, arrows move an end, Enter, Escape. */
  const onModeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const m = modeRef.current;
    if (!m || e.metaKey || e.ctrlKey || e.altKey) return;
    const vector = ARROW_KEYS[e.key];
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelMode();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      pickTarget(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitMode();
    } else if (vector) {
      e.preventDefault();
      const step = e.shiftKey ? BOARD_BIG_STEP : BOARD_STEP;
      if (m.kind === 'aim') moveEnd(vector[0] * step, vector[1] * step);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    o.queued.current = null;
    if (e.defaultPrevented || o.editing) return;
    const target = e.target as Element;
    if (target.closest('textarea, input')) return;
    if (modeRef.current) {
      onModeKey(e);
      return;
    }
    const onBoard = o.surface.current?.contains(target) ?? false;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'a' && onBoard) {
      e.preventDefault();
      o.select(o.itemsRef.current.map((b) => b.id));
      return;
    }
    // ⌘Z undoes, ⇧⌘Z (or Ctrl+Y) redoes: this board's steps only.
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) o.redo();
      else o.undo();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      o.redo();
      return;
    }
    // Alt+arrows resize (Shift: a bigger step). Prevented, so that
    // Alt+← and Alt+→ do not go back and forward on Windows and Linux.
    const vector = ARROW_KEYS[e.key];
    if (e.altKey && !mod && vector && onBoard) {
      e.preventDefault();
      if (o.selectedRef.current.length > 0) {
        const step = e.shiftKey ? BOARD_BIG_STEP : BOARD_STEP;
        o.resizeBy(vector[0] * step, vector[1] * step);
      }
      return;
    }
    if (mod || e.altKey) return;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const toolKey = TOOLS.find((t) => TOOL_INFO[t].key.toLowerCase() === lower);
    if (toolKey && !e.shiftKey) {
      e.preventDefault();
      o.setTool(toolKey);
      const hint = TOOL_HINTS[toolKey];
      if (hint) o.setAnnouncement(hint);
      return;
    }
    const digit = Number(key);
    if (key.length === 1 && digit >= 1 && digit <= BOARD_COLORS.length) {
      const next = BOARD_COLORS[digit - 1];
      if (next) {
        e.preventDefault();
        o.recolor(next);
      }
      return;
    }
    const selected = o.selectedRef.current;
    if ((key === ']' || key === '[') && selected.length > 0) {
      e.preventDefault();
      o.restack(key === ']' ? 'top' : 'bottom');
      return;
    }
    if (key === 'Escape') {
      if (o.tool !== 'select') {
        e.preventDefault();
        o.setTool('select');
      } else if (selected.length > 0) {
        e.preventDefault();
        o.select([]);
        o.surface.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (!onBoard) return;
    if (key === ' ') {
      e.preventDefault();
      if (!e.repeat) o.setSpaceHeld(true);
      return;
    }
    if ((key === 'Delete' || key === 'Backspace') && selected.length > 0) {
      e.preventDefault();
      o.remove(selected);
      o.surface.current?.focus({ preventScroll: true });
      return;
    }
    if (vector && selected.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? BOARD_BIG_STEP : BOARD_STEP;
      o.nudge(vector[0] * step, vector[1] * step);
      return;
    }
    if (key === 'Enter') {
      const tool = o.tool;
      if (tool === 'sticky' || tool === 'text' || tool === 'rect') {
        e.preventDefault();
        const v = o.viewRef.current;
        if (v) o.create(tool, toBoard(v, o.center()), true);
        return;
      }
      if (tool === 'arrow') {
        e.preventDefault();
        startConnect();
        return;
      }
      const [only] = selected;
      const item = only ? o.byId.get(only) : undefined;
      if (selected.length === 1 && item) {
        e.preventDefault();
        if (item.kind === 'arrow') startAim(item, e.shiftKey ? 0 : 1);
        else o.startEdit(item.id);
      }
    }
  };

  return { mode, modeRef, cancelMode, onKeyDown };
}
