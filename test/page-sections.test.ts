import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import {
  applyPagePatch,
  clearFilters,
  currentValues,
  effectiveQuery,
  filterFields,
  hasPageSettings,
  hiddenSections,
  mergePatches,
  moveSection,
  PAGES,
  type PrefField,
  planChange,
  prefsAsPatch,
  sectionOrder,
  toggleSection,
  visibleSections,
} from '#shared/pages';
import { PagePrefsPatchSchema } from '#shared/protocol';
import { emptySnapshot } from '#shared/types';

/** Page settings (#310): hidden and ordered sections, settings-only fields. */

const q = (s: string) => new URLSearchParams(s);

describe('sections a page hides and orders', () => {
  /** A page's sections in their default order. */
  const KEYS = ['recap', 'agenda', 'waiting', 'due'] as const;

  it('show in the default order with nothing saved', () => {
    expect(sectionOrder(KEYS, {})).toEqual([...KEYS]);
    expect(visibleSections(KEYS, {})).toEqual([...KEYS]);
    // A page with no sectionKeys has none.
    expect(visibleSections('tasks', {})).toEqual([]);
  });

  it('follow the saved order, leaving out the hidden ones', () => {
    const prefs = { order: ['due', 'recap', 'agenda', 'waiting'] };
    expect(visibleSections(KEYS, prefs)).toEqual([
      'due',
      'recap',
      'agenda',
      'waiting',
    ]);
    expect(
      visibleSections(KEYS, { ...prefs, hidden: ['agenda', 'recap'] }),
    ).toEqual(['due', 'waiting']);
  });

  it('put a section the saved order lacks in its default place', () => {
    // Saved before `agenda` existed: it lands after `recap`, as by default.
    expect(
      visibleSections(KEYS, { order: ['due', 'waiting', 'recap'] }),
    ).toEqual(['due', 'waiting', 'recap', 'agenda']);
    // The first by default, missing: first; the rest after their neighbor.
    expect(visibleSections(KEYS, { order: ['due', 'agenda'] })).toEqual([
      'recap',
      'due',
      'agenda',
      'waiting',
    ]);
  });

  it('ignore unknown keys and repeats', () => {
    expect(
      visibleSections(KEYS, {
        order: ['gone', 'waiting', 'waiting', 'recap'],
        hidden: ['gone', 'due'],
      }),
    ).toEqual(['waiting', 'recap', 'agenda']);
  });

  it('refuse hiding everything: all hidden reads as all shown', () => {
    expect(visibleSections(KEYS, { hidden: [...KEYS] })).toEqual([...KEYS]);
    expect(hiddenSections(KEYS, { hidden: [...KEYS] }).size).toBe(0);
  });

  it('toggle one, saving hidden whole and refusing the last shown', () => {
    expect(toggleSection(KEYS, {}, 'agenda', false)).toEqual({
      hidden: ['agenda'],
    });
    // In the default order, whatever order they were hidden in.
    expect(toggleSection(KEYS, { hidden: ['due'] }, 'recap', false)).toEqual({
      hidden: ['recap', 'due'],
    });
    expect(toggleSection(KEYS, { hidden: ['due'] }, 'due', true)).toEqual({
      hidden: null,
    });
    // Nothing to change: already shown, unknown, or the last one shown.
    expect(toggleSection(KEYS, {}, 'due', true)).toBeNull();
    expect(toggleSection(KEYS, {}, 'gone', false)).toBeNull();
    expect(
      toggleSection(
        KEYS,
        { hidden: ['recap', 'agenda', 'waiting'] },
        'due',
        false,
      ),
    ).toBeNull();
  });

  it('move one a place, saving order whole; back to the default clears', () => {
    expect(moveSection(KEYS, {}, 'waiting', -1)).toEqual({
      order: ['recap', 'waiting', 'agenda', 'due'],
    });
    expect(
      moveSection(
        KEYS,
        { order: ['recap', 'waiting', 'agenda', 'due'] },
        'waiting',
        1,
      ),
    ).toEqual({ order: null });
    expect(moveSection(KEYS, {}, 'recap', -1)).toBeNull();
    expect(moveSection(KEYS, {}, 'due', 1)).toBeNull();
    expect(moveSection(KEYS, {}, 'gone', 1)).toBeNull();
  });

  it('patch, merge and save again for Undo', () => {
    const prefs = applyPagePatch(
      { view: 'day' },
      { hidden: ['agenda'], order: ['due', 'recap'] },
    );
    expect(prefs).toEqual({
      view: 'day',
      hidden: ['agenda'],
      order: ['due', 'recap'],
    });
    // Replaced whole; cleared by null or an empty list.
    expect(applyPagePatch(prefs, { hidden: ['due'], order: null })).toEqual({
      view: 'day',
      hidden: ['due'],
    });
    expect(applyPagePatch({ hidden: ['due'] }, { hidden: [] })).toBeUndefined();
    expect(
      mergePatches({ hidden: ['a'], order: ['b'] }, { hidden: ['c'] }),
    ).toEqual({ hidden: ['c'], order: ['b'] });
    const patch = prefsAsPatch(prefs ?? {});
    expect(PagePrefsPatchSchema.safeParse(patch).success).toBe(true);
    expect(applyPagePatch(undefined, patch)).toEqual(prefs);
  });

  it('refuse a repeated key, an oversized list or a bad key in a patch', () => {
    const ok = (patch: unknown) =>
      PagePrefsPatchSchema.safeParse(patch).success;
    expect(ok({ hidden: ['a', 'b'] })).toBe(true);
    expect(ok({ order: null })).toBe(true);
    expect(ok({ hidden: ['a', 'a'] })).toBe(false);
    expect(ok({ order: ['Bad key'] })).toBe(false);
    expect(
      ok({
        order: Array.from(
          { length: LIMITS.prefSectionsMax + 1 },
          (_, i) => `s${i}`,
        ),
      }),
    ).toBe(false);
  });
});

describe('settings-only fields', () => {
  /** A threshold the task page keeps out of the address, for this test. */
  const field: PrefField = {
    key: 'within',
    label: 'Within',
    def: '14',
    options: [
      { value: '7', label: '7 days' },
      { value: '14', label: '14 days' },
    ],
    control: 'select',
    settingsOnly: true,
  };
  const spec = PAGES.task as { fields: readonly PrefField[] };
  const before = spec.fields;
  beforeEach(() => {
    spec.fields = [field];
  });
  afterEach(() => {
    spec.fields = before;
  });

  it('stay out of the address, read or written', () => {
    const saved = { within: '7' };
    // Never added from what is saved, and one in the address is ignored.
    expect(effectiveQuery('task', q(''), saved).toString()).toBe('');
    expect(effectiveQuery('task', q('within=7&x=1'), saved).toString()).toBe(
      'x=1',
    );
    // Saved, but neither written to the address nor pinned for Back.
    const change = planChange('task', { within: '7' }, {});
    expect(change.url).toEqual({});
    expect(change.pin).toEqual({});
    expect(change.patch).toEqual({ filters: { within: '7' } });
    expect(planChange('task', { within: '14' }, saved).patch).toEqual({
      filters: { within: null },
    });
  });

  it('are read from what is saved, and are not filters', () => {
    expect(
      currentValues('task', { filters: { within: '7' } }, emptySnapshot()),
    ).toEqual({ within: '7' });
    expect(filterFields('task')).toEqual([]);
    expect(clearFilters('task')).toEqual({ q: null });
    // Something to set: Settings → Pages lists the page.
    expect(hasPageSettings('task')).toBe(true);
  });
});
