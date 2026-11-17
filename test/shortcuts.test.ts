import { describe, expect, it } from 'vitest';
import {
  allowsShortcut,
  SHORTCUTS,
  type ShortcutContext,
} from '#shared/shortcuts';

const base: ShortcutContext = {
  tag: 'BODY',
  contentEditable: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  overlay: false,
};

describe('the shortcut suppression rule', () => {
  it('lets a plain key through on the page', () => {
    expect(allowsShortcut(base)).toBe(true);
    expect(allowsShortcut({ ...base, tag: 'BUTTON' })).toBe(true);
    expect(allowsShortcut({ ...base, tag: 'A' })).toBe(true);
  });

  it('stays out of the way while typing', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(allowsShortcut({ ...base, tag }), tag).toBe(false);
    }
    expect(allowsShortcut({ ...base, tag: 'DIV', contentEditable: true })).toBe(
      false,
    );
  });

  it('stays out of the way while a panel, menu or the palette is open', () => {
    expect(allowsShortcut({ ...base, overlay: true })).toBe(false);
  });

  it('never fires with a modifier, or after someone else handled the key', () => {
    expect(allowsShortcut({ ...base, metaKey: true })).toBe(false);
    expect(allowsShortcut({ ...base, ctrlKey: true })).toBe(false);
    expect(allowsShortcut({ ...base, altKey: true })).toBe(false);
    expect(allowsShortcut({ ...base, defaultPrevented: true })).toBe(false);
  });

  it('lists every binding once where it works', () => {
    for (const scope of new Set(SHORTCUTS.map((s) => s.scope))) {
      const keys = SHORTCUTS.filter((s) => s.scope === scope).flatMap(
        (s) => s.keys,
      );
      expect(new Set(keys).size, scope).toBe(keys.length);
    }
  });

  it('lists n for the capture line, and no per-type add keys', () => {
    const n = SHORTCUTS.filter((s) => s.keys.includes('n'));
    expect(n).toHaveLength(1);
    expect(n[0]?.scope).toBe('Anywhere');
    expect(n[0]?.action).toContain('capture line');
    for (const key of ['Shift+N', 'Shift+L']) {
      expect(
        SHORTCUTS.some((s) => s.keys.includes(key)),
        key,
      ).toBe(false);
    }
    expect(SHORTCUTS.some((s) => s.scope === 'Capture line')).toBe(true);
  });

  it('lists the whiteboard’s resize keys and their steps', () => {
    const resize = SHORTCUTS.find(
      (s) => s.scope === 'Whiteboard' && s.keys.includes('Alt+→'),
    );
    expect(resize?.action).toContain('1 unit (Shift: 10)');
  });
});
