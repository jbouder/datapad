import { describe, expect, it } from 'vitest';
import {
  allLayout,
  allQuery,
  defaultSort,
  parseAllQuery,
  viewQuery,
} from '#shared/all';
import { captureOps, parseCapture } from '#shared/capture';
import { migrateSettings } from '#shared/migrate';
import {
  ALL_KINDS_SETTING,
  allHome,
  allHomeKinds,
  allHomeValue,
  allSortDefaults,
  briefOn,
  currentValues,
  PAGES,
  savedFocusOptions,
  savedPrefs,
} from '#shared/pages';
import { ExportSchema, type Op } from '#shared/protocol';
import { recapWindow } from '#shared/recap';
import { reduce } from '#shared/reducer';
import { projectHome, roomLink } from '#shared/rooms';
import { FOCUS_DEFAULTS } from '#shared/select';
import { resetSection } from '#shared/settings';
import { weekAround } from '#shared/today';
import {
  DEFAULT_SETTINGS,
  emptySnapshot,
  PAGE_KEYS,
  SETTINGS_ID,
  type Snapshot,
  settingsOf,
} from '#shared/types';

const T1 = '2026-11-16T12:00:00.000Z';
/** A Monday. */
const MONDAY = '2026-11-16';

function apply(state: Snapshot, ...ops: Op[]): Snapshot {
  return ops.reduce((s, op) => reduce(s, op, T1).state, state);
}

function withPeople(): Snapshot {
  return apply(
    emptySnapshot(),
    { type: 'addPerson', id: 'han', name: 'Han Solo' },
    { type: 'addPerson', id: 'leia', name: 'Leia', me: true },
    { type: 'createProject', id: 'falcon', name: 'Falcon Refit' },
  );
}

describe('a fresh space (#343)', () => {
  it('has every option at its one default, and nothing stored', () => {
    const fresh = emptySnapshot();
    expect(fresh.settings[SETTINGS_ID]).toBeUndefined();
    expect(settingsOf(fresh)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      defaultOrg: '',
      assignToMe: false,
      defaultPriority: 'med',
      pinned: [],
      captureAs: 'note',
      mentionAssigns: true,
      roomNotes: 'room',
      railOwed: true,
      roomTab: 'stream',
      laneLabels: {
        youOwe: 'You owe',
        theyOwe: 'They owe you',
        discuss: 'To discuss',
      },
    });
  });

  it('reads every page option as its default from the one table', () => {
    const fresh = emptySnapshot();
    for (const page of PAGE_KEYS) {
      expect(savedPrefs(fresh, page)).toEqual({});
      expect(currentValues(page, {}, fresh)).toEqual({});
      for (const field of PAGES[page].fields) {
        expect(typeof field.def).toBe('string');
      }
    }
    // Today: Focus's defaults, the week from Monday, Brief me on.
    expect(savedFocusOptions(fresh)).toEqual(FOCUS_DEFAULTS);
    expect(FOCUS_DEFAULTS.weekStart).toBe('mon');
    expect(briefOn(undefined)).toBe(true);
    const today = PAGES.focus.fields.map((f) => [f.key, f.def]);
    expect(today).toEqual([
      ['who', 'anyone'],
      ['days', '7'],
      ['weekStart', 'mon'],
      ['brief', 'on'],
    ]);
    // All: on Tasks, each kind as a list, their own first sorts.
    expect(allHome(fresh)).toEqual(['task']);
    const all = Object.fromEntries(PAGES.all.fields.map((f) => [f.key, f.def]));
    expect(all).toEqual({
      kinds: 'task',
      taskView: 'list',
      meetingView: 'list',
      projectView: 'list',
      taskSort: 'due',
      projectSort: 'updated',
    });
  });
});

