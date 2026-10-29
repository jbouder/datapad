import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  NAV_TOOLS,
  navExtrasOf,
  navHiddenOf,
  navMenuToolsOf,
  navOf,
  navOrderOf,
  navPhoneHiddenOf,
  navPhoneOf,
  navPhoneToolsOf,
  navToolsOf,
  QUICK_ADD_ACTIONS,
  quickAddOf,
  toolsHiddenOf,
  toolsOrderOf,
  toolsPhoneHiddenOf,
  toolsPrefsOf,
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

  it('ignores unknown and repeated names, the Whiteboard among them', () => {
    expect(
      navOf({
        nav: {
          order: ['reports', 'notes', 'whiteboard', 'notes', 'focus'],
          hidden: ['people', 'focus', 'whiteboard'],
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
      order: ['tasks', 'focus', 'projects', 'meetings', 'notes', 'whiteboard'],
      hidden: [...NAV_SECTIONS, 'whiteboard'],
    };
    expect(navOf({ nav })).toEqual(['tasks']);
    expect(navHiddenOf(nav).has('tasks')).toBe(false);
  });
});

describe('navPhoneOf', () => {
  it('puts every section on the tab bar by default', () => {
    expect(navPhoneOf({})).toEqual([...NAV_SECTIONS]);
    expect(navPhoneHiddenOf(undefined)).toEqual(new Set());
  });

  it('follows the saved list, ignoring the Whiteboard', () => {
    const nav = {
      order: [...NAV_SECTIONS, 'whiteboard'],
      hidden: ['meetings'],
      phoneHidden: ['notes', 'whiteboard'],
    };
    expect(navPhoneOf({ nav })).toEqual(['focus', 'projects', 'tasks']);
    expect(navPhoneHiddenOf(nav)).toEqual(new Set(['notes']));
  });

  it('keeps at least one section on the phone', () => {
    const nav = { order: ['notes', 'focus'], phoneHidden: [...NAV_SECTIONS] };
    expect(navPhoneOf({ nav })).toEqual(['notes']);
    // The first shown one, when the first in the order is hidden.
    expect(navPhoneOf({ nav: { ...nav, hidden: ['notes'] } })).toEqual([
      'focus',
    ]);
  });
});

describe('the tools (#261)', () => {
  it('are Notepad, Whiteboard and Weekly digest, shown, off the tab bar', () => {
    expect(NAV_TOOLS).toEqual(['notepad', 'whiteboard', 'digest']);
    expect(navToolsOf({})).toEqual(['notepad', 'whiteboard', 'digest']);
    expect(navPhoneToolsOf({})).toEqual([]);
    // So a phone has every one in the account menu.
    expect(navMenuToolsOf({})).toEqual(['notepad', 'whiteboard', 'digest']);
    expect(toolsPrefsOf(undefined)).toEqual({
      order: ['notepad', 'whiteboard', 'digest'],
      hidden: [],
      phoneHidden: ['notepad', 'whiteboard', 'digest'],
    });
  });

  it('follow the saved order, hidden and phone lists', () => {
    const nav = {
      tools: {
        order: ['digest', 'notepad', 'whiteboard'],
        hidden: ['notepad'],
        phoneHidden: ['whiteboard'],
      },
    };
    expect(navToolsOf({ nav })).toEqual(['digest', 'whiteboard']);
    expect(navPhoneToolsOf({ nav })).toEqual(['digest']);
    expect(navMenuToolsOf({ nav })).toEqual(['whiteboard']);
    // Every tool can be hidden; the heading goes then.
    expect(
      navToolsOf({ nav: { tools: { ...nav.tools, hidden: [...NAV_TOOLS] } } }),
    ).toEqual([]);
  });

  it('ignore unknown and repeated names', () => {
    const nav = {
      tools: {
        order: ['reports', 'digest', 'digest', 'focus', 'notepad'],
        hidden: ['reports', 'focus'],
        phoneHidden: [],
      },
    };
    expect(toolsOrderOf(nav)).toEqual(['digest', 'notepad', 'whiteboard']);
    expect(toolsHiddenOf(nav)).toEqual(new Set());
  });

  it('give a tool the saved lists never name its place and defaults', () => {
    // Saved before the Weekly digest was a tool, say: it comes back after
    // the Whiteboard, shown and off the tab bar, and nothing else moves.
    const nav = {
      // Room on the tab bar for every tool.
      phoneHidden: ['notes', 'meetings'],
      tools: {
        order: ['whiteboard', 'notepad'],
        hidden: [],
        phoneHidden: [],
      },
    };
    expect(toolsOrderOf(nav)).toEqual(['whiteboard', 'digest', 'notepad']);
    expect(navToolsOf({ nav })).toEqual(['whiteboard', 'digest', 'notepad']);
    expect(navPhoneToolsOf({ nav })).toEqual(['whiteboard', 'notepad']);
    expect(toolsPhoneHiddenOf(nav)).toEqual(new Set(['digest']));
  });

  it('carry over the Whiteboard’s section settings until saved', () => {
    // Hidden as a section: hidden as a tool.
    expect(toolsHiddenOf({ hidden: ['whiteboard', 'notes'] })).toEqual(
      new Set(['whiteboard']),
    );
    // On the phone as a section (saved knowing it): on the phone as a tool.
    const onPhone = {
      order: [...NAV_SECTIONS, 'whiteboard'],
      phoneHidden: ['notes'],
    };
    expect(navPhoneToolsOf({ nav: onPhone })).toEqual(['whiteboard']);
    expect(navMenuToolsOf({ nav: onPhone })).toEqual(['notepad', 'digest']);
    // Off the phone, or never named: off, as by default.
    expect(
      toolsPhoneHiddenOf({ order: ['focus'], phoneHidden: ['notes'] }),
    ).toEqual(new Set(NAV_TOOLS));
    expect(
      toolsPhoneHiddenOf({ phoneHidden: ['whiteboard'], hidden: [] }),
    ).toEqual(new Set(NAV_TOOLS));
    // Once the tools are saved, the old lists say nothing about them.
    const saved = {
      hidden: ['whiteboard'],
      ...onPhone,
      tools: { order: [...NAV_TOOLS], hidden: [], phoneHidden: [...NAV_TOOLS] },
    };
    expect(navToolsOf({ nav: saved })).toEqual([...NAV_TOOLS]);
    expect(navPhoneToolsOf({ nav: saved })).toEqual([]);
  });

  it('carry over the Weekly digest’s rail extra until saved', () => {
    const nav = { extras: { digest: false } };
    expect(navToolsOf({ nav })).toEqual(['notepad', 'whiteboard']);
    expect(toolsPrefsOf(nav).hidden).toEqual(['digest']);
    expect(
      navToolsOf({
        nav: {
          ...nav,
          tools: { order: [...NAV_TOOLS], hidden: [], phoneHidden: [] },
        },
      }),
    ).toEqual([...NAV_TOOLS]);
  });

  it('fill the tab bar to six after the sections, the rest in the menu', () => {
    const nav = {
      tools: { order: [...NAV_TOOLS], hidden: [], phoneHidden: [] },
    };
    // Five sections and three tools: one tool fits.
    expect(navPhoneOf({ nav })).toHaveLength(5);
    expect(navPhoneToolsOf({ nav })).toEqual(['notepad']);
    expect(navMenuToolsOf({ nav })).toEqual(['whiteboard', 'digest']);
    // Two sections off the phone: all three fit.
    const room = { ...nav, phoneHidden: ['notes', 'meetings'] };
    expect(navPhoneToolsOf({ nav: room })).toEqual([...NAV_TOOLS]);
    expect(navMenuToolsOf({ nav: room })).toEqual([]);
  });
});

describe('navExtrasOf', () => {
  it('shows every extra unless switched off', () => {
    expect(navExtrasOf({})).toEqual({
      activeProjects: true,
      archived: true,
    });
    // The digest is a tool now (#261): not an extra.
    expect(
      navExtrasOf({ nav: { extras: { digest: false, archived: false } } }),
    ).toEqual({
      activeProjects: true,
      archived: false,
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
