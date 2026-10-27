import { memo } from 'react';
import type { Box } from '#shared/board';
import { tokensToNames } from '#shared/mentions';
import type { BoardColor, BoardItem, BoardKind, Person } from '#shared/types';

/** A new sticky's side, in board units. */
export const STICKY_SIZE = 200;
/** The smallest a resize leaves a box. */
export const MIN_SIZE = 40;
export const STICKY_FONT = 16;
export const STICKY_PAD = 12;
export const TEXT_FONT = 20;
export const TEXT_PAD = 4;
/** Where free text wraps until it is resized wider. */
export const TEXT_WRAP = 480;
const LINE = 1.35;

export const KIND_LABELS: Record<BoardKind, string> = {
  sticky: 'Sticky note',
  text: 'Text',
  rect: 'Rectangle',
  arrow: 'Arrow',
  ink: 'Drawing',
};

/** The five colors, in the order 1–5 picks them. */
export const COLOR_LABELS: Record<BoardColor, string> = {
  neutral: 'Gray',
  accent: 'Accent',
  ok: 'Green',
  warn: 'Yellow',
  danger: 'Red',
};

/** Kinds whose text is edited in place. */
export function hasText(kind: BoardKind): boolean {
  return kind === 'sticky' || kind === 'text' || kind === 'rect';
}

/** Kinds with corner handles. */
export function resizable(kind: BoardKind): boolean {
  return kind === 'sticky' || kind === 'text' || kind === 'rect';
}

/** An item's text as read: mentions as names, nothing else interpreted. */
export function plainText(text: string, people: Record<string, Person>) {
  return tokensToNames(text, people);
}

/** What a screen reader hears for an item: its kind and its text. */
export function itemName(
  item: Pick<BoardItem, 'kind' | 'text'>,
  people: Record<string, Person>,
): string {
  const text = plainText(item.text, people).replace(/\s+/g, ' ').trim();
  const label = KIND_LABELS[item.kind];
  if (!text) return label;
  return `${label}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
}

let canvas: HTMLCanvasElement | null = null;

/**
 * The box free text needs: its widest line (up to `TEXT_WRAP`, past
 * which it wraps) by its lines, at the board's text size.
 */
export function measureText(text: string): { w: number; h: number } {
  const lines = (text || ' ').split('\n');
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family =
    getComputedStyle(document.documentElement).getPropertyValue(
      '--font-sans',
    ) || 'sans-serif';
  let widest = 0;
  let count = 0;
  for (const line of lines) {
    const width = ctx
      ? (() => {
          ctx.font = `${TEXT_FONT}px ${family}`;
          return ctx.measureText(line).width;
        })()
      : line.length * TEXT_FONT * 0.6;
    widest = Math.max(widest, width);
    count += Math.max(1, Math.ceil(width / TEXT_WRAP));
  }
  return {
    // A little slack: the renderer's metrics are not the canvas's.
    w: Math.ceil(
      Math.min(TEXT_WRAP, Math.max(widest * 1.05, 24)) + 2 * TEXT_PAD,
    ),
    h: Math.ceil(count * TEXT_FONT * LINE + 2 * TEXT_PAD),
  };
}

function linePath(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0]} ${points[1]}`;
  if (points.length === 2) d += ` l0.01 0`;
  for (let i = 2; i + 1 < points.length; i += 2) {
    d += ` L${points[i]} ${points[i + 1]}`;
  }
  return d;
}

/** An arrowhead at the arrow's end, 12 units long. */
function arrowHead(points: number[]): string {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = points;
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const a = angle + Math.PI - 0.45;
  const b = angle + Math.PI + 0.45;
  return `M${x1 + 12 * Math.cos(a)} ${y1 + 12 * Math.sin(a)} L${x1} ${y1} L${
    x1 + 12 * Math.cos(b)
  } ${y1 + 12 * Math.sin(b)}`;
}

/**
 * One item's drawing, at its own origin (the caller translates it). Text
 * is plain: mentions read as names, links and markdown as typed.
 */
export const ItemShape = memo(function ItemShape({
  item,
  box,
  text,
}: {
  item: BoardItem;
  /** Its size now (a resize in progress changes it). */
  box: Pick<Box, 'w' | 'h'>;
  /** Its text as shown; hidden while it is being edited. */
  text: string;
}) {
  const { w, h } = box;
  switch (item.kind) {
    case 'sticky':
      return (
        <>
          <rect className="board-sticky-body" width={w} height={h} />
          <foreignObject width={w} height={h}>
            <div
              className="board-text h-full"
              style={{ padding: STICKY_PAD, fontSize: STICKY_FONT }}
            >
              {text}
            </div>
          </foreignObject>
        </>
      );
    case 'text':
      return (
        <>
          <rect width={w} height={h} fill="transparent" />
          <foreignObject width={w} height={h}>
            <div
              className="board-text h-full"
              style={{ padding: TEXT_PAD, fontSize: TEXT_FONT }}
            >
              {text}
            </div>
          </foreignObject>
        </>
      );
    case 'rect':
      return (
        <>
          <rect
            className="board-rect-body"
            width={w}
            height={h}
            fill="transparent"
          />
          <foreignObject width={w} height={h}>
            <div
              className="board-text flex h-full items-center justify-center text-center"
              style={{ padding: STICKY_PAD, fontSize: STICKY_FONT }}
            >
              {text}
            </div>
          </foreignObject>
        </>
      );
    case 'arrow':
      return (
        <>
          <path
            d={linePath(item.points)}
            stroke="transparent"
            strokeWidth={14}
            fill="none"
          />
          <path className="board-line" d={linePath(item.points)} />
          <path className="board-line" d={arrowHead(item.points)} />
        </>
      );
    case 'ink':
      return (
        <>
          <path
            d={linePath(item.points)}
            stroke="transparent"
            strokeWidth={14}
            fill="none"
            strokeLinecap="round"
          />
          <path className="board-line" d={linePath(item.points)} />
        </>
      );
  }
});