describe('All’s opening kinds and sorts (#343)', () => {
  it('reads the kinds saved, every kind, or Tasks', () => {
    expect(allHomeKinds(undefined)).toEqual(['task']);
    expect(allHomeKinds('all')).toEqual([]);
    expect(allHomeKinds('note,task')).toEqual(['task', 'note']);
    expect(allHomeKinds('nope')).toEqual(['task']);
    expect(allHomeValue([])).toBe('all');
    expect(allHomeValue(['note', 'task'])).toBe('task,note');
  });

  it('opens on what Settings → All saved', () => {
    const state = apply(withPeople(), {
      type: 'setPagePrefs',
      page: 'all',
      patch: { filters: { [ALL_KINDS_SETTING]: 'meeting,project' } },
    });
    expect(allHome(state)).toEqual(['meeting', 'project']);
    const every = apply(withPeople(), {
      type: 'setPagePrefs',
      page: 'all',
      patch: { filters: { [ALL_KINDS_SETTING]: 'all' } },
    });
    expect(allHome(every)).toEqual([]);
  });

  it('starts a kind alone at its saved sort, and writes no sort for it', () => {
    const sorts = allSortDefaults({ taskSort: 'priority', projectSort: 'x' });
    expect(sorts).toEqual({ task: 'priority' });
    expect(defaultSort(['task'], sorts)).toBe('priority');
    expect(defaultSort(['project'], sorts)).toBe('updated');
    expect(defaultSort(['task', 'note'], sorts)).toBe('updated');
    const tasks = parseAllQuery(new URLSearchParams('kind=task'), sorts);
    expect(tasks.sort).toBe('priority');
    expect(allQuery(tasks, sorts).sort).toBeNull();
    // Due, now not the default, goes in the address.
    expect(allQuery({ ...tasks, sort: 'due' }, sorts).sort).toBe('due');
    // A saved view spells the sort out, so a later default leaves it be.
    expect(viewQuery(tasks)).toBe('kind=task&sort=priority');
  });

  it('opens a kind alone on its saved layout', () => {
    const tasks = parseAllQuery(new URLSearchParams('kind=task'));
    expect(allLayout(tasks, { taskView: 'board' })).toBe('board');
    expect(allLayout(tasks, {})).toBe('list');
  });
});

describe('Today’s week start (#343)', () => {
  it('starts the week zoom on Monday, or on Sunday', () => {
    expect(weekAround(MONDAY)).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
    expect(weekAround(MONDAY, 'sun')).toEqual({
      from: '2026-11-15',
      to: '2026-11-21',
    });
    expect(weekAround('2026-11-15', 'sun').from).toBe('2026-11-15');
    expect(weekAround('2026-11-22', 'sun').from).toBe('2026-11-22');
  });

  it('moves the recap’s weekend with it', () => {
    expect(recapWindow(MONDAY)).toEqual({
      from: '2026-11-13',
      to: '2026-11-15',
      label: 'Since Friday',
    });
    // A Sunday start: Sunday is the first working day, back to Thursday.
    expect(recapWindow('2026-11-15', 'sun')).toEqual({
      from: '2026-11-12',
      to: '2026-11-14',
      label: 'Since Thursday',
    });
    // Saturday, the week's last day, back over Friday to Thursday.
    expect(recapWindow('2026-11-14', 'sun')).toEqual({
      from: '2026-11-12',
      to: '2026-11-13',
      label: 'Since Thursday',
    });
    expect(recapWindow(MONDAY, 'sun').label).toBe('Yesterday');
  });

  it('is read from what Today saved', () => {
    const state = apply(withPeople(), {
      type: 'setPagePrefs',
      page: 'focus',
      patch: { filters: { weekStart: 'sun', brief: 'off' } },
    });
    expect(savedFocusOptions(state).weekStart).toBe('sun');
    expect(
      briefOn(currentValues('focus', savedPrefs(state, 'focus'), state).brief),
    ).toBe(false);
  });
});

