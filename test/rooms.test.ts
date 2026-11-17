import { describe, expect, it } from 'vitest';
import {
  isPinned,
  movePin,
  OWED_MAX,
  owedBy,
  peopleByOwed,
  pinnedOf,
  pinnedRooms,
  projectRoomsByOrg,
  railRooms,
  roomKey,
  roomOf,
  unfiledCount,
  viewOf,
  withPin,
} from '#shared/rooms';
import {
  emptySnapshot,
  type Note,
  type Person,
  type Project,
  type Snapshot,
  settingsOf,
  type Task,
} from '#shared/types';

const AT = '2026-11-16T09:00:00.000Z';

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    status: 'active',
    health: 'green',
    org: '',
    description: '',
    state: '',
    tags: [],
    links: [],
    members: [],
    milestones: [],
    target: null,
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
    priority: 'medium',
    due: null,
    assignee: null,
    tags: [],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
    ...patch,
  } as Task;
}

function state(parts: Partial<Snapshot>): Snapshot {
  return { ...emptySnapshot(), ...parts };
}

const space = state({
  projects: {
    'p-echo': project('p-echo', { updatedAt: '2026-11-15T09:00:00.000Z' }),
    'p-falcon': project('p-falcon', { updatedAt: '2026-11-16T09:00:00.000Z' }),
    'p-done': project('p-done', { status: 'done' }),
    'p-old': project('p-old', { archived: true }),
  },
  people: {
    'pe-leia': person('pe-leia', { name: 'Leia' }),
    'pe-han': person('pe-han', { name: 'Han' }),
    'pe-me': person('pe-me', { name: 'Me', me: true }),
  },
});

describe('roomOf', () => {
  it('reads a project, a person and a pair', () => {
    expect(roomOf('p-echo', space)).toEqual({ kind: 'project', id: 'p-echo' });
    expect(roomOf('pe-leia', space)).toEqual({ kind: 'person', id: 'pe-leia' });
    expect(roomOf('p-echo+pe-leia', space)).toEqual({
      kind: 'pair',
      project: 'p-echo',
      person: 'pe-leia',
    });
  });

  it('is null for an entry that names nothing', () => {
    expect(roomOf('p-gone', space)).toBeNull();
    expect(roomOf('p-gone+pe-leia', space)).toBeNull();
    expect(roomOf('+pe-leia', space)).toBeNull();
    expect(roomOf('constructor', space)).toBeNull();
  });

  it('keys each back to its entry', () => {
    for (const entry of ['p-echo', 'pe-leia', 'p-echo+pe-leia']) {
      const room = roomOf(entry, space);
      expect(room && roomKey(room)).toBe(entry);
    }
  });

  it('reads a saved view on All while it exists (#338)', () => {
    const withViews = state({
      ...space,
      settings: {
        user: {
          defaultOrg: '',
          pinned: ['view:v1', 'p-echo', 'view:v-gone'],
          pages: {
            all: { views: [{ id: 'v1', name: 'Board', query: 'kind=task' }] },
          },
        },
      },
    });
    const room = roomOf('view:v1', withViews);
    expect(room).toEqual({ kind: 'view', id: 'v1' });
    expect(room && roomKey(room)).toBe('view:v1');
    expect(room && viewOf(room, withViews)?.name).toBe('Board');
    expect(roomOf('view:v-gone', withViews)).toBeNull();
    // Without settings, no view is known.
    expect(roomOf('view:v1', space)).toBeNull();
    expect(railRooms(settingsOf(withViews), withViews).rooms).toEqual([
      { kind: 'view', id: 'v1' },
      { kind: 'project', id: 'p-echo' },
    ]);
  });
});

describe('pins', () => {
  it('pins at the end and unpins, each once', () => {
    const echo = { kind: 'project', id: 'p-echo' } as const;
    const leia = { kind: 'person', id: 'pe-leia' } as const;
    expect(withPin({}, echo, true)).toEqual(['p-echo']);
    expect(withPin({ pinned: ['p-echo'] }, leia, true)).toEqual([
      'p-echo',
      'pe-leia',
    ]);
    expect(withPin({ pinned: ['p-echo', 'pe-leia'] }, echo, true)).toEqual([
      'pe-leia',
      'p-echo',
    ]);
    expect(withPin({ pinned: ['p-echo', 'pe-leia'] }, echo, false)).toEqual([
      'pe-leia',
    ]);
    expect(isPinned({ pinned: ['pe-leia'] }, leia)).toBe(true);
    expect(isPinned({ pinned: ['pe-leia'] }, echo)).toBe(false);
    expect(pinnedOf({ pinned: ['a', 'a', 'b'] })).toEqual(['a', 'b']);
  });

  it('moves a pin among the rooms that exist, stale ones kept', () => {
    const settings = { pinned: ['p-echo', 'p-gone', 'pe-leia', 'pe-han'] };
    expect(movePin(settings, space, 'pe-leia', -1)).toEqual([
      'pe-leia',
      'p-gone',
      'p-echo',
      'pe-han',
    ]);
    expect(movePin(settings, space, 'pe-leia', 1)).toEqual([
      'p-echo',
      'p-gone',
      'pe-han',
      'pe-leia',
    ]);
    expect(movePin(settings, space, 'p-echo', -1)).toBeNull();
    expect(movePin(settings, space, 'pe-han', 1)).toBeNull();
    expect(movePin(settings, space, 'p-falcon', 1)).toBeNull();
  });

  it('skips stale pins when read', () => {
    expect(
      pinnedRooms({ pinned: ['p-gone', 'pe-han', 'p-echo'] }, space),
    ).toEqual([
      { kind: 'person', id: 'pe-han' },
      { kind: 'project', id: 'p-echo' },
    ]);
  });
});

