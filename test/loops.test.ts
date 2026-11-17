import { describe, expect, it } from 'vitest';
import {
  byLoop,
  lanesOf,
  NOBODY,
  taskTouches,
  waitingCount,
  waitingOf,
  waitingPeople,
} from '#shared/loops';
import {
  emptySnapshot,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

const AT = '2026-11-16T09:00:00.000Z';

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    status: 'active',
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  } as Project;
}

function person(id: string, patch: Partial<Person> = {}): Person {
  return { id, name: id, role: '', me: false, ...patch };
}

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    projectId: null,
    status: 'open',
    priority: 'med',
    due: '',
    desc: '',
    assignee: '',
    tags: [],
    links: [],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
    ...patch,
  } as Task;
}

function state(parts: Partial<Snapshot>): Snapshot {
  return {
    ...emptySnapshot(),
    projects: {
      'p-echo': project('p-echo'),
      'p-old': project('p-old', { archived: true }),
    },
    people: {
      'pe-me': person('pe-me', { name: 'Me', me: true }),
      'pe-leia': person('pe-leia', { name: 'Leia' }),
      'pe-han': person('pe-han', { name: 'Han' }),
    },
    ...parts,
  };
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe('waitingOf', () => {
  it('is null for my tasks and unassigned ones', () => {
    expect(waitingOf(task('a', { assignee: 'pe-me' }), 'pe-me')).toBeNull();
    expect(waitingOf(task('a'), 'pe-me')).toBeNull();
  });

  it('is the assignee when it is someone else', () => {
    expect(waitingOf(task('a', { assignee: 'pe-leia' }), 'pe-me')).toBe(
      'pe-leia',
    );
    expect(waitingOf(task('a', { assignee: 'pe-me' }), null)).toBe('pe-me');
  });

  it('is who it is blocked on, or nobody', () => {
    const on = { on: 'pe-han', note: '' };
    expect(
      waitingOf(task('a', { assignee: 'pe-me', blocked: on }), 'pe-me'),
    ).toBe('pe-han');
    expect(
      waitingOf(task('a', { blocked: { on: null, note: 'vendor' } }), 'pe-me'),
    ).toBe(NOBODY);
    // Blocked on me: mine to unblock.
    expect(
      waitingOf(task('a', { blocked: { on: 'pe-me', note: '' } }), 'pe-me'),
    ).toBeNull();
  });
});

describe('lanesOf', () => {
  const s = state({
    tasks: {
      mine: task('mine', { assignee: 'pe-me', due: '2026-11-20' }),
      free: task('free', { due: '2026-11-18' }),
      undated: task('undated'),
      leia: task('leia', { assignee: 'pe-leia' }),
      leia2: task('leia2', { assignee: 'pe-leia', due: '2026-11-17' }),
      han: task('han', {
        assignee: 'pe-me',
        blocked: { on: 'pe-han', note: '' },
      }),
      vendor: task('vendor', { blocked: { on: null, note: 'vendor' } }),
      decide: task('decide', { decide: true, assignee: 'pe-leia' }),
      decideBlocked: task('decideBlocked', {
        decide: true,
        blocked: { on: 'pe-han', note: '' },
      }),
      done: task('done', { status: 'done', completedAt: AT }),
      archived: task('archived', { projectId: 'p-old' }),
      live: task('live', { projectId: 'p-echo', due: '2026-11-19' }),
    },
  });
  const lanes = lanesOf(s, 'pe-me');

  it('keeps my tasks and unassigned ones in Mine, by due then order', () => {
    expect(ids(lanes.mine)).toEqual(['free', 'live', 'mine', 'undated']);
  });

  it('puts every task to decide in To decide, whatever else it is', () => {
    expect(ids(lanes.decide)).toEqual(['decide', 'decideBlocked']);
  });

  it('groups Waiting on by person, most first, nobody last', () => {
    expect(lanes.waiting.map((g) => [g.personId, ids(g.tasks)])).toEqual([
      ['pe-leia', ['leia2', 'leia']],
      ['pe-han', ['han']],
      [NOBODY, ['vendor']],
    ]);
    expect(waitingCount(lanes)).toBe(4);
  });

  it('leaves out done tasks and archived projects', () => {
    const all = [
      ...lanes.mine,
      ...lanes.decide,
      ...lanes.waiting.flatMap((g) => g.tasks),
    ];
    expect(ids(all)).not.toContain('done');
    expect(ids(all)).not.toContain('archived');
  });

  it('with nobody marked as me, assigned tasks wait on their assignee', () => {
    const none = lanesOf(s, null);
    expect(ids(none.mine)).toEqual(['free', 'live', 'undated']);
    expect(none.waiting.map((g) => g.personId)).toContain('pe-me');
  });

  it('keeps only what `keep` passes', () => {
    const echo = lanesOf(s, 'pe-me', (t) => t.projectId === 'p-echo');
    expect(ids(echo.mine)).toEqual(['live']);
    expect(echo.waiting).toEqual([]);
    expect(echo.decide).toEqual([]);
  });

  it('breaks ties by manual order, then title', () => {
    const a = task('a', { order: 2 });
    const b = task('b', { order: 1 });
    const c = task('c', { order: 1, title: 'a' });
    expect([a, b, c].sort(byLoop).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('names the groups whose person exists', () => {
    expect(waitingPeople(lanes, s.people).map((g) => g.person.id)).toEqual([
      'pe-leia',
      'pe-han',
    ]);
  });
});

describe('taskTouches', () => {
  it('is true when assigned to, blocked on or mentioning the person', () => {
    expect(taskTouches(task('a', { assignee: 'pe-leia' }), 'pe-leia')).toBe(
      true,
    );
    expect(
      taskTouches(
        task('a', { blocked: { on: 'pe-leia', note: '' } }),
        'pe-leia',
      ),
    ).toBe(true);
    expect(
      taskTouches(task('a', { desc: 'Ask @{pe-leia} first' }), 'pe-leia'),
    ).toBe(true);
  });

  it('is false otherwise', () => {
    expect(taskTouches(task('a', { assignee: 'pe-han' }), 'pe-leia')).toBe(
      false,
    );
    expect(
      taskTouches(task('a', { blocked: { on: null, note: '' } }), 'pe-leia'),
    ).toBe(false);
  });
});
