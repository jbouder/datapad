import { describe, expect, it } from 'vitest';
import {
  currentValues,
  effectiveQuery,
  filterFields,
  hasPageSettings,
  PAGES,
  sectionCounts,
  sectionOrder,
  sourceNoteShow,
  toggleSection,
  visibleSections,
} from '#shared/pages';
import { emptySnapshot } from '#shared/types';

/** The project page's and the task page's settings (#312). */

const q = (s: string) => new URLSearchParams(s);

describe('the project room', () => {
  it('has the three lanes as its sections (#334)', () => {
    expect(sectionOrder('project', {})).toEqual(['mine', 'waiting', 'decide']);
    expect(PAGES.project.label).toBe('Project room');
  });

  it('ignores what the project page saved for its old sections', () => {
    const prefs = {
      order: ['notes', 'decide', 'tasks', 'mine'],
      hidden: ['whiteboard', 'waiting'],
    };
    expect(visibleSections('project', prefs)).toEqual(['decide', 'mine']);
    expect(toggleSection('project', {}, 'decide', false)).toEqual({
      hidden: ['decide'],
    });
    expect(toggleSection('project', {}, 'notes', false)).toBeNull();
  });

  it('has no fields: what the project page saved adds nothing (#334)', () => {
    expect(PAGES.project.fields).toEqual([]);
    expect(filterFields('project')).toEqual([]);
    expect(
      currentValues('project', { filters: { past: 'show' } }, emptySnapshot()),
    ).toEqual({});
    expect(
      effectiveQuery('project', q(''), {
        past: 'show',
        view: 'board',
      }).toString(),
    ).toBe('');
  });

  it('remembers its lanes, Milestones and Activity open or closed', () => {
    const prefs = {
      sections: { mine: false, activity: true, notes: false, done: true },
    };
    expect(sectionCounts(prefs, PAGES.project.collapsible)).toEqual({
      closed: 1,
      open: 1,
    });
    expect(hasPageSettings('project')).toBe(true);
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
