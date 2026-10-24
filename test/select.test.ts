import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_FILTERS, selectProjects } from '#shared/projects';
import { ExportSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import {
  activeProjects,
  agenda,
  assigneeFor,
  assigneeFromQuery,
  assigneeToQuery,
  focusBuckets,
  GENERAL_KEY,
  meId,
  mentionsOf,
  nextMarkers,
  openCounts,
  orgs,
  peopleStats,
  statsFor,
} from '#shared/select';
import { emptySnapshot, type Snapshot, type Task } from '#shared/types';
import { dropIndex, moveItem } from '../src/lib/reorder';
import fixture from './fixtures/export.json';

const NOW = '2026-10-23T10:00:00.000Z';

function seeded(): Snapshot {
  const { exportedAt: _, ...state } = ExportSchema.parse(fixture);
  return state;
}

function withTasks(...tasks: Array<Partial<Task> & { id: string }>): Snapshot {
  let state = emptySnapshot();
  for (const t of tasks) {
    state = reduce(
      state,
      { type: 'addTask', id: t.id, projectId: null, title: t.id, due: t.due },
      NOW,
    ).state;
  }
  return state;
}

const anyone = { kind: 'anyone' } as const;
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe('focusBuckets', () => {
  // Friday 23 October 2026: this week ends on Sunday the 25th.
  const today = '2026-10-23';
  const state = withTasks(
    { id: 'yesterday', due: '2026-10-22' },
    { id: 'today', due: '2026-10-23' },
    { id: 'tomorrow', due: '2026-10-24' },
    { id: 'sunday', due: '2026-10-25' },
    { id: 'monday', due: '2026-10-26' },
    { id: 'undated' },
  );

  it('puts blocked tasks first, in Blocked only, whatever their date', () => {
    const blocked = {
      ...state.tasks,
      yesterday: {
        ...state.tasks.yesterday,
        blocked: { on: null, note: '' },
      },
    } as typeof state.tasks;
    const b = focusBuckets(blocked, state.projects, today, null, anyone);
    expect(ids(b.blocked)).toEqual(['yesterday']);
    expect(ids(b.overdue)).toEqual([]);
    expect(Object.keys(b)[0]).toBe('blocked');
  });

  it('buckets at the day boundaries, this week through Sunday', () => {
    const b = focusBuckets(state.tasks, state.projects, today, null, anyone);
    expect(ids(b.overdue)).toEqual(['yesterday']);
    expect(ids(b.today)).toEqual(['today']);
    expect(ids(b.thisWeek)).toEqual(['tomorrow', 'sunday']);
    expect(ids(b.later)).toEqual(['monday']);
    expect(ids(b.noDate)).toEqual(['undated']);
  });

  it('moves everything along a day after midnight', () => {
    const b = focusBuckets(
      state.tasks,
      state.projects,
      '2026-10-24',
      null,
      anyone,
    );
    expect(ids(b.overdue)).toEqual(['yesterday', 'today']);
    expect(ids(b.today)).toEqual(['tomorrow']);
    expect(ids(b.thisWeek)).toEqual(['sunday']);
  });

  it('on a Sunday this week is empty; Monday starts a new week', () => {
    const sunday = focusBuckets(
      state.tasks,
      state.projects,
      '2026-10-25',
      null,
      anyone,
    );
    expect(ids(sunday.today)).toEqual(['sunday']);
    expect(ids(sunday.thisWeek)).toEqual([]);
    expect(ids(sunday.later)).toEqual(['monday']);
  });

  it('leaves out done tasks and archived projects, and filters by assignee', () => {
    const s = seeded();
    const all = focusBuckets(s.tasks, s.projects, today, 'u-leia', anyone);
    const open = Object.values(all)
      .flat()
      .map((t: Task) => t.id);
    expect(open.sort()).toEqual(['t-1', 't-2', 't-4', 't-5', 't-6']);
    const mine = focusBuckets(s.tasks, s.projects, today, 'u-leia', {
      kind: 'mine',
    });
    expect(
      Object.values(mine)
        .flat()
        .map((t: Task) => t.id),
    ).toEqual(['t-1']);
    const nobody = focusBuckets(s.tasks, s.projects, today, 'u-leia', {
      kind: 'unassigned',
    });
    expect(
      Object.values(nobody)
        .flat()
        .map((t: Task) => t.id)
        .sort(),
    ).toEqual(['t-4', 't-6']);
    const chewie = focusBuckets(s.tasks, s.projects, today, null, {
      kind: 'person',
      id: 'u-chewie',
    });
    expect(
      Object.values(chewie)
        .flat()
        .map((t: Task) => t.id),
    ).toEqual(['t-2']);
  });

  it('is memoised on its arguments', () => {
    const a = focusBuckets(state.tasks, state.projects, today, null, anyone);
    expect(focusBuckets(state.tasks, state.projects, today, null, anyone)).toBe(
      a,
    );
    const next = reduce(
      state,
      { type: 'toggleTask', id: 'today', done: true },
      NOW,
    ).state;
    const b = focusBuckets(next.tasks, next.projects, today, null, anyone);
    expect(b).not.toBe(a);
    expect(ids(b.today)).toEqual([]);
  });
});

describe('other selectors', () => {
  const s = seeded();

  it('counts open tasks per project, General included', () => {
    const counts = openCounts(s.tasks);
    expect(counts.get('p-echo')).toBe(3);
    expect(counts.get('p-falcon')).toBe(1);
    expect(counts.get(GENERAL_KEY)).toBe(1);
    expect(counts.get('p-yavin')).toBeUndefined();
  });

  it('lists distinct orgs, sorted', () => {
    expect(orgs(s.projects)).toEqual([
      'Corellian Engineering',
      'Rebel Alliance',
    ]);
  });

  it('finds me', () => {
    expect(meId(s.people)).toBe('u-leia');
    expect(meId({})).toBeNull();
  });

  it('finds the next milestone or deadline per project', () => {
    const next = nextMarkers(s.events, '2026-10-23');
    expect(next.get('p-echo')?.id).toBe('e-2');
    // The demo is past and not a marker; General events have no project.
    expect(next.has('p-yavin')).toBe(false);
    expect([...next.keys()]).toEqual(['p-echo']);
  });

  it('lists the next seven days of events', () => {
    expect(agenda(s.events, s.projects, '2026-10-23').map((e) => e.id)).toEqual(
      ['e-1'],
    );
    expect(agenda(s.events, s.projects, '2026-10-21').map((e) => e.id)).toEqual(
      ['e-1'],
    );
    expect(agenda(s.events, s.projects, '2026-10-20')).toEqual([]);
  });

  it('finds every note and task that mentions a person', () => {
    const chewie = mentionsOf(s.notes, s.tasks, 'u-chewie');
    expect(chewie.notes.map((n) => n.id)).toEqual(['n-1', 'n-4']);
    expect(chewie.tasks).toEqual([]);
    expect(
      mentionsOf(s.notes, s.tasks, 'u-han').tasks.map((t) => t.id),
    ).toEqual(['t-1']);
  });

  it('lists active projects by most recently updated', () => {
    expect(activeProjects(s.projects).map((p) => p.id)).toEqual([
      'p-echo',
      'p-falcon',
    ]);
  });
});

describe('project filters and sorts', () => {
  const s = seeded();
  const ids = (list: { id: string }[]) => list.map((p) => p.id);

  it('defaults to active, unarchived projects, recently updated first', () => {
    expect(ids(selectProjects(s.projects, DEFAULT_PROJECT_FILTERS))).toEqual([
      'p-echo',
    ]);
    expect(
      ids(
        selectProjects(s.projects, {
          ...DEFAULT_PROJECT_FILTERS,
          status: 'all',
        }),
      ),
    ).toEqual(['p-echo', 'p-falcon']);
  });

  it('filters by org and lists the archive separately', () => {
    const all = { ...DEFAULT_PROJECT_FILTERS, status: 'all' as const };
    expect(
      ids(selectProjects(s.projects, { ...all, org: 'Corellian Engineering' })),
    ).toEqual(['p-falcon']);
    expect(ids(selectProjects(s.projects, all, true))).toEqual(['p-yavin']);
  });

  it('filters by health; unset health matches no colour', () => {
    const all = { ...DEFAULT_PROJECT_FILTERS, status: 'all' as const };
    const projects = {
      ...s.projects,
      'p-echo': { ...s.projects['p-echo'], health: 'red' as const },
    };
    expect(ids(selectProjects(projects, { ...all, health: 'red' }))).toEqual([
      'p-echo',
    ]);
    expect(ids(selectProjects(projects, { ...all, health: 'green' }))).toEqual(
      [],
    );
    expect(ids(selectProjects(projects, { ...all, health: '' }))).toHaveLength(
      2,
    );
  });

  it('sorts by priority then name, by name, and by target date', () => {
    const projects = {
      a: {
        ...s.projects['p-echo'],
        id: 'a',
        name: 'Bravo',
        priority: 'low',
        startDate: '2026-10-01',
        targetDate: '',
      },
      b: {
        ...s.projects['p-echo'],
        id: 'b',
        name: 'Alpha',
        priority: 'low',
        startDate: '',
        targetDate: '2026-12-01',
      },
      c: {
        ...s.projects['p-echo'],
        id: 'c',
        name: 'Charlie',
        priority: 'high',
        startDate: '2026-10-15',
        targetDate: '2026-11-01',
      },
      d: {
        ...s.projects['p-echo'],
        id: 'd',
        name: 'Delta',
        priority: 'none',
        startDate: '',
        targetDate: '2026-11-01',
      },
    } as typeof s.projects;
    const all = { ...DEFAULT_PROJECT_FILTERS, status: 'all' as const };
    expect(ids(selectProjects(projects, { ...all, sort: 'priority' }))).toEqual(
      ['c', 'b', 'a', 'd'],
    );
    expect(ids(selectProjects(projects, { ...all, sort: 'name' }))).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
    expect(ids(selectProjects(projects, { ...all, sort: 'start' }))).toEqual([
      'a',
      'c',
      'b',
      'd',
    ]);
    expect(ids(selectProjects(projects, { ...all, sort: 'target' }))).toEqual([
      'c',
      'd',
      'b',
      'a',
    ]);
  });
});

describe('reorder helpers', () => {
  it('moves an item and computes where a drop lands', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    // Dropping onto a row inserts before it.
    expect(dropIndex(0, 2)).toBe(1);
    expect(dropIndex(3, 1)).toBe(1);
    expect(dropIndex(1, 4)).toBe(3);
    expect(dropIndex(1, 1)).toBeNull();
    expect(dropIndex(1, 2)).toBeNull();
  });
});

