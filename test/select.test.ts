import { describe, expect, it } from 'vitest';
import { addDays } from '#shared/dates';
import {
  DEFAULT_PROJECT_FILTERS,
  projectMatches,
  projectSortOf,
  selectProjects,
} from '#shared/projects';
import { ExportSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import {
  activeProjects,
  agenda,
  assigneeFromQuery,
  assigneeToQuery,
  byPriority,
  FOCUS_DAYS,
  type FocusBuckets,
  focusBuckets,
  focusDue,
  GENERAL_KEY,
  meId,
  mentionsOf,
  nextMilestones,
  notesOfMeeting,
  notesOfTask,
  openCounts,
  orgs,
  peopleStats,
  statsFor,
  taskNoteCounts,
  tasksOfMeeting,
} from '#shared/select';
import {
  emptySnapshot,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';
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

describe('byPriority', () => {
  it('groups High to No priority, keeping order, leaving out empty groups', () => {
    const t = (id: string, priority: Task['priority']) =>
      ({ id, priority }) as Task;
    const groups = byPriority([
      t('a', 'low'),
      t('b', 'high'),
      t('c', 'none'),
      t('d', 'high'),
    ]);
    expect(groups.map((g) => [g.priority, ids(g.tasks)])).toEqual([
      ['high', ['b', 'd']],
      ['low', ['a']],
      ['none', ['c']],
    ]);
    expect(byPriority([])).toEqual([]);
  });
});

describe('focusDue', () => {
  const t = (id: string, priority: Task['priority']) =>
    ({ id, priority }) as Task;
  const buckets: FocusBuckets = {
    blocked: [t('blocked', 'high')],
    overdue: [t('overdue', 'low')],
    today: [t('today', 'none')],
    upcoming: [t('soon', 'high'), t('soon-low', 'low')],
    later: [t('later', 'high'), t('later-med', 'med')],
    noDate: [t('undated', 'high'), t('undated-none', 'none')],
  };

  it('adds High priority whatever its date to the view’s buckets', () => {
    expect(ids(focusDue(buckets, ['overdue', 'today']))).toEqual([
      'overdue',
      'today',
      'soon',
      'later',
      'undated',
    ]);
    expect(ids(focusDue(buckets, ['overdue', 'today', 'upcoming']))).toEqual([
      'overdue',
      'today',
      'soon',
      'soon-low',
      'later',
      'undated',
    ]);
  });
});

describe('focusBuckets', () => {
  // Friday 23 October 2026: the next seven days run to Thursday the 29th.
  const today = '2026-10-23';
  const state = withTasks(
    { id: 'yesterday', due: '2026-10-22' },
    { id: 'today', due: '2026-10-23' },
    { id: 'tomorrow', due: '2026-10-24' },
    { id: 'monday', due: '2026-10-26' },
    { id: 'thursday', due: '2026-10-29' },
    { id: 'friday', due: '2026-10-30' },
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

  it('buckets at the day boundaries, upcoming over the next seven days', () => {
    const b = focusBuckets(state.tasks, state.projects, today, null, anyone);
    expect(ids(b.overdue)).toEqual(['yesterday']);
    expect(ids(b.today)).toEqual(['today']);
    // A Friday sees next week's Monday, up to a week from today.
    expect(ids(b.upcoming)).toEqual(['tomorrow', 'monday', 'thursday']);
    expect(ids(b.later)).toEqual(['friday']);
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
    expect(ids(b.upcoming)).toEqual(['monday', 'thursday', 'friday']);
    expect(ids(b.later)).toEqual([]);
  });

  it('agrees with the agenda on how far ahead Week looks', () => {
    const b = focusBuckets(state.tasks, state.projects, today, null, anyone);
    expect(FOCUS_DAYS).toBe(7);
    expect(b.upcoming.at(-1)?.due).toBe(addDays(today, FOCUS_DAYS - 1));
  });

  it('looks as many days ahead as Focus is set to', () => {
    const at = (days: number) =>
      focusBuckets(state.tasks, state.projects, today, null, anyone, days);
    expect(ids(at(3).upcoming)).toEqual(['tomorrow']);
    expect(ids(at(3).later)).toEqual(['monday', 'thursday', 'friday']);
    expect(ids(at(14).upcoming)).toEqual([
      'tomorrow',
      'monday',
      'thursday',
      'friday',
    ]);
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

  it('is memoized on its arguments', () => {
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

  it('counts and lists a task’s notes, newest first', () => {
    let state = withTasks({ id: 'a' }, { id: 'b' });
    const ops = [
      { id: 'n1', taskId: 'a', at: '2026-10-23T10:00:00.000Z' },
      { id: 'n2', taskId: 'a', at: '2026-10-23T11:00:00.000Z' },
      { id: 'n3', taskId: undefined, at: '2026-10-23T12:00:00.000Z' },
    ];
    for (const o of ops) {
      state = reduce(
        state,
        {
          type: 'addNote',
          id: o.id,
          projectId: null,
          body: o.id,
          taskId: o.taskId,
        },
        o.at,
      ).state;
    }
    const counts = taskNoteCounts(state.notes);
    expect(counts.get('a')).toBe(2);
    expect(counts.has('b')).toBe(false);
    expect(notesOfTask(state.notes, 'a').map((n) => n.id)).toEqual([
      'n2',
      'n1',
    ]);
  });

  it('lists a meeting’s notes newest first, legacy phase or not', () => {
    // The fixture's n-2 is an old Prep note (`phase: 'pre'`).
    expect(s.notes['n-2']?.phase).toBe('pre');
    let state = s;
    state = reduce(
      state,
      {
        type: 'addNote',
        id: 'n-new',
        projectId: 'p-echo',
        body: 'Later thought',
        meetingId: 'e-1',
      },
      '2026-10-28T09:00:00.000Z',
    ).state;
    expect(state.notes['n-new']?.phase).toBeNull();
    expect(notesOfMeeting(state.notes, 'e-1').map((n) => n.id)).toEqual([
      'n-new',
      'n-2',
    ]);
    expect(notesOfMeeting(state.notes, 'nope')).toEqual([]);
  });

  it('lists a meeting’s action items, open oldest first, then done', () => {
    const t = (id: string, patch: Partial<Task>): Task => ({
      id,
      title: id,
      projectId: null,
      status: 'open',
      priority: 'none',
      due: '',
      desc: '',
      tags: [],
      assignee: '',
      links: [],
      order: 1,
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
      completedAt: null,
      meetingId: 'e1',
      ...patch,
    });
    const tasks = {
      b: t('b', { createdAt: '2026-10-23T11:00:00.000Z' }),
      a: t('a', {}),
      d1: t('d1', { status: 'done', completedAt: '2026-10-24T10:00:00.000Z' }),
      d2: t('d2', { status: 'done', completedAt: '2026-10-25T10:00:00.000Z' }),
      other: t('other', { meetingId: 'e2' }),
      loose: t('loose', { meetingId: undefined }),
    };
    const { open, done } = tasksOfMeeting(tasks, 'e1');
    expect(ids(open)).toEqual(['a', 'b']);
    expect(ids(done)).toEqual(['d2', 'd1']);
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

  it('finds the next milestone per project', () => {
    const next = nextMilestones(s.projects, '2026-10-23');
    expect(next.get('p-echo')?.id).toBe('e-2');
    // Only Echo Base has milestones.
    expect([...next.keys()]).toEqual(['p-echo']);
    // Today counts; the day after it, nothing is next.
    expect(nextMilestones(s.projects, '2026-11-14').get('p-echo')?.id).toBe(
      'e-2',
    );
    expect(nextMilestones(s.projects, '2026-11-15').size).toBe(0);
  });

  it('picks the soonest milestone, by date then title', () => {
    const projects = {
      p: {
        ...(s.projects['p-echo'] as Project),
        id: 'p',
        milestones: [
          { id: 'old', title: 'Done', date: '2026-10-01' },
          { id: 'b', title: 'Beta', date: '2026-11-01' },
          { id: 'a', title: 'Alpha', date: '2026-11-01' },
        ],
      },
    };
    expect(nextMilestones(projects, '2026-10-23').get('p')?.id).toBe('a');
  });

  it('lists the next seven days of meetings', () => {
    expect(
      agenda(s.meetings, s.projects, '2026-10-23').map((e) => e.id),
    ).toEqual(['e-1']);
    expect(
      agenda(s.meetings, s.projects, '2026-10-21').map((e) => e.id),
    ).toEqual(['e-1']);
    expect(agenda(s.meetings, s.projects, '2026-10-20')).toEqual([]);
  });

  it('looks as many days ahead as Focus is set to', () => {
    // The shield review is on the 27th.
    expect(agenda(s.meetings, s.projects, '2026-10-23', 3)).toEqual([]);
    expect(
      agenda(s.meetings, s.projects, '2026-10-20', 14).map((e) => e.id),
    ).toEqual(['e-1']);
  });

  it('puts milestones in the agenda with meetings, all day first', () => {
    const echo = s.projects['p-echo'] as Project;
    const projects = {
      ...s.projects,
      'p-echo': {
        ...echo,
        milestones: [
          { id: 'm-past', title: 'Old', date: '2026-10-22' },
          { id: 'm-same', title: 'Shields up', date: '2026-10-27' },
          { id: 'm-first', title: 'Doors hung', date: '2026-10-24' },
          { id: 'm-far', title: 'Too far', date: '2026-10-30' },
        ],
      },
      // Archived: its milestones stay off the agenda.
      'p-yavin': {
        ...(s.projects['p-yavin'] as Project),
        milestones: [{ id: 'm-arch', title: 'Medals', date: '2026-10-25' }],
      },
    };
    const meetings = {
      ...s.meetings,
      allDay: {
        ...(s.meetings['e-1'] as (typeof s.meetings)[string]),
        id: 'allDay',
        title: 'Ridge walk',
        date: '2026-10-27',
        time: '',
        end: '',
      },
    };
    const items = agenda(meetings, projects, '2026-10-23');
    expect(items.map((a) => [a.kind, a.id])).toEqual([
      ['milestone', 'm-first'],
      // The 27th: the all-day items by title, then the 14:00 meeting.
      ['meeting', 'allDay'],
      ['milestone', 'm-same'],
      ['meeting', 'e-1'],
    ]);
    const first = items[0];
    expect(first?.kind === 'milestone' && first.project.name).toBe(
      'Echo Base relocation',
    );
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

  it('finds by every word in the name, org, tags or description (#270)', () => {
    const all = { ...DEFAULT_PROJECT_FILTERS, status: 'all' as const };
    const base = s.projects['p-echo'];
    const projects = {
      a: {
        ...base,
        id: 'a',
        name: 'Hoth Relay',
        org: 'Rebel Alliance',
        tags: ['comms'],
        desc: 'Keep the **shield** up.',
      },
      b: {
        ...base,
        id: 'b',
        name: 'Endor Moon',
        org: 'Ewok Council',
        tags: ['forest'],
        desc: '',
      },
    } as typeof s.projects;
    const find = (q: string) =>
      ids(selectProjects(projects, { ...all, sort: 'name', q }));
    expect(find('')).toEqual(['b', 'a']);
    expect(find('  ')).toEqual(['b', 'a']);
    expect(find('hoth')).toEqual(['a']);
    expect(find('EWOK')).toEqual(['b']);
    expect(find('forest')).toEqual(['b']);
    expect(find('shield')).toEqual(['a']);
    // Every word, from any of the fields.
    expect(find('relay comms')).toEqual(['a']);
    expect(find('relay forest')).toEqual([]);
    expect(projectMatches(projects.a as Project, 'rebel shield')).toBe(true);
  });

  it('finds and sorts in the archive, ignoring the other filters', () => {
    const base = s.projects['p-yavin'];
    const projects = {
      ...s.projects,
      z: { ...base, id: 'z', name: 'Zeta Base', archived: true },
    } as typeof s.projects;
    const filters = {
      ...DEFAULT_PROJECT_FILTERS,
      status: 'paused' as const,
      sort: 'name' as const,
    };
    expect(ids(selectProjects(projects, filters, true))).toEqual([
      'p-yavin',
      'z',
    ]);
    expect(
      ids(selectProjects(projects, { ...filters, q: 'zeta' }, true)),
    ).toEqual(['z']);
  });

  it('reads the sort from a query, else the default', () => {
    expect(projectSortOf(new URLSearchParams('sort=name'))).toBe('name');
    expect(projectSortOf(new URLSearchParams('sort=nope'))).toBe('updated');
    expect(projectSortOf(new URLSearchParams())).toBe('updated');
  });

  it('filters by health; unset health matches no color', () => {
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

  it('sorts by the next milestone on or after today, none last', () => {
    const base = s.projects['p-echo'] as Project;
    const projects = {
      a: {
        ...base,
        id: 'a',
        name: 'Alpha',
        milestones: [{ id: 'a1', title: 'Late', date: '2026-12-01' }],
      },
      b: {
        ...base,
        id: 'b',
        name: 'Bravo',
        // Its past one does not count; the next is in November.
        milestones: [
          { id: 'b0', title: 'Gone', date: '2026-10-01' },
          { id: 'b1', title: 'Soon', date: '2026-11-02' },
        ],
      },
      c: { ...base, id: 'c', name: 'Charlie', milestones: [] },
      d: {
        ...base,
        id: 'd',
        name: 'Delta',
        milestones: [{ id: 'd0', title: 'Over', date: '2026-10-02' }],
      },
    };
    const all = { ...DEFAULT_PROJECT_FILTERS, status: 'all' as const };
    expect(
      ids(
        selectProjects(
          projects,
          { ...all, sort: 'milestone' },
          false,
          '2026-10-23',
        ),
      ),
    ).toEqual(['b', 'a', 'c', 'd']);
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
