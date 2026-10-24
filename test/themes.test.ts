import { describe, expect, it } from 'vitest';
import css from '../src/index.css?raw';
import { PALETTE_IDS, THEMES as THEME_OPTIONS } from '../src/lib/themes';

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
  dagobah: { ...dark, ...block('html[data-theme="dagobah"]') },
  tatooine: { ...light, ...block('html[data-theme="tatooine"]') },
  kamino: { ...dark, ...block('html[data-theme="kamino"]') },
};

/** oklch(L C H) → relative luminance, via OKLab and linear sRGB. */
function luminance(value: string): number {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`Not an opaque oklch() color: ${value}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(fg: string, bg: string): number {
  const [x, y] = [luminance(fg), luminance(bg)].sort((p, q) => q - p);
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
];

const NON_TEXT: [fg: string, bg: string][] = [
  ['ring', 'background'],
  ['ring', 'card'],
];

describe.each(Object.entries(THEMES))('theme %s', (_, tokens) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(3);
  });
});

/**
 * A palette block that forgets a token silently inherits its base theme's
 * value, so each block has to define every colour token :root does.
 * Sidebar tokens follow the card in the extra themes (a shared block), and
 * the radius is the same everywhere.
 */
const REQUIRED = Object.keys(light).filter(
  (name) => name !== 'radius' && !name.startsWith('sidebar'),
);

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

  it.each(['.dark', ...PALETTE_IDS.map((id) => `html[data-theme="${id}"]`)])(
    '%s defines every token',
    (selector) => {
      const own = Object.keys(block(selector));
      expect(REQUIRED.filter((name) => !own.includes(name))).toEqual([]);
    },
  );
});

describe('theme ids', () => {
  it('has a token block for every palette theme', () => {
    expect(Object.keys(THEMES).sort()).toEqual(
      ['light', 'dark', ...PALETTE_IDS].sort(),
    );
  });

  it('lists six themes, System first', () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      'system',
      'light',
      'dark',
      'dagobah',
      'tatooine',
      'kamino',
    ]);
  });
});
