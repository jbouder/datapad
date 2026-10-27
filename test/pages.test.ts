import { describe, expect, it } from 'vitest';
import {
  applyPagePatch,
  currentValues,
  effectiveQuery,
  hasPagePrefs,
  legacyPrefs,
  mergePatches,
  optionsFor,
  PAGES,
  planChange,
  prefsAsPatch,
  savedPrefs,
  sectionCounts,
} from '#shared/pages';
import { PagePrefsPatchSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import { emptySnapshot, PAGE_KEYS, type Snapshot } from '#shared/types';

const T1 = '2026-10-23T10:00:00.000Z';

/** Two projects (one archived), an org and two people, one of them you. */
function state(): Snapshot {
  return [
    { type: 'createProject', id: 'p1', name: 'Echo Base', org: 'Rebellion' },
    { type: 'createProject', id: 'p2', name: 'Hoth' },
    { type: 'archiveProject', id: 'p2' },
    { type: 'addPerson', id: 'u1', name: 'Leia Organa', me: true },
    { type: 'addPerson', id: 'u2', name: 'Han Solo' },
  ].reduce(
    (s, op) => reduce(s, op as never, T1).state,
    emptySnapshot() as Snapshot,
  );
}

const q = (s: string) => new URLSearchParams(s);

describe('the registry', () => {
  it('covers every page, the layout first', () => {
    expect(Object.keys(PAGES).sort()).toEqual([...PAGE_KEYS].sort());
    for (const page of PAGE_KEYS) {
      expect(PAGES[page].fields[0]?.key).toBe('view');
    }
  });

  it('never remembers the search text or a single item', () => {
    for (const page of PAGE_KEYS) {
      const keys = PAGES[page].fields.map((f) => f.key);
      for (const never of ['q', 'note', 'milestone', 'to', 'meeting']) {
        expect(keys).not.toContain(never);
      }
    }
  });

  it('spells out each empty default as something no data can be', () => {
    for (const page of PAGE_KEYS) {
      for (const field of PAGES[page].fields) {
        if (field.def === '') expect(field.token).toBeTruthy();
      }
    }
  });
});

describe('precedence: the address, then what is saved, then the default', () => {
  it('fills what the address lacks from what is saved', () => {
    const query = effectiveQuery('tasks', q('status=done&q=heaters'), {
      status: 'all',
      group: 'due',
      view: 'board',
    });
    expect(query.get('status')).toBe('done');
    expect(query.get('group')).toBe('due');
    expect(query.get('view')).toBe('board');
    expect(query.get('q')).toBe('heaters');
  });

  it('reads a spelled-out default as no filter', () => {
    const query = effectiveQuery('notes', q('project=all&pinned=0'), {
      project: 'p1',
      pinned: '1',
    });
    expect(query.has('project')).toBe(false);
    expect(query.has('pinned')).toBe(false);
  });

  it('leaves keys a page does not remember alone', () => {
    const query = effectiveQuery('archive', q(''), { status: 'done' });
    expect(query.toString()).toBe('');
  });
});

describe('planChange', () => {
  it('saves a change, and the address names it as before', () => {
    expect(planChange('tasks', { group: 'due' }, {})).toEqual({
      url: { group: 'due' },
      pin: { group: 'project' },
      patch: { group: 'due' },
    });
    // Back to the default: cleared in both.
    expect(planChange('tasks', { group: null }, { group: 'due' })).toEqual({
      url: { group: null },
      pin: { group: 'due' },
      patch: { group: null },
    });
  });

  it('pins what was shown, an empty default as its token', () => {
    expect(planChange('notes', { project: 'p1' }, {}).pin).toEqual({
      project: 'all',
    });
    expect(planChange('projects', { health: 'red' }, {}).pin).toEqual({
      health: 'any',
    });
    expect(planChange('notes', { project: null }, { project: 'p1' })).toEqual({
      url: { project: null },
      pin: { project: 'p1' },
      patch: { filters: { project: null } },
    });
  });

  it('reads a spelled-out default as the default', () => {
    expect(planChange('notes', { pinned: '0' }, { pinned: '1' }).patch).toEqual(
      { filters: { pinned: null } },
    );
  });

  it('passes the search text through, unsaved and unpinned', () => {
    expect(planChange('tasks', { q: 'heaters' }, {})).toEqual({
      url: { q: 'heaters' },
      pin: {},
      patch: null,
    });
  });

  it('takes a device default (Tasks opens on the list on phones)', () => {
    expect(
      planChange('tasks', { view: 'list' }, {}, { view: 'list' }).patch,
    ).toEqual({ view: null });
    expect(
      planChange('tasks', { view: 'table' }, {}, { view: 'list' }).patch,
    ).toEqual({ view: 'table' });
  });
});

describe('stale values fall back to the default', () => {
  it('drops a layout, sort or filter value the page no longer has', () => {
    const s = state();
    expect(
      currentValues(
        'tasks',
        {
          view: 'gallery',
          sort: 'title',
          dir: 'sideways',
          group: 'due',
          filters: { status: 'archived', who: 'p:u2', q: 'kept?' },
        },
        s,
      ),
    ).toEqual({ sort: 'title', group: 'due', who: 'p:u2' });
  });

  it('drops a person, project or org that is gone', () => {
    const s = state();
    expect(currentValues('tasks', { filters: { who: 'p:ghost' } }, s)).toEqual(
      {},
    );
    expect(
      currentValues('notes', { filters: { project: 'ghost' } }, s),
    ).toEqual({});
    expect(
      currentValues('meetings', { filters: { project: 'p2' } }, s),
    ).toEqual({ project: 'p2' });
    expect(
      currentValues('meetings', { filters: { project: 'general' } }, s),
    ).toEqual({ project: 'general' });
    expect(
      currentValues('projects', { filters: { org: 'Empire' } }, s),
    ).toEqual({});
    expect(
      currentValues('projects', { filters: { org: 'Rebellion' } }, s),
    ).toEqual({ org: 'Rebellion' });
  });

  it('offers the data’s choices in Settings', () => {
    const s = state();
    const who = PAGES.tasks.fields.find((f) => f.key === 'who');
    expect(who && optionsFor(who, s).map((o) => o.label)).toEqual([
      'Anyone',
      'Mine',
      'Unassigned',
      'Han Solo',
      'Leia Organa',
    ]);
    const project = PAGES.notes.fields.find((f) => f.key === 'project');
    expect(project && optionsFor(project, s).map((o) => o.label)).toEqual([
      'All projects',
      'General',
      'Echo Base',
      'Hoth (archived)',
    ]);
  });
});

describe('patches', () => {
  it('merge, the later winning key by key', () => {
    expect(
      mergePatches(
        { view: 'board', filters: { status: 'done' } },
        { view: null, filters: { who: 'mine' }, sections: { done: true } },
      ),
    ).toEqual({
      view: null,
      filters: { status: 'done', who: 'mine' },
      sections: { done: true },
    });
  });

  it('apply, and an emptied page is nothing', () => {
    expect(applyPagePatch(undefined, { view: null })).toBeUndefined();
    expect(
      applyPagePatch(
        { view: 'board', sections: { done: true } },
        {
          sections: { done: null, notes: false },
        },
      ),
    ).toEqual({ view: 'board', sections: { notes: false } });
  });

  it('save everything again for Undo', () => {
    const prefs = {
      view: 'board',
      dir: 'desc',
      filters: { status: 'done' },
      sections: { done: true },
    };
    const patch = prefsAsPatch(prefs);
    expect(PagePrefsPatchSchema.safeParse(patch).success).toBe(true);
    expect(applyPagePatch(undefined, patch)).toEqual(prefs);
  });

  it('count sections closed and open', () => {
    expect(
      sectionCounts({ sections: { a: false, b: false, c: true } }),
    ).toEqual({ closed: 2, open: 1 });
  });

  it('read nothing saved as empty', () => {
    const s = state();
    expect(hasPagePrefs(s)).toBe(false);
    expect(savedPrefs(s, 'tasks')).toEqual({});
    const next = reduce(
      s,
      { type: 'setPagePrefs', page: 'tasks', patch: { view: 'board' } },
      T1,
    ).state;
    expect(hasPagePrefs(next)).toBe(true);
    expect(savedPrefs(next, 'tasks')).toEqual({ view: 'board' });
  });
});

describe('carrying over this browser’s old keys', () => {
  it('maps layouts and sections; projects vote on theirs', () => {
    const found = legacyPrefs([
      ['datapad:view:tasks', 'board'],
      ['datapad:view:project-tasks', 'board'],
      ['datapad:view:dev', 'cards'],
      ['datapad:focus:day:later', 'open'],
      ['datapad:focus:noDate', 'closed'],
      ['datapad:section:p1:tasks', 'closed'],
      ['datapad:section:p2:tasks', 'closed'],
      ['datapad:section:p3:tasks', 'open'],
      ['datapad:section:p1:activity', 'open'],
      ['datapad:section:p1:notes', 'sideways'],
      ['datapad:theme', 'dark'],
    ]);
    expect(found).toEqual({
      tasks: { view: 'board' },
      project: { view: 'board', sections: { tasks: false, activity: true } },
      focus: { sections: { 'day:later': true, noDate: false } },
    });
    for (const patch of Object.values(found)) {
      expect(PagePrefsPatchSchema.safeParse(patch).success).toBe(true);
    }
  });

  it('finds nothing in a browser that never chose', () => {
    expect(legacyPrefs([['datapad:space', 'main']])).toEqual({});
  });
});
