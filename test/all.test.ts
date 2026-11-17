import { describe, expect, it } from 'vitest';
import {
  type AllFilters,
  activeAllFilters,
  allQuery,
  allTags,
  clearedAllFilters,
  defaultAllFilters,
  filtersFor,
  parseAllQuery,
  rowStatus,
  selectAll,
  sortsFor,
} from '#shared/all';
import { selectProjects } from '#shared/projects';
import { DEFAULT_TASK_FILTERS, selectTasks } from '#shared/tasks';
import {
  emptySnapshot,
  type Meeting,
  type Note,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

const AT = '2026-11-16T09:00:00.000Z';
const TODAY = '2026-11-16';

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    org: '',
    status: 'active',
    health: 'none',
    priority: 'none',
    targetDate: '',
    tags: [],
    desc: '',
    state: '',
    members: [],
    links: [],
    milestones: [],
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
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
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
    ...patch,
  };
}

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    projectId: null,
    body: id,
    pinned: false,
    meetingId: null,
    phase: null,
    createdAt: AT,
    ...patch,
  };
}

function meeting(id: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    projectId: null,
    title: id,
    date: TODAY,
    time: '',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  } as Meeting;
}

function person(id: string, patch: Partial<Person> = {}): Person {
  return { id, name: id, role: '', me: false, ...patch };
}

const state: Snapshot = {
  ...emptySnapshot(),
  projects: {
    echo: project('echo', {
      name: 'Echo Base',
      tags: ['Ops'],
      members: ['leia'],
      updatedAt: '2026-11-10T09:00:00.000Z',
    }),
    hoth: project('hoth', { name: 'Hoth', status: 'done' }),
    old: project('old', { name: 'Old', archived: true }),
  },
  tasks: {
    t1: task('t1', {
      title: 'Shield generator',
      projectId: 'echo',
      due: '2026-11-15',
      assignee: 'han',
      tags: ['ops'],
      updatedAt: '2026-11-14T09:00:00.000Z',
    }),
    t2: task('t2', {
      title: 'Pick a base',
      decide: true,
      due: '2026-11-30',
      updatedAt: '2026-11-15T09:00:00.000Z',
    }),
    t3: task('t3', {
      title: 'Wait on parts',
      projectId: 'echo',
      assignee: 'me',
      blocked: { on: 'leia', note: '' },
    }),
    t4: task('t4', { title: 'Done thing', status: 'done' }),
    t5: task('t5', { title: 'Archived thing', projectId: 'old' }),
  },
  notes: {
    n1: note('n1', {
      body: 'Talked to @{leia} about shields',
      projectId: 'echo',
      createdAt: '2026-11-13T09:00:00.000Z',
    }),
    n2: note('n2', {
      body: 'Loose thought',
      createdAt: '2026-11-15T09:00:00.000Z',
    }),
    n3: note('n3', { body: 'Old note', projectId: 'old' }),
  },
  meetings: {
    m1: meeting('m1', {
      title: 'Standup',
      projectId: 'echo',
      date: '2026-11-17',
      attendees: ['leia'],
    }),
    m2: meeting('m2', { title: 'Retro', date: '2026-11-10' }),
  },
  people: {
    leia: person('leia', { name: 'Leia', role: 'General' }),
    han: person('han', { name: 'Han' }),
    me: person('me', { name: 'Me', me: true }),
  },
};

const ids = (filters: Partial<AllFilters>) =>
  selectAll(state, { ...defaultAllFilters(filters.kinds), ...filters }, TODAY)
    .map((r) => r.id)
    .sort();

describe('parseAllQuery and allQuery', () => {
  it('reads the defaults from an empty query and writes none back', () => {
    const filters = parseAllQuery(new URLSearchParams());
    expect(filters).toEqual(defaultAllFilters());
    expect(Object.values(allQuery(filters)).every((v) => v === null)).toBe(
      true,
    );
  });

  it('round-trips kinds, filters and sort', () => {
    const query =
      'kind=task,project&q=base&room=echo&person=me&status=done&due=week&tag=ops&decide=1&waiting=1&sort=title&dir=desc';
    const filters = parseAllQuery(new URLSearchParams(query));
    expect(filters).toEqual({
      kinds: ['task', 'project'],
      q: 'base',
      room: 'echo',
      person: 'me',
      status: 'done',
      due: 'week',
      tag: 'ops',
      decide: true,
      waiting: true,
      sort: 'title',
      dir: 'desc',
    });
    const back = new URLSearchParams({ kind: 'task,project' });
    for (const [key, value] of Object.entries(allQuery(filters))) {
      if (value) back.set(key, value);
    }
    expect(parseAllQuery(back)).toEqual(filters);
  });

  it('reads values it does not have as the defaults', () => {
    const filters = parseAllQuery(
      new URLSearchParams('status=nope&due=soon&sort=priority'),
    );
    expect(filters.status).toBe('open');
    expect(filters.due).toBe('');
    // Priority is a sort for tasks or projects alone.
    expect(filters.sort).toBe('updated');
    expect(
      parseAllQuery(new URLSearchParams('kind=task&sort=priority')).sort,
    ).toBe('priority');
  });
});

