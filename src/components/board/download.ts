import { BOARD_COLORS, type BoardColor } from '#shared/types';
import {
  EXPORT_FONT,
  type ExportPalette,
  type Measure,
} from '@/components/board/export';

/**
 * The browser halves of the whiteboard's export: the theme's tokens
 * resolved to plain colors, text measured on a canvas, the PNG drawn on
 * one, and the file saved. Everything happens on this device.
 */

/** Each board color's token, as `.board-item[data-color]` maps it. */
const TINTS: Record<BoardColor, string> = {
  neutral: 'var(--muted-foreground)',
  accent: 'var(--primary)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--destructive)',
};

/** The longest side a PNG may have (canvases stop working past ~16k). */
export const PNG_MAX_SIDE = 8192;
/** The PNG's scale: 2×, unless that would pass `PNG_MAX_SIDE`. */
export const PNG_SCALE = 2;

let scratch: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D | null {
  if (!scratch) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    scratch = canvas.getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

/**
 * A computed color (`oklch(…)`, `oklab(…)`, `color(srgb …)`) as `#rrggbb`,
 * which every SVG viewer reads: painted on a 1×1 canvas and read back.
 */
function toHex(css: string): string {
  const ctx = context();
  if (!ctx) return css;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The current theme's values for the export: each CSS expression the
 * board uses (a token, or a sticky's `color-mix` in oklab, exactly as in
 * `src/index.css`) computed on a probe inside the app, so the theme in
 * force is the one resolved.
 */
export function resolvePalette(): ExportPalette {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);
  const read = (expr: string) => {
    probe.style.color = '';
    probe.style.color = expr;
    return toHex(getComputedStyle(probe).color);
  };
  try {
    const colors = {} as ExportPalette['colors'];
    for (const c of BOARD_COLORS) {
      const tint = TINTS[c];
      colors[c] = {
        tint: read(tint),
        fill: read(`color-mix(in oklab, ${tint} 20%, var(--card))`),
        stroke: read(`color-mix(in oklab, ${tint} 55%, var(--card))`),
      };
    }
    return {
      background: read('var(--background)'),
      text: read('var(--card-foreground)'),
      colors,
    };
  } finally {
    probe.remove();
  }
}

/** Text widths in the export's font, on a canvas. */
export const measureExportText: Measure = (text, size) => {
  const ctx = context();
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${size}px ${EXPORT_FONT}`;
  return ctx.measureText(text).width;
};

/** Saves `blob` as `name` through a download. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** The PNG's scale for a drawing `width × height`: 2×, within the cap. */
export function pngScale(width: number, height: number): number {
  return Math.min(PNG_SCALE, PNG_MAX_SIDE / Math.max(width, height, 1));
}

/** An SVG drawn on a canvas at `pngScale()`, as a PNG. */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = pngScale(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No PNG'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
