import { describe, expect, it } from 'vitest';
import css from '../src/index.css?raw';
import { THEMES as THEME_OPTIONS } from '../src/lib/themes';

/**
 * Every theme's tokens against WCAG AA: 4.5:1 for text on the surfaces it
 * sits on, 3:1 for the focus ring against the page and cards. Reads the
 * token blocks straight out of src/index.css.
 */

type Tokens = Record<string, string>;

function block(selector: string): Tokens {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens: Tokens = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const light = block(':root');
const dark = { ...light, ...block('.dark') };
const THEMES: Record<string, Tokens> = {
  light,
  dark,
};

type Rgb = [r: number, g: number, b: number];

/** oklch(L C H [/ A]) → gamma-encoded sRGB (0–1) and its alpha. */
function parse(value: string): { rgb: Rgb; alpha: number } {
  const m = value.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/,
  );
  if (!m) throw new Error(`Not an oklch() color: ${value}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const linear: Rgb = [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
  const encode = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return { rgb: linear.map(encode) as Rgb, alpha };
}

function luminance([r, g, b]: Rgb): number {
  const decode = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/**
 * A token as it is drawn on `under`: `ring/50` is the ring at half its
 * alpha, and anything translucent is blended over the surface below, the
 * way the browser composites it (in gamma-encoded sRGB).
 */
function paint(tokens: Tokens, name: string, under?: Rgb): Rgb {
  const [token = '', percent] = name.split('/');
  const { rgb, alpha } = parse(tokens[token] ?? '');
  const a = alpha * (percent ? Number(percent) / 100 : 1);
  if (a >= 1) return rgb;
  if (!under) throw new Error(`${name} is translucent: give it a surface`);
  return rgb.map((c, i) => c * a + (under[i] ?? 0) * (1 - a)) as Rgb;
}

/** Contrast of `fg` drawn on `bg`, which is drawn on the page. */
function contrast(tokens: Tokens, fg: string, bg: string): number {
  const page = paint(tokens, 'background');
  const surface = paint(tokens, bg, page);
  const [x, y] = [
    luminance(paint(tokens, fg, surface)),
    luminance(surface),
  ].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT: [fg: string, bg: string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  // Datapad's semantic pair: used as text (due today, done) and as a fill
  // with its foreground on top (pills).
  ['warn', 'background'],
  ['warn', 'card'],
  ['warn-foreground', 'warn'],
  ['ok', 'background'],
  ['ok', 'card'],
  ['ok-foreground', 'ok'],
  // The rail: its items, counts and the current item.
  ['sidebar-foreground', 'sidebar'],
  ['muted-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ['muted-foreground', 'sidebar-accent'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  // Hovered rows and menu items keep their muted text readable.
  ['muted-foreground', 'accent'],
  ['muted-foreground', 'popover'],
];

const NON_TEXT: [fg: string, bg: string][] = [
  // The focus ring, as drawn: the app's `outline-ring/50` and the stock
  // components' `ring-ring/50`, and full strength on inputs (`border-ring`).
  ['ring', 'background'],
  ['ring', 'card'],
  ['ring/50', 'background'],
  ['ring/50', 'card'],
  ['ring/50', 'popover'],
  ['ring/50', 'sidebar'],
  ['ring/50', 'accent'],
  ['sidebar-ring', 'sidebar'],
  // A text field's edge is what shows it is one (WCAG 1.4.11).
  ['input', 'background'],
  ['input', 'card'],
  ['input', 'popover'],
];

describe.each(Object.entries(THEMES))('theme %s', (_, tokens) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

/**
 * `.dark` layers on `:root`; a token it forgets silently keeps the light
 * value, so it has to define every color token :root does (the radius is
 * the same in both).
 */
const REQUIRED = Object.keys(light).filter((name) => name !== 'radius');

describe('token coverage', () => {
  it('requires the Datapad tokens', () => {
    expect(REQUIRED).toEqual(
      expect.arrayContaining([
        'warn',
        'warn-foreground',
        'ok',
        'ok-foreground',
      ]),
    );
  });

  it('.dark defines every token', () => {
    const own = Object.keys(block('.dark'));
    expect(REQUIRED.filter((name) => !own.includes(name))).toEqual([]);
  });
});

describe('theme ids', () => {
  it('lists System, Light and Dark', () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual(['system', 'light', 'dark']);
  });
});

describe('Dark is the neutral counterpart of Light', () => {
  it('has no tint on its surfaces and text', () => {
    for (const token of [
      'background',
      'foreground',
      'card',
      'popover',
      'muted',
      'border',
      'primary',
    ]) {
      const value = dark[token] ?? '';
      // oklch(L C H [/ alpha]): chroma 0 means gray.
      expect(value, token).toMatch(/^oklch\(\s*[\d.]+\s+0(\s|\))/);
    }
  });
});
