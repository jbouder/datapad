import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  navExtrasOf,
  navHiddenOf,
  navOf,
  navOrderOf,
} from '#shared/nav';

describe('navOf', () => {
  it('is today’s nav without preferences', () => {
    expect(navOf({})).toEqual([...NAV_SECTIONS]);
    expect(navOf({ nav: {} })).toEqual([
      'focus',
      'projects',
      'tasks',
      'meetings',
      'notes',
    ]);
  });

  it('follows the saved order and leaves out the hidden', () => {
    expect(
      navOf({
        nav: {
          order: ['notes', 'tasks', 'focus', 'projects', 'meetings'],
          hidden: ['meetings', 'focus'],
        },
      }),
    ).toEqual(['notes', 'tasks', 'projects']);
  });

  it('ignores unknown and repeated names', () => {
    expect(
      navOf({
        nav: {
          order: ['reports', 'notes', 'notes', 'focus'],
          hidden: ['people', 'focus'],
        },
      }),
    ).toEqual(['notes', 'projects', 'tasks', 'meetings']);
  });

  it('puts a section missing from the saved order at its default place', () => {
    // A saved order from before Meetings, say: it comes back after Tasks.
    expect(
      navOrderOf({ order: ['tasks', 'focus', 'projects', 'notes'] }),
    ).toEqual(['tasks', 'meetings', 'focus', 'projects', 'notes']);
    // The first section, when missing, goes first.
    expect(navOrderOf({ order: ['notes', 'projects'] })).toEqual([
      'focus',
      'notes',
      'projects',
      'tasks',
      'meetings',
    ]);
  });

  it('keeps at least one section visible', () => {
    const nav = {
      order: ['tasks', 'focus', 'projects', 'meetings', 'notes'],
      hidden: [...NAV_SECTIONS],
    };
    expect(navOf({ nav })).toEqual(['tasks']);
    expect(navHiddenOf(nav).has('tasks')).toBe(false);
  });
});

describe('navExtrasOf', () => {
  it('shows every extra unless switched off', () => {
    expect(navExtrasOf({})).toEqual({
      activeProjects: true,
      digest: true,
      archived: true,
    });
    expect(navExtrasOf({ nav: { extras: { digest: false } } })).toEqual({
      activeProjects: true,
      digest: false,
      archived: true,
    });
  });
});
