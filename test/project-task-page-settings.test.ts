import { describe, expect, it } from 'vitest';
import {
  currentValues,
  effectiveQuery,
  filterFields,
  PAGES,
  sectionOrder,
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
});
