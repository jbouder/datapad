import { describe, expect, it } from 'vitest';
import {
  currentValues,
  effectiveQuery,
  filterFields,
  PAGES,
  pageField,
  planChange,
  sectionCounts,
} from '#shared/pages';
import { emptySnapshot } from '#shared/types';

/** The project page's Show done (#318). */

describe('the project page’s Show done', () => {
  it('is a settings-only field, Hide by default', () => {
    expect(pageField('project', 'done')).toMatchObject({
      label: 'Done tasks',
      def: 'hide',
      settingsOnly: true,
    });
    expect(pageField('project', 'done')?.options?.map((o) => o.value)).toEqual([
      'hide',
      'show',
    ]);
    expect(filterFields('project')).toEqual([]);
  });

  it('is saved, never in the address', () => {
    expect(planChange('project', { done: 'show' }, {})).toEqual({
      url: {},
      pin: {},
      patch: { filters: { done: 'show' } },
    });
    // The default is saved as nothing.
    expect(planChange('project', { done: 'hide' }, {})).toEqual({
      url: {},
      pin: {},
      patch: { filters: { done: null } },
    });
    expect(
      effectiveQuery('project', new URLSearchParams('done=show'), {
        done: 'show',
      }).toString(),
    ).toBe('');
  });

  it('reads what is saved, and anything else as Hide', () => {
    expect(
      currentValues('project', { filters: { done: 'show' } }, emptySnapshot()),
    ).toEqual({ done: 'show' });
    expect(
      currentValues(
        'project',
        { filters: { done: 'always' } },
        emptySnapshot(),
      ),
    ).toEqual({});
  });

  it('ignores the old Done group’s open or closed', () => {
    const prefs = { sections: { done: true, tasks: false } };
    expect(sectionCounts(prefs, PAGES.project.collapsible)).toEqual({
      closed: 1,
      open: 0,
    });
  });
});
