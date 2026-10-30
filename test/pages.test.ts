import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  applyPagePatch,
  clearFilters,
  currentValues,
  effectiveQuery,
  filterFields,
  focusDays,
  hasPagePrefs,
  isFiltered,
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

describe('how far Focus’s Week looks ahead', () => {
  it('is seven days unless a choice is saved', () => {
    expect(focusDays(undefined)).toBe(7);
    expect(focusDays(null)).toBe(7);
    expect(focusDays('14')).toBe(14);
    expect(focusDays('3')).toBe(3);
    // Not one of the choices: the default.
    expect(focusDays('6')).toBe(7);
    expect(focusDays('nope')).toBe(7);
  });

  it('is saved as a Focus filter and read back, a stale value dropped', () => {
    const s = state();
    const saved = applyPagePatch({}, { filters: { days: '10' } }) ?? {};
    expect(currentValues('focus', saved, s).days).toBe('10');
    expect(effectiveQuery('focus', q(''), { days: '10' }).get('days')).toBe(
      '10',
    );
    expect(
      currentValues('focus', { filters: { days: '6' } }, s).days,
    ).toBeUndefined();
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

  it('reads Notes’ old Feed as List, saved or in the address (#218)', () => {
    expect(effectiveQuery('notes', q(''), { view: 'feed' }).get('view')).toBe(
      'list',
    );
    expect(effectiveQuery('notes', q('view=feed'), {}).get('view')).toBe(
      'list',
    );
    expect(effectiveQuery('notes', q('view=grid'), {}).get('view')).toBe(
      'grid',
    );
    expect(currentValues('notes', { view: 'feed' }, state())).toEqual({
      view: 'list',
    });
    expect(PAGES.notes.fields[0]?.def).toBe('list');
  });

  it('reads Notes’ old Notepad layout as List (#261)', () => {
    expect(
      effectiveQuery('notes', q(''), { view: 'notepad' }).get('view'),
    ).toBe('list');
    expect(currentValues('notes', { view: 'notepad' }, state())).toEqual({
      view: 'list',
    });
    expect(PAGES.notes.fields[0]?.options?.map((o) => o.value)).toEqual([
      'list',
      'grid',
    ]);
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
    // Focus names its sections: an old bucket's saved state is not one.
    expect(
      sectionCounts(
        { sections: { attention: false, 'day:later': true, noDate: false } },
        PAGES.focus.sectionKeys,
      ),
    ).toEqual({ closed: 1, open: 0 });
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
      ['datapad:focus:waiting', 'closed'],
      // Buckets Focus no longer has (#206) drop out.
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
      focus: { sections: { waiting: false } },
    });
    for (const patch of Object.values(found)) {
      expect(PagePrefsPatchSchema.safeParse(patch).success).toBe(true);
    }
  });

  it('finds nothing in a browser that never chose', () => {
    expect(legacyPrefs([['datapad:space', 'main']])).toEqual({});
  });
});

describe('list filters (#269)', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('are the remembered fields that narrow, not layout, sort or grouping', () => {
    expect(filterFields('tasks').map((f) => f.key)).toEqual(['status', 'who']);
    expect(filterFields('notes').map((f) => f.key)).toEqual([
      'project',
      'pinned',
    ]);
    expect(filterFields('projects').map((f) => f.key)).toEqual([
      'status',
      'health',
      'org',
    ]);
    expect(filterFields('meetings').map((f) => f.key)).toEqual(['project']);
    expect(filterFields('people')).toEqual([]);
  });

  it('count each filter away from its default, and nothing else', () => {
    expect(activeFilterCount('tasks', q(''))).toBe(0);
    expect(activeFilterCount('tasks', q('status=open&who=anyone'))).toBe(0);
    expect(activeFilterCount('tasks', q('status=blocked'))).toBe(1);
    expect(activeFilterCount('tasks', q('status=all&who=mine'))).toBe(2);
    // Find, sort, direction, grouping and layout are not filters.
    expect(
      activeFilterCount(
        'tasks',
        q('q=vet&sort=title&dir=desc&group=none&view=board'),
      ),
    ).toBe(0);
    expect(activeFilterCount('notes', q('project=p1&pinned=1'))).toBe(2);
    expect(activeFilterCount('projects', q('status=all&health=red'))).toBe(2);
    expect(activeFilterCount('projects', q('status=active'))).toBe(0);
  });

  it('read a spelled-out default or a value the page lacks as no filter', () => {
    expect(activeFilterCount('notes', q('project=all&pinned=0'))).toBe(0);
    expect(activeFilterCount('projects', q('health=any&org=all'))).toBe(0);
    expect(activeFilterCount('tasks', q('status=someday'))).toBe(0);
    expect(activeFilterCount('tasks', q('status='))).toBe(0);
  });

  it('are on with a filter or words in Find', () => {
    expect(isFiltered('tasks', q(''))).toBe(false);
    expect(isFiltered('tasks', q('sort=title&group=due'))).toBe(false);
    expect(isFiltered('tasks', q('q=%20%20'))).toBe(false);
    expect(isFiltered('tasks', q('q=vet'))).toBe(true);
    expect(isFiltered('notes', q('pinned=1'))).toBe(true);
  });

  it('clear to the defaults and an empty Find, keeping sort and layout', () => {
    expect(clearFilters('tasks')).toEqual({
      q: null,
      status: null,
      who: null,
    });
    expect(clearFilters('notes')).toEqual({
      q: null,
      project: null,
      pinned: null,
    });
    const change = planChange('tasks', clearFilters('tasks'), {
      status: 'all',
      sort: 'title',
    });
    expect(change.url).toEqual({ q: null, status: null, who: null });
    expect(change.patch).toEqual({ filters: { status: null, who: null } });
  });
});

describe('Projects and Archived on the list toolbar (#270)', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('Clear filters keeps the sort on Projects', () => {
    expect(clearFilters('projects')).toEqual({
      q: null,
      status: null,
      health: null,
      org: null,
    });
  });

  it('Archived has Find and a saved sort, and no filters', () => {
    expect(PAGES.archive.fields.map((f) => f.key)).toEqual(['view', 'sort']);
    expect(filterFields('archive')).toEqual([]);
    expect(isFiltered('archive', q('sort=name'))).toBe(false);
    expect(isFiltered('archive', q('q=hoth'))).toBe(true);
    expect(clearFilters('archive')).toEqual({ q: null });
    expect(planChange('archive', { sort: 'name' }, {}).patch).toEqual({
      sort: 'name',
    });
  });
});
