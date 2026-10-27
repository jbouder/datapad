import { bounds } from '#shared/board';
import { tokensToNames } from '#shared/mentions';
import type { BoardColor, BoardItem, Person } from '#shared/types';
import { STICKY_FONT, STICKY_PAD, TEXT_FONT, TEXT_PAD } from './metrics';
import { union } from './viewport';

/**
 * A whiteboard as a standalone SVG (Download as SVG, and the source of
 * Download as PNG). Pure: the colors come in already resolved from the
 * theme's tokens (`resolvePalette()` in `download.ts`), and text is
 * measured by the `measure` given, so it runs anywhere. Text is SVG
 * `<text>`, wrapped here, not a `<foreignObject>`: it renders in any
 * viewer and keeps a canvas it is drawn on clean.
 */

/** One board color, resolved: its tint and a sticky's fill and outline. */
export interface ColorSet {
  tint: string;
  fill: string;
  stroke: string;
}

/** The current theme's values for everything the export draws. */
export interface ExportPalette {
  background: string;
  text: string;
  colors: Record<BoardColor, ColorSet>;
}

/** How wide `text` is at `size` px. */
export type Measure = (text: string, size: number) => number;

/** A font every viewer has: the app's own is not there outside it. */
export const EXPORT_FONT = 'ui-sans-serif, system-ui, sans-serif';
/** Room around the drawing, in board units. */
export const EXPORT_MARGIN = 24;
const LINE = 1.35;

/** A rough width, for tests and anywhere without a canvas. */
export const roughMeasure: Measure = (text, size) => text.length * size * 0.55;

const num = (n: number) => String(Math.round(n * 100) / 100);

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * `text` in lines no wider than `width`: its own line breaks kept, words
 * wrapped, and a word too long for a line broken anywhere (as the board's
 * `overflow-wrap: anywhere` does).
 */
export function wrapLines(
  text: string,
  width: number,
  size: number,
  measure: Measure = roughMeasure,
): string[] {
  const fits = (s: string) => measure(s, size) <= width;
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (/^\s+$/.test(token)) {
        // A space at a break is where the line ends.
        out.push(line);
        line = '';
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = '';
      // A word longer than a line: break it where it runs out.
      let rest = token;
      while (rest && !fits(rest)) {
        let n = 1;
        while (n < rest.length && fits(rest.slice(0, n + 1))) n += 1;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function linePath(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${num(points[0] ?? 0)} ${num(points[1] ?? 0)}`;
  if (points.length === 2) d += ' l0.01 0';
  for (let i = 2; i + 1 < points.length; i += 2) {
    d += ` L${num(points[i] ?? 0)} ${num(points[i + 1] ?? 0)}`;
  }
  return d;
}

/** The arrowhead the board draws: 12 units, at the arrow's end. */
function arrowHead(points: number[]): string {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = points;
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const a = angle + Math.PI - 0.45;
  const b = angle + Math.PI + 0.45;
  return `M${num(x1 + 12 * Math.cos(a))} ${num(y1 + 12 * Math.sin(a))} L${num(
    x1,
  )} ${num(y1)} L${num(x1 + 12 * Math.cos(b))} ${num(y1 + 12 * Math.sin(b))}`;
}

/**
 * A block of text in a box: wrapped to the box less `pad`, cut at the
 * last line that fits (the board clips it too), top-left aligned or, for
 * a rect's label, centred both ways.
 */
function textBlock(
  text: string,
  box: { w: number; h: number },
  size: number,
  pad: number,
  fill: string,
  centre: boolean,
  measure: Measure,
): string {
  if (!text.trim()) return '';
  const lineH = size * LINE;
  const all = wrapLines(text, Math.max(1, box.w - 2 * pad), size, measure);
  const room = Math.max(0, Math.floor((box.h - 2 * pad) / lineH + 0.01));
  const lines = all.slice(0, room);
  if (lines.length === 0) return '';
  const top = centre ? Math.max(pad, (box.h - lines.length * lineH) / 2) : pad;
  // The baseline sits where CSS puts it in a line box this tall.
  const first = top + (lineH - size) / 2 + size * 0.8;
  const x = centre ? box.w / 2 : pad;
  const spans = lines
    .map(
      (line, i) =>
        `<tspan x="${num(x)}" y="${num(first + i * lineH)}">${escapeXml(
          line,
        )}</tspan>`,
    )
    .join('');
  return `<text font-size="${size}" fill="${fill}"${
    centre ? ' text-anchor="middle"' : ''
  } xml:space="preserve">${spans}</text>`;
}

function shape(
  item: BoardItem,
  palette: ExportPalette,
  text: string,
  measure: Measure,
): string {
  const color = palette.colors[item.color];
  const { w, h } = item;
  switch (item.kind) {
    case 'sticky':
      return `<rect width="${num(w)}" height="${num(h)}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1"/>${textBlock(
        text,
        item,
        STICKY_FONT,
        STICKY_PAD,
        palette.text,
        false,
        measure,
      )}`;
    case 'text':
      return textBlock(
        text,
        item,
        TEXT_FONT,
        TEXT_PAD,
        palette.text,
        false,
        measure,
      );
    case 'rect':
      return `<rect width="${num(w)}" height="${num(h)}" fill="none" stroke="${color.tint}" stroke-width="2"/>${textBlock(
        text,
        item,
        STICKY_FONT,
        STICKY_PAD,
        palette.text,
        true,
        measure,
      )}`;
    case 'arrow':
      return `<g fill="none" stroke="${color.tint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${linePath(
        item.points,
      )}"/><path d="${arrowHead(item.points)}"/></g>`;
    case 'ink':
      return `<path d="${linePath(item.points)}" fill="none" stroke="${color.tint}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

export interface BoardSvg {
  svg: string;
  /** Its size in board units (px at 100%). */
  width: number;
  height: number;
}

/**
 * The board's items (in drawing order) as a standalone SVG document, cut
 * to the drawing plus a margin, on the theme's background: no grid, no
 * selection. Null for an empty board.
 */
export function boardSvg(
  items: readonly BoardItem[],
  options: {
    palette: ExportPalette;
    title: string;
    people?: Record<string, Person>;
    measure?: Measure;
  },
): BoardSvg | null {
  const { palette, title, people = {}, measure = roughMeasure } = options;
  const box = union(items.map((b) => bounds(b)));
  if (!box) return null;
  const x = Math.floor(box.x - EXPORT_MARGIN);
  const y = Math.floor(box.y - EXPORT_MARGIN);
  const width = Math.ceil(box.x + box.w + EXPORT_MARGIN) - x;
  const height = Math.ceil(box.y + box.h + EXPORT_MARGIN) - y;
  const body = items
    .map(
      (item) =>
        `<g transform="translate(${num(item.x)} ${num(item.y)})">${shape(
          item,
          palette,
          tokensToNames(item.text, people),
          measure,
        )}</g>`,
    )
    .join('\n');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family="${EXPORT_FONT}">
<title>${escapeXml(title)}</title>
<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${palette.background}"/>
${body}
</svg>
`;
  return { svg, width, height };
}

/** A file name from a board's name: `echo-base-relocation-whiteboard`. */
export function exportName(name: string, ext: 'svg' | 'png'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug ? `${slug}-` : ''}whiteboard.${ext}`;
}