describe('the filters and sorts the kinds offer', () => {
  it('offers task filters only with tasks', () => {
    expect(filtersFor(['note'])).toEqual(['room', 'person', 'status']);
    expect(filtersFor(['person'])).toEqual(['room', 'person']);
    expect(filtersFor(['project'])).toEqual([
      'room',
      'person',
      'status',
      'tag',
    ]);
    expect(filtersFor([])).toEqual([
      'room',
      'person',
      'status',
      'due',
      'tag',
      'decide',
      'waiting',
    ]);
  });

  it('sorts tasks and projects alone as their pages did', () => {
    expect(sortsFor(['task']).map((s) => s.value)).toContain('assignee');
    expect(sortsFor(['project']).map((s) => s.value)).toContain('milestone');
    expect(sortsFor(['task', 'note']).map((s) => s.value)).toEqual([
      'updated',
      'title',
      'date',
    ]);
  });

  it('counts the filters on, not Find, and clears them but not the sort', () => {
    const filters = parseAllQuery(
      new URLSearchParams('kind=note&q=x&room=echo&waiting=1&sort=title'),
    );
    // Waiting on does not fit notes: not offered, not counted.
    expect(activeAllFilters(filters)).toEqual(['room']);
    expect(clearedAllFilters(filters)).toEqual({
      ...defaultAllFilters(['note']),
      sort: 'title',
    });
  });
});

describe('selectAll', () => {
  it('shows every open item of every kind by default', () => {
    expect(ids({})).toEqual(
      ['echo', 'han', 'leia', 'm1', 'me', 'n1', 'n2', 't1', 't2', 't3'].sort(),
    );
  });

  it('keeps Tasks’ selector and sort for tasks alone', () => {
    const filters = parseAllQuery(
      new URLSearchParams('kind=task&sort=priority&dir=desc&status=all'),
    );
    const classic = selectTasks(
      state,
      {
        ...DEFAULT_TASK_FILTERS,
        status: 'all',
        group: 'none',
        sort: 'priority',
        dir: 'desc',
      },
      TODAY,
      'me',
    )[0]?.rows.map((t) => t.id);
    expect(selectAll(state, filters, TODAY).map((r) => r.id)).toEqual(classic);
  });

  it('keeps Projects’ selector and sort for projects alone', () => {
    const filters = parseAllQuery(
      new URLSearchParams('kind=project&sort=name&status=all'),
    );
    const live = selectProjects(
      state.projects,
      { status: 'all', health: '', org: '', sort: 'name' },
      false,
      TODAY,
    ).map((p) => p.id);
    expect(selectAll(state, filters, TODAY).map((r) => r.id)).toEqual([
      ...live.slice(0, 1),
      'hoth',
      'old',
    ]);
  });

  it('reads Status per kind: done tasks, past meetings, archived items', () => {
    expect(ids({ status: 'done' })).toEqual(['hoth', 'm2', 't4']);
    expect(ids({ status: 'archived' })).toEqual(['n3', 'old', 't5']);
    expect(
      rowStatus(
        { kind: 'note', id: 'n2', item: state.notes.n2 as Note },
        state.projects,
        TODAY,
      ),
    ).toBe('open');
  });

  it('filters by room, people included as its members', () => {
    expect(ids({ room: 'echo' })).toEqual([
      'echo',
      'leia',
      'm1',
      'n1',
      't1',
      't3',
    ]);
    expect(ids({ room: 'general', kinds: ['task', 'note'] })).toEqual([
      'n2',
      't2',
    ]);
  });

  it('filters by person across kinds', () => {
    // Waited on, mentioned, attending, a member, and herself.
    expect(ids({ person: 'leia' })).toEqual(['echo', 'leia', 'm1', 'n1', 't3']);
    expect(ids({ person: 'me', kinds: ['task'] })).toEqual(['t3']);
  });

  it('leaves out the kinds a task filter does not fit', () => {
    expect(ids({ due: 'overdue' })).toEqual(['t1']);
    expect(ids({ decide: true })).toEqual(['t2']);
    expect(ids({ waiting: true })).toEqual(['t3']);
    expect(ids({ tag: 'OPS' })).toEqual(['echo', 't1']);
  });

  it('ignores a filter the kinds do not offer', () => {
    expect(ids({ kinds: ['note'], waiting: true })).toEqual(['n1', 'n2']);
  });

  it('finds words with each kind’s own Find', () => {
    // A mention reads as the name; a meeting's attendees count.
    expect(ids({ q: 'leia' })).toEqual(['leia', 'm1', 'n1']);
    expect(ids({ q: 'base' })).toEqual(['echo', 't2']);
  });

  it('sorts several kinds together', () => {
    const rows = selectAll(
      state,
      { ...defaultAllFilters(['task', 'note']), sort: 'updated' },
      TODAY,
    ).map((r) => r.id);
    expect(rows.slice(0, 4)).toEqual(['t3', 'n2', 't2', 't1']);
    const byTitle = selectAll(
      state,
      { ...defaultAllFilters(['task', 'meeting']), sort: 'title' },
      TODAY,
    ).map((r) => r.id);
    expect(byTitle).toEqual(['t2', 't1', 'm1', 't3']);
  });

  it('keeps notes newest first and meetings soonest first alone', () => {
    expect(
      selectAll(state, defaultAllFilters(['note']), TODAY).map((r) => r.id),
    ).toEqual(['n2', 'n1']);
    expect(
      selectAll(
        state,
        { ...defaultAllFilters(['meeting']), status: 'all' },
        TODAY,
      ).map((r) => r.id),
    ).toEqual(['m2', 'm1']);
  });
});

describe('allTags', () => {
  it('lists each tag once, ignoring case, as first written', () => {
    expect(allTags(state)).toEqual(['ops']);
  });
});
