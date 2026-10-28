/**
 * The motion tokens for script: the Web Animations API and timers take
 * numbers and strings, not `var(--…)`. The same values as the `:root`
 * tokens in src/index.css (`--duration-*`, `--ease-*`);
 * test/motion-tokens.test.ts holds the two equal and keeps literals out
 * of every `.animate()` call. No imports, so the test (in workerd) reads
 * it as is.
 */

/** Milliseconds: `--duration-fast`, `--duration-base`, `--duration-slow`. */
export const DURATION = {
  fast: 100,
  base: 200,
  slow: 350,
} as const;

/** `--ease-standard`, `--ease-emphasized`. */
export const EASE = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;