describe('capture defaults (#343)', () => {
  const set = (patch: Record<string, unknown>) =>
    apply(withPeople(), {
      type: 'setSettings',
      patch,
    } as Op);

  it('makes a plain line a task when set to', () => {
    const state = set({ captureAs: 'task' });
    const capture = parseCapture('Check the hyperdrive', state, MONDAY);
    expect(capture.kind).toBe('task');
    expect(captureOps(capture, state, 't1')[0]).toMatchObject({
      type: 'addTask',
      title: 'Check the hyperdrive',
      priority: 'med',
    });
    // A forced note is still a note.
    expect(
      parseCapture('Check the hyperdrive', state, MONDAY, {}, 'note').kind,
    ).toBe('note');
  });

  it('leaves a task unassigned by @Name when set to', () => {
    const state = set({ mentionAssigns: false });
    const capture = parseCapture('todo fix it @Han Solo', state, MONDAY);
    expect(capture.kind).toBe('task');
    expect(capture.assignee).toBe('');
    expect(capture.people).toEqual(['han']);
    expect(
      parseCapture('todo fix it @Han Solo', withPeople(), MONDAY).assignee,
    ).toBe('han');
  });

  it('sends a room’s note to Unfiled when set to; tasks still file there', () => {
    const state = set({ roomNotes: 'unfiled' });
    const room = { projectId: 'falcon' };
    const note = parseCapture('Ask about parts', state, MONDAY, room);
    expect(note.projectId).toBeNull();
    expect(note.unfiled).toBe(true);
    const task = parseCapture('todo ask about parts', state, MONDAY, room);
    expect(task.projectId).toBe('falcon');
    // A #word still files the note.
    expect(
      parseCapture('Ask #falcon about parts', state, MONDAY, room).projectId,
    ).toBe('falcon');
    // By default, the room.
    expect(
      parseCapture('Ask about parts', withPeople(), MONDAY, room).projectId,
    ).toBe('falcon');
  });

  it('starts captured tasks at the default priority', () => {
    const state = set({ defaultPriority: 'high' });
    const capture = parseCapture('todo plan it', state, MONDAY);
    expect(captureOps(capture, state, 't1')[0]).toMatchObject({
      priority: 'high',
    });
  });
});

describe('rooms (#343)', () => {
  it('opens a project room on the tab Settings → Rooms names', () => {
    expect(projectHome('falcon', withPeople())).toEqual({
      name: 'project',
      id: 'falcon',
    });
    const plan = apply(withPeople(), {
      type: 'setSettings',
      patch: { roomTab: 'plan' },
    });
    expect(projectHome('falcon', plan)).toEqual({
      name: 'project',
      id: 'falcon',
      tab: 'plan',
    });
    const board = apply(withPeople(), {
      type: 'setSettings',
      patch: { roomTab: 'whiteboard' },
    });
    expect(roomLink({ kind: 'project', id: 'falcon' }, board).route).toEqual({
      name: 'whiteboard',
      project: 'falcon',
    });
  });
});

describe('Reset to defaults (#343)', () => {
  it('has nothing to reset in a fresh space', () => {
    for (const section of ['today', 'rooms', 'capture', 'all'] as const) {
      expect(resetSection(section, emptySnapshot())).toBeNull();
    }
  });

  it('clears Capture’s options and undoes it', () => {
    const before = apply(withPeople(), {
      type: 'setSettings',
      patch: {
        captureAs: 'task',
        defaultPriority: 'low',
        defaultOrg: 'Rebellion',
        railOwed: false,
      },
    });
    const reset = resetSection('capture', before);
    expect(reset).not.toBeNull();
    const after = apply(before, ...(reset?.ops ?? []));
    expect(after.settings[SETTINGS_ID]).toEqual({
      defaultOrg: 'Rebellion',
      railOwed: false,
    });
    expect(resetSection('capture', after)).toBeNull();
    const undone = apply(after, ...(reset?.undo ?? []));
    expect(undone.settings[SETTINGS_ID]).toEqual(before.settings[SETTINGS_ID]);
  });

  it('unpins and clears Rooms’ options and both rooms’ lanes', () => {
    const before = apply(
      withPeople(),
      {
        type: 'setSettings',
        patch: {
          pinned: ['falcon'],
          roomTab: 'plan',
          laneLabels: { theyOwe: 'Owed' },
        },
      },
      { type: 'setPagePrefs', page: 'person', patch: { hidden: ['decide'] } },
      { type: 'setPagePrefs', page: 'project', patch: { order: ['decide'] } },
    );
    const reset = resetSection('rooms', before);
    const after = apply(before, ...(reset?.ops ?? []));
    expect(after.settings[SETTINGS_ID]).toEqual({ defaultOrg: '', pages: {} });
    expect(settingsOf(after).pinned).toEqual([]);
    expect(savedPrefs(after, 'person')).toEqual({});
    expect(savedPrefs(after, 'project')).toEqual({});
    const undone = apply(after, ...(reset?.undo ?? []));
    expect(undone.settings[SETTINGS_ID]).toEqual(before.settings[SETTINGS_ID]);
  });

  it('resets Today and meeting mode together', () => {
    const before = apply(
      withPeople(),
      {
        type: 'setPagePrefs',
        page: 'focus',
        patch: { filters: { who: 'mine' }, hidden: ['waiting'] },
      },
      {
        type: 'setPagePrefs',
        page: 'meeting',
        patch: { filters: { covered: 'hide' } },
      },
    );
    const reset = resetSection('today', before);
    const after = apply(before, ...(reset?.ops ?? []));
    expect(savedPrefs(after, 'focus')).toEqual({});
    expect(savedPrefs(after, 'meeting')).toEqual({});
    const undone = apply(after, ...(reset?.undo ?? []));
    expect(savedPrefs(undone, 'focus')).toEqual(savedPrefs(before, 'focus'));
    expect(savedPrefs(undone, 'meeting')).toEqual(
      savedPrefs(before, 'meeting'),
    );
  });

  it('resets All but keeps its saved views', () => {
    const views = [{ id: 'v1', name: 'Mine', query: 'kind=task&person=me' }];
    const before = apply(withPeople(), {
      type: 'setPagePrefs',
      page: 'all',
      patch: { filters: { taskView: 'board', kinds: 'all' }, views },
    });
    const reset = resetSection('all', before);
    const after = apply(before, ...(reset?.ops ?? []));
    expect(savedPrefs(after, 'all')).toEqual({ views });
    expect(resetSection('all', after)).toBeNull();
    const undone = apply(after, ...(reset?.undo ?? []));
    expect(savedPrefs(undone, 'all')).toEqual(savedPrefs(before, 'all'));
  });
});