describe('assignee filter in the URL', () => {
  it('round-trips every kind', () => {
    for (const value of ['anyone', 'mine', 'unassigned', 'p:u-leia']) {
      expect(assigneeToQuery(assigneeFromQuery(value))).toBe(value);
    }
  });

  it('reads anything else as anyone', () => {
    expect(assigneeFromQuery(null)).toEqual({ kind: 'anyone' });
    expect(assigneeFromQuery('p:')).toEqual({ kind: 'anyone' });
    expect(assigneeFromQuery('someone')).toEqual({ kind: 'anyone' });
  });

  it('pre-assigns quick-added tasks to Mine or the person', () => {
    expect(assigneeFor({ kind: 'mine' }, 'u-leia')).toBe('u-leia');
    expect(assigneeFor({ kind: 'mine' }, null)).toBe('');
    expect(assigneeFor({ kind: 'person', id: 'u-han' }, 'u-leia')).toBe(
      'u-han',
    );
    expect(assigneeFor({ kind: 'unassigned' }, 'u-leia')).toBe('');
    expect(assigneeFor({ kind: 'anyone' }, 'u-leia')).toBe('');
  });
});

describe('peopleStats', () => {
  it('lists projects (archived last) and open tasks outside the archive', () => {
    const s = seeded();
    const stats = peopleStats(s.projects, s.tasks);
    const leia = statsFor(stats, 'u-leia');
    expect(leia.projects.map((p) => p.id)).toEqual(['p-echo', 'p-yavin']);
    expect(leia.open.map((t) => t.id)).toEqual(['t-1']);
    const chewie = statsFor(stats, 'u-chewie');
    expect(chewie.projects.map((p) => p.id)).toEqual(['p-echo', 'p-falcon']);
    expect(chewie.open.map((t) => t.id)).toEqual(['t-2']);
    // Mon's only task is done, in an archived project.
    expect(statsFor(stats, 'u-mon').open).toEqual([]);
    expect(statsFor(stats, 'nobody')).toEqual({
      projects: [],
      open: [],
      waiting: [],
      decisions: [],
    });
  });

  it('lists open tasks blocked on someone as waiting on them', () => {
    const s = seeded();
    const tasks = {
      ...s.tasks,
      't-2': { ...s.tasks['t-2'], blocked: { on: 'u-leia', note: 'parts' } },
      't-3': { ...s.tasks['t-3'], blocked: { on: null, note: 'weather' } },
    } as typeof s.tasks;
    const stats = peopleStats(s.projects, tasks);
    expect(statsFor(stats, 'u-leia').waiting.map((t) => t.id)).toEqual(['t-2']);
  });
});
