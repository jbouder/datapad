import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  navExtrasOf,
  navHiddenOf,
  navOf,
  navOrderOf,
  navPhoneHiddenOf,
  navPhoneOf,
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
      'whiteboard',
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
      // Whiteboard, unnamed, follows Notes as it does by default.
    ).toEqual(['notes', 'whiteboard', 'tasks', 'projects']);
  });

  it('ignores unknown and repeated names', () => {
    expect(
      navOf({
        nav: {
          order: ['reports', 'notes', 'notes', 'focus'],
          hidden: ['people', 'focus'],
        },
      }),
    ).toEqual(['notes', 'whiteboard', 'projects', 'tasks', 'meetings']);
  });

  it('puts a section missing from the saved order at its default place', () => {
    // A saved order from before Meetings, say: it comes back after Tasks.
    expect(
      navOrderOf({ order: ['tasks', 'focus', 'projects', 'notes'] }),
    ).toEqual([
      'tasks',
      'meetings',
      'focus',
      'projects',
      'notes',
      'whiteboard',
    ]);
    // The first section, when missing, goes first.
    expect(navOrderOf({ order: ['notes', 'projects'] })).toEqual([
      'focus',
      'notes',
      'whiteboard',
      'projects',
      'tasks',
      'meetings',
    ]);
  });

  it('keeps at least one section visible', () => {
    const nav = {
      order: ['tasks', 'focus', 'projects', 'meetings', 'notes', 'whiteboard'],
      hidden: [...NAV_SECTIONS],
    };
    expect(navOf({ nav })).toEqual(['tasks']);
    expect(navHiddenOf(nav).has('tasks')).toBe(false);
  });
});

describe('navPhoneOf', () => {
  it('leaves the Whiteboard out of the tab bar by default', () => {
    expect(navPhoneOf({})).toEqual([
      'focus',
      'projects',
      'tasks',
      'meetings',
      'notes',
    ]);
    expect(navPhoneHiddenOf(undefined)).toEqual(new Set(['whiteboard']));
  });

  it('follows the saved list for the sections it names', () => {
    // Saved with every section known: Whiteboard on, Notes off.
    const nav = {
      order: [...NAV_SECTIONS],
      hidden: ['meetings'],
      phoneHidden: ['notes'],
    };
    expect(navPhoneOf({ nav })).toEqual([
      'focus',
      'projects',
      'tasks',
      'whiteboard',
    ]);
    // A hidden section is not on the phone either.
    expect(navPhoneOf({ nav: { ...nav, hidden: ['whiteboard'] } })).toEqual([
      'focus',
      'projects',
      'tasks',
      'meetings',
    ]);
  });

  it('gives a section the saved lists never name its default', () => {
    // Saved before the Whiteboard existed: Notes off the phone, nothing
    // said about the Whiteboard, which stays off the phone.
    expect(navPhoneOf({ nav: { phoneHidden: ['notes', 'people'] } })).toEqual([
      'focus',
      'projects',
      'tasks',
      'meetings',
    ]);
    // Named in the order (saved after it existed) and not in the list: on.
    expect(
      navPhoneOf({ nav: { order: [...NAV_SECTIONS], phoneHidden: [] } }),
    ).toEqual([...NAV_SECTIONS]);
  });

  it('keeps at least one section on the phone', () => {
    const nav = { order: ['notes', 'focus'], phoneHidden: [...NAV_SECTIONS] };
    expect(navPhoneOf({ nav })).toEqual(['notes']);
    // The first shown one, when the first in the order is hidden.
    expect(
      navPhoneOf({ nav: { ...nav, hidden: ['notes', 'whiteboard'] } }),
    ).toEqual(['focus']);
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