describe('carrying old page settings over (#343)', () => {
  const old = {
    defaultOrg: '',
    pages: {
      focus: { filters: { who: 'mine', days: '10' } },
      tasks: { view: 'board', sort: 'priority', filters: { status: 'all' } },
      meetings: { view: 'calendar' },
      projects: { view: 'cards', sort: 'name' },
      notes: { view: 'grid' },
      lists: { view: 'table' },
    },
  };

  it('maps the old pages’ layouts and sorts to All’s, and keeps them', () => {
    const out = migrateSettings({ settings: { user: old } }) as {
      settings: { user: typeof old & { pages: { all?: unknown } } };
    };
    expect(out.settings.user.pages.all).toEqual({
      filters: {
        taskView: 'board',
        meetingView: 'calendar',
        projectView: 'cards',
        taskSort: 'priority',
        projectSort: 'name',
      },
    });
    // The retired pages and Focus stay as stored.
    expect(out.settings.user.pages.tasks).toEqual(old.pages.tasks);
    expect(out.settings.user.pages.lists).toEqual(old.pages.lists);
    expect(out.settings.user.pages.focus).toEqual(old.pages.focus);
  });

  it('leaves what All has no place for, and what is the default', () => {
    const input = {
      settings: {
        user: {
          defaultOrg: '',
          pages: {
            tasks: { view: 'timeline', sort: 'due' },
            meetings: { view: 'list' },
            projects: { view: 'table', sort: 'updated' },
          },
        },
      },
    };
    expect(migrateSettings(input)).toBe(input);
  });

  it('runs once: a space that saved anything for All is left alone', () => {
    const once = migrateSettings({ settings: { user: old } });
    expect(migrateSettings(once)).toBe(once);
    const saved = {
      settings: {
        user: { ...old, pages: { ...old.pages, all: { views: [] } } },
      },
    };
    expect(migrateSettings(saved)).toBe(saved);
    expect(migrateSettings({ tasks: {} })).toEqual({ tasks: {} });
  });

  it('imports an old export with Focus’s as Today’s and the pages’ in All', () => {
    for (const format of [undefined, 2, 3]) {
      const parsed = ExportSchema.parse({
        ...(format ? { format } : {}),
        settings: { user: old },
      });
      const state = { ...emptySnapshot(), settings: parsed.settings };
      expect(savedFocusOptions(state).who).toEqual({ kind: 'anyone' });
      expect(savedFocusOptions(state).days).toBe(10);
      expect(savedPrefs(state, 'all').filters).toMatchObject({
        taskView: 'board',
        projectSort: 'name',
      });
    }
  });
});
