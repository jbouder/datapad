import { describe, expect, it } from 'vitest';
import {
  currentValues,
  effectiveQuery,
  filterFields,
  hasPageSettings,
  PAGES,
  planChange,
  projectColumns,
  sectionCounts,
  sectionOrder,
  sourceNoteShow,
  toggleSection,
  visibleSections,
} from '#shared/pages';
import { emptySnapshot } from '#shared/types';

/** The project page's and the task page's settings (#312). */

const q = (s: string) => new URLSearchParams(s);

describe('the project page', () => {
  it('has its seven sections in today’s order', () => {
    expect(sectionOrder('project', {})).toEqual([
      'milestones',
      'tasks',
      'meetings',
      'notes',
      'lists',
      'whiteboard',
      'activity',
    ]);
  });

  it('shows them in the saved order without the hidden ones', () => {
    const prefs = {
      order: ['notes', 'tasks', 'milestones'],
      hidden: ['whiteboard', 'meetings'],
    };
    expect(visibleSections('project', prefs)).toEqual([
      'notes',
      'lists',
      'activity',
      'tasks',
      'milestones',
    ]);
    expect(toggleSection('project', {}, 'activity', false)).toEqual({
      hidden: ['activity'],
    });
  });

  it('splits them into its columns, keeping the order in each', () => {
    expect(
      projectColumns(['notes', 'tasks', 'activity', 'milestones', 'lists']),
    ).toEqual({
      left: ['tasks', 'milestones'],
      right: ['notes', 'activity', 'lists'],
    });
    expect(projectColumns(['notes'])).toEqual({ left: [], right: ['notes'] });
  });

  it('has Show past, not Meetings shows, and keeps it out of the address (#320)', () => {
    expect(PAGES.project.fields.map((f) => f.key)).not.toContain('meetings');
    const field = PAGES.project.fields.find((f) => f.key === 'past');
    expect(field).toMatchObject({
      label: 'Past meetings',
      def: 'hide',
      settingsOnly: true,
    });
    expect(field?.options?.map((o) => o.value)).toEqual(['hide', 'show']);
    expect(filterFields('project')).toEqual([]);
    expect(
      currentValues('project', { filters: { past: 'show' } }, emptySnapshot()),
    ).toEqual({ past: 'show' });
    // A value it does not have reads as the default.
    expect(
      currentValues('project', { filters: { past: 'all' } }, emptySnapshot()),
    ).toEqual({});
    expect(
      effectiveQuery('project', q('past=show'), {
        past: 'show',
        view: 'board',
      }).toString(),
    ).toBe('view=board');
    expect(planChange('project', { past: 'show' }, {})).toEqual({
      url: {},
      pin: {},
      patch: { filters: { past: 'show' } },
    });
    // The default is saved as nothing.
    expect(planChange('project', { past: 'hide' }, {})).toEqual({
      url: {},
      pin: {},
      patch: { filters: { past: null } },
    });
  });

  it('reads a saved Meetings shows as Hide (#320)', () => {
    for (const meetings of ['upcoming', 'all']) {
      expect(
        currentValues('project', { filters: { meetings } }, emptySnapshot()),
      ).toEqual({});
      expect(effectiveQuery('project', q(''), { meetings }).toString()).toBe(
        '',
      );
    }
  });
});

describe('the task page', () => {
  it('is listed in Settings → Pages', () => {
    expect(hasPageSettings('task')).toBe(true);
    expect(PAGES.task.sectionKeys).toBeUndefined();
  });

  it('reads Source note as saved, else Expanded', () => {
    expect(sourceNoteShow('collapsed')).toBe('collapsed');
    expect(sourceNoteShow('hidden')).toBe('hidden');
    expect(sourceNoteShow('expanded')).toBe('expanded');
    expect(sourceNoteShow('')).toBe('expanded');
    expect(sourceNoteShow('folded')).toBe('expanded');
    expect(
      currentValues(
        'task',
        { filters: { sourceNote: 'hidden' } },
        emptySnapshot(),
      ),
    ).toEqual({ sourceNote: 'hidden' });
    expect(filterFields('task')).toEqual([]);
    expect(effectiveQuery('task', q('sourceNote=hidden'), {}).toString()).toBe(
      '',
    );
  });

  it('counts only its Notes among remembered sections', () => {
    const prefs = { sections: { notes: false, gone: true } };
    expect(sectionCounts(prefs, PAGES.task.collapsible)).toEqual({
      closed: 1,
      open: 0,
    });
  });
});
