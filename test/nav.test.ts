import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  navExtrasOf,
  navHiddenOf,
  navOf,
  navOrderOf,
  QUICK_ADD_ACTIONS,
  quickAddOf,
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

describe('quickAddOf', () => {
  it('is Add task, then Write a note, by default', () => {
    expect(quickAddOf({})).toEqual(['task', 'note']);
    expect(quickAddOf({ nav: { quickAdd: {} } })).toEqual(['task', 'note']);
  });

  it('follows the saved order and leaves out the hidden', () => {
    expect(
      quickAddOf({
        nav: {
          quickAdd: {
            order: ['meeting', 'note', 'project', 'task'],
            hidden: ['note'],
          },
        },
      }),
    ).toEqual(['meeting', 'project', 'task']);
  });

  it('ignores unknown and repeated names', () => {
    expect(
      quickAddOf({
        nav: {
          quickAdd: {
            order: ['template', 'note', 'note', 'meeting', 'task', 'project'],
            hidden: ['template', 'project'],
          },
        },
      }),
    ).toEqual(['note', 'meeting', 'task']);
  });

  it('gives an action the saved list never names its default', () => {
    // Saved before Add project existed, say: it comes back after Add
    // meeting, hidden as it is by default, and nothing else moves.
    expect(
      quickAddOf({
        nav: {
          quickAdd: { order: ['meeting', 'note', 'task'], hidden: ['note'] },
        },
      }),
    ).toEqual(['meeting', 'task']);
    // A shown-by-default action missing from the list stays shown.
    expect(
      quickAddOf({
        nav: { quickAdd: { order: ['note', 'meeting'], hidden: [] } },
      }),
    ).toEqual(['task', 'note', 'meeting']);
  });

  it('keeps at least one action shown', () => {
    expect(
      quickAddOf({
        nav: {
          quickAdd: {
            order: ['project', 'task', 'note', 'meeting'],
            hidden: [...QUICK_ADD_ACTIONS],
          },
        },
      }),
    ).toEqual(['project']);
  });
});