describe('railRooms', () => {
  it('lists the active projects, most recently changed first, before any pin', () => {
    expect(railRooms({}, space)).toEqual({
      pinned: false,
      rooms: [
        { kind: 'project', id: 'p-falcon' },
        { kind: 'project', id: 'p-echo' },
      ],
    });
    // Pins that all name nothing count as none.
    expect(railRooms({ pinned: ['p-gone'] }, space).pinned).toBe(false);
  });

  it('lists the pinned rooms in their order once there are any', () => {
    expect(railRooms({ pinned: ['pe-leia', 'p-old'] }, space)).toEqual({
      pinned: true,
      rooms: [
        { kind: 'person', id: 'pe-leia' },
        { kind: 'project', id: 'p-old' },
      ],
    });
  });
});

describe('owedBy', () => {
  const tasks = {
    a: task('a', { assignee: 'pe-leia' }),
    b: task('b', { assignee: 'pe-leia' }),
    c: task('c', { assignee: 'pe-han' }),
    // Blocked on Han, though it is mine.
    d: task('d', { assignee: 'pe-me', blocked: { on: 'pe-han', note: '' } }),
    // Mine, done, archived or on nobody: none of these count.
    e: task('e', { assignee: 'pe-me' }),
    f: task('f', { assignee: 'pe-leia', status: 'done' }),
    g: task('g', { assignee: 'pe-leia', projectId: 'p-old' }),
    h: task('h', { blocked: { on: null, note: 'vendor' } }),
    i: task('i', { assignee: 'pe-gone' }),
  };
  const owed = state({ ...space, tasks });

  it('counts what each person owes you, most first', () => {
    expect(owedBy(owed).map(({ person: p, count }) => [p.id, count])).toEqual([
      ['pe-han', 2],
      ['pe-leia', 2],
    ]);
  });

  it('leaves out the people already pinned', () => {
    expect(
      owedBy(owed, { pinned: ['pe-han'] }).map(({ person: p }) => p.id),
    ).toEqual(['pe-leia']);
  });

  it(`lists ${OWED_MAX} at most`, () => {
    const people: Record<string, Person> = {};
    const many: Record<string, Task> = {};
    for (let i = 0; i < OWED_MAX + 2; i++) {
      people[`p${i}`] = person(`p${i}`);
      many[`t${i}`] = task(`t${i}`, { assignee: `p${i}` });
    }
    expect(owedBy(state({ people, tasks: many }))).toHaveLength(OWED_MAX);
  });

  it('lists everyone but you for All, owing or not (#337)', () => {
    expect(
      peopleByOwed(owed).map(({ person: p, count }) => [p.id, count]),
    ).toEqual([
      ['pe-han', 2],
      ['pe-leia', 2],
    ]);
    expect(peopleByOwed(space).map(({ person: p }) => p.id)).toEqual([
      'pe-han',
      'pe-leia',
    ]);
  });
});

describe('projectRoomsByOrg', () => {
  it('groups the live projects under their orgs, those with none last', () => {
    const rooms = projectRoomsByOrg({
      ...space.projects,
      'p-x': project('p-x', { org: 'Rebels', name: 'X-wing' }),
      'p-a': project('p-a', { org: 'Rebels', name: 'A-wing' }),
      'p-b': project('p-b', { org: ' Alliance ' }),
    });
    expect(
      rooms.map(({ org, projects }) => [org, projects.map((p) => p.id)]),
    ).toEqual([
      ['Alliance', ['p-b']],
      ['Rebels', ['p-a', 'p-x']],
      ['', ['p-done', 'p-echo', 'p-falcon']],
    ]);
  });
});

describe('unfiledCount', () => {
  it('counts the notes with no home', () => {
    const note = (id: string, patch: Partial<Note> = {}): Note =>
      ({
        id,
        projectId: null,
        meetingId: null,
        body: 'x',
        pinned: false,
        createdAt: AT,
        editedAt: null,
        ...patch,
      }) as Note;
    expect(
      unfiledCount({
        a: note('a'),
        b: note('b', { projectId: 'p-echo' }),
        c: note('c', { meetingId: 'e-1' }),
        d: note('d', { taskId: 't-1' }),
        e: note('e', { body: 'ask @{pe-leia}' }),
        f: note('f'),
      }),
    ).toBe(2);
  });
});
