import { describe, expect, it } from 'vitest';
import {
  allCoveredText,
  allDoneActionsText,
  moveAmongShown,
} from '#shared/meetings';
import {
  currentValues,
  effectiveQuery,
  filterFields,
  hasPageSettings,
  listDoneMode,
  PAGES,
  planChange,
  sectionOrder,
  toggleSection,
  visibleSections,
} from '#shared/pages';
import { emptySnapshot } from '#shared/types';

/** The meeting and list pages' settings (#313). */

const q = (s: string) => new URLSearchParams(s);

describe('meeting page settings', () => {
  it('has Topics, Action items, Notes and Series, in today’s order', () => {
    expect(PAGES.meeting.sectionKeys?.map((s) => s.label)).toEqual([
      'Topics',
      'Action items',
      'Notes',
      'Series',
    ]);
    expect(visibleSections('meeting', {})).toEqual([
      'topics',
      'actions',
      'notes',
      'series',
    ]);
    expect(hasPageSettings('meeting')).toBe(true);
  });

  it('hides and reorders its sections', () => {
    const prefs = { order: ['notes', 'topics', 'actions', 'series'] };
    expect(sectionOrder('meeting', prefs)).toEqual(prefs.order);
    expect(toggleSection('meeting', prefs, 'series', false)).toEqual({
      hidden: ['series'],
    });
    expect(
      visibleSections('meeting', { ...prefs, hidden: ['actions'] }),
    ).toEqual(['notes', 'topics', 'series']);
  });

  it('shows covered topics and done action items unless told to hide them', () => {
    const s = emptySnapshot();
    expect(currentValues('meeting', {}, s)).toEqual({});
    expect(
      currentValues(
        'meeting',
        { filters: { covered: 'hide', doneActions: 'hide' } },
        s,
      ),
    ).toEqual({ covered: 'hide', doneActions: 'hide' });
    for (const field of PAGES.meeting.fields) {
      expect(field.def).toBe('show');
      expect(field.settingsOnly).toBe(true);
    }
    // Saved in Settings only: never in the address, not a filter.
    expect(
      effectiveQuery('meeting', q(''), { covered: 'hide' }).toString(),
    ).toBe('');
    expect(planChange('meeting', { covered: 'hide' }, {}).url).toEqual({});
    expect(filterFields('meeting')).toEqual([]);
  });

  it('says so in one line when every topic or action item is hidden', () => {
    expect(allCoveredText(1)).toBe('The one topic is covered');
    expect(allCoveredText(4)).toBe('All 4 topics covered');
    expect(allDoneActionsText(1)).toBe('The one action item is done');
    expect(allDoneActionsText(3)).toBe('All 3 action items done');
  });
});

describe('moving a topic among the shown ones', () => {
  const all = ['a', 'b', 'c', 'd', 'e'];

  it('is a plain move with every topic shown', () => {
    expect(moveAmongShown(all, all, 0, 2)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moveAmongShown(all, all, 4, 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('steps past the next shown topic, the hidden ones keeping their places', () => {
    // b and d are covered and hidden.
    const shown = ['a', 'c', 'e'];
    expect(moveAmongShown(all, shown, 0, 1)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moveAmongShown(all, shown, 2, 1)).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('is null when nothing moves', () => {
    expect(moveAmongShown(all, all, 1, 1)).toBeNull();
    expect(moveAmongShown(all, all, 0, 9)).toBeNull();
  });
});

describe('list page settings', () => {
  it('shows done items collapsed unless told otherwise', () => {
    const [field] = PAGES.list.fields;
    expect(field?.def).toBe('collapsed');
    expect(field?.settingsOnly).toBe(true);
    expect(field?.options?.map((o) => o.label)).toEqual([
      'Collapsed',
      'Expanded',
      'Hidden',
    ]);
    expect(hasPageSettings('list')).toBe(true);
    expect(filterFields('list')).toEqual([]);
  });

  it('reads a saved value as a mode, anything else as the default', () => {
    expect(listDoneMode('expanded')).toBe('expanded');
    expect(listDoneMode('hidden')).toBe('hidden');
    expect(listDoneMode('collapsed')).toBe('collapsed');
    expect(listDoneMode('')).toBe('collapsed');
    expect(listDoneMode('open')).toBe('collapsed');
    // A value the field no longer has is dropped when read.
    expect(
      currentValues('list', { filters: { done: 'open' } }, emptySnapshot()),
    ).toEqual({});
  });
});
