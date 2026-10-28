import { describe, expect, it } from 'vitest';
import css from '../src/index.css?raw';
import { DURATION, EASE } from '../src/lib/motion-tokens';

/**
 * Motion has one set of tokens. CSS reads them as `var(--duration-*)` and
 * `var(--ease-*)`; script (WAAPI, timers) reads src/lib/motion-tokens.ts.
 * The two must say the same thing, and no `.animate()` call may write its
 * own duration or easing.
 */

// Read at build time: the tests run in workerd, which has no file system.
const SOURCES = import.meta.glob<string>(
  ['../src/**/*.{ts,tsx}', '!../src/components/ui/**'],
  { query: '?raw', import: 'default', eager: true },
);

function rootTokens(): Record<string, string> {
  const start = css.indexOf('--duration-fast');
  const open = css.lastIndexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const [, name = '', value = ''] of body.matchAll(
    /--([\w-]+):\s*([^;]+);/g,
  )) {
    tokens[name] = value.trim();
  }
  return tokens;
}

describe('motion tokens', () => {
  const tokens = rootTokens();

  it('script and CSS give each duration the same value', () => {
    for (const [name, ms] of Object.entries(DURATION)) {
      expect(tokens[`duration-${name}`], `--duration-${name}`).toBe(`${ms}ms`);
    }
    const css = Object.keys(tokens).filter((t) => t.startsWith('duration-'));
    expect(css.sort()).toEqual(
      Object.keys(DURATION)
        .map((n) => `duration-${n}`)
        .sort(),
    );
  });

  it('script and CSS give each easing the same curve', () => {
    for (const [name, curve] of Object.entries(EASE)) {
      expect(tokens[`ease-${name}`], `--ease-${name}`).toBe(curve);
    }
  });

  it('no animation in script writes a literal duration or easing', () => {
    expect(Object.keys(SOURCES)).toContain('../src/hooks/useFlip.ts');
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file.endsWith('/motion-tokens.ts')) continue;
      text.split('\n').forEach((line, i) => {
        const where = `${file.replace(/^\.\.\//, '')}:${i + 1}`;
        if (/cubic-bezier\(/.test(line)) offenders.push(`${where} ${line}`);
        if (/\bduration:\s*\d/.test(line)) offenders.push(`${where} ${line}`);
        if (/\beasing:\s*['"]/.test(line)) offenders.push(`${where} ${line}`);
      });
    }
    expect(offenders, 'use DURATION and EASE from @/lib/motion').toEqual([]);
  });
});
