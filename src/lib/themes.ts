/**
 * The selectable themes: `light` and `dark` are the token sets on `:root`
 * and `.dark` in src/index.css; `system` follows the OS.
 *
 * index.html applies the saved theme before first paint and keeps its own
 * copy of this logic; update it when changing the ids here.
 */

export type ThemeId = 'system' | 'light' | 'dark';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  /** Which token set it uses. `system` resolves at runtime. */
  base: 'light' | 'dark' | 'system';
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'system', label: 'System', base: 'system' },
  { id: 'light', label: 'Light', base: 'light' },
  { id: 'dark', label: 'Dark', base: 'dark' },
];

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function themeOption(id: ThemeId): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
