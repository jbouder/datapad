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

  it('lists every binding once', () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
