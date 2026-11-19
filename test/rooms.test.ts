import { describe, expect, it } from 'vitest';
import { toggleCheck } from '#shared/markdown';
import {
  hiddenProjects,
  hidePatch,
  isHidden,
  isPinned,
  isRoomPage,
  movePin,
  narrowedOf,
  OWED_MAX,
  owedBy,
  PINNED_LABEL_MAX,
  peopleByOwed,
  pinnedBody,
  pinnedFit,
  pinnedLabel,
  pinnedOf,
  pinnedRooms,
  projectRoomsByOrg,
  railRooms,
  roomKey,
  roomLink,
  roomOf,
  roomPinnedNotes,
  scratchCount,
  viewOf,
  withNoteQuery,
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

  it('leaves the hidden projects off the active list', () => {
    expect(railRooms({ hiddenRooms: ['p-falcon'] }, space).rooms).toEqual([
      { kind: 'project', id: 'p-echo' },
    ]);
  });
});

describe('hidden projects', () => {
  it('hides once and unpins the project, keeping its pairs', () => {
    expect(
      hidePatch({ pinned: ['p-echo', 'p-echo+pe-leia'] }, 'p-echo', true),
    ).toEqual({ hiddenRooms: ['p-echo'], pinned: ['p-echo+pe-leia'] });
    expect(
      hidePatch({ hiddenRooms: ['p-echo'] }, 'p-echo', true).hiddenRooms,
    ).toEqual(['p-echo']);
  });

  it('shows again without touching the pins', () => {
    expect(
      hidePatch({ hiddenRooms: ['p-echo', 'p-falcon'] }, 'p-echo', false),
    ).toEqual({ hiddenRooms: ['p-falcon'] });
  });

  it('reads which are hidden, skipping projects that are gone', () => {
    const settings = { hiddenRooms: ['p-gone', 'p-falcon', 'p-echo'] };
    expect(isHidden(settings, 'p-echo')).toBe(true);
    expect(isHidden({}, 'p-echo')).toBe(false);
    expect(hiddenProjects(settings, space.projects).map((p) => p.id)).toEqual([
      'p-echo',
      'p-falcon',
    ]);
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

describe('scratchCount', () => {
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
      scratchCount({
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

describe('a room’s address (#334)', () => {
  it('opens a pair as the project’s room narrowed to the person', () => {
    expect(roomLink({ kind: 'project', id: 'p' })).toEqual({
      route: { name: 'project', id: 'p' },
      query: '',
    });
    expect(roomLink({ kind: 'person', id: 'u' })).toEqual({
      route: { name: 'person', id: 'u' },
      query: '',
    });
    expect(roomLink({ kind: 'pair', project: 'p', person: 'u 1' })).toEqual({
      route: { name: 'project', id: 'p' },
      query: 'person=u+1',
    });
  });

  it('knows which room a page is, on any tab', () => {
    const project = { kind: 'project', id: 'p' } as const;
    const pair = { kind: 'pair', project: 'p', person: 'u' } as const;
    const plan = { name: 'project', id: 'p', tab: 'plan' } as const;
    const board = { name: 'whiteboard', project: 'p' } as const;
    expect(isRoomPage(project, plan, null)).toBe(true);
    expect(isRoomPage(project, board, null)).toBe(true);
    expect(isRoomPage(project, plan, 'u')).toBe(false);
    expect(isRoomPage(pair, plan, 'u')).toBe(true);
    expect(isRoomPage(pair, plan, null)).toBe(false);
    expect(isRoomPage(pair, { name: 'whiteboard' }, 'u')).toBe(false);
    expect(
      isRoomPage(
        { kind: 'person', id: 'u' },
        { name: 'person', id: 'u' },
        null,
      ),
    ).toBe(true);
  });

  it('knows a person’s room narrowed to a project is the pair', () => {
    const person = { kind: 'person', id: 'u' } as const;
    const pair = { kind: 'pair', project: 'p', person: 'u' } as const;
    const room = { name: 'person', id: 'u' } as const;
    expect(isRoomPage(person, room, 'p')).toBe(false);
    expect(isRoomPage(pair, room, 'p')).toBe(true);
    expect(isRoomPage(pair, room, 'q')).toBe(false);
    expect(isRoomPage(pair, room, null)).toBe(false);
    expect(isRoomPage({ ...pair, person: 'v' }, room, 'p')).toBe(false);
  });

  it('reads what a room page is narrowed to', () => {
    const q = new URLSearchParams('person=u&project=p');
    expect(narrowedOf({ name: 'person', id: 'u' }, q)).toBe('p');
    expect(narrowedOf({ name: 'project', id: 'p' }, q)).toBe('u');
  });
});

describe('pinned notes at the top of a room (#377)', () => {
  const note = (id: string, patch: Partial<Note> = {}): Note =>
    ({
      id,
      projectId: null,
      meetingId: null,
      body: id,
      pinned: true,
      createdAt: AT,
      editedAt: null,
      ...patch,
    }) as Note;
  const notes = {
    b: note('b', { projectId: 'p-echo', body: '## Runbook\nStep one' }),
    a: note('a', { projectId: 'p-echo', body: 'Contacts for @{pe-leia}' }),
    c: note('c', {
      projectId: 'p-echo',
      body: 'Old',
      createdAt: '2026-11-01T09:00:00.000Z',
    }),
    off: note('off', { projectId: 'p-echo', pinned: false }),
    other: note('other', { projectId: 'p-falcon' }),
    loose: note('loose', { body: 'Ask @{pe-leia} about it' }),
  };
  const s = { notes, people: space.people };

  it('lists a project’s pinned notes, oldest first, labeled by the first line', () => {
    expect(roomPinnedNotes(s, { kind: 'project', id: 'p-echo' })).toEqual([
      { id: 'c', label: 'Old' },
      { id: 'a', label: 'Contacts for @Leia' },
      { id: 'b', label: 'Runbook' },
    ]);
  });

  it('lists a person’s pinned notes that mention them, any project', () => {
    expect(
      roomPinnedNotes(s, { kind: 'person', id: 'pe-leia' }).map((n) => n.id),
    ).toEqual(['a', 'loose']);
    expect(roomPinnedNotes(s, { kind: 'person', id: 'pe-han' })).toEqual([]);
  });

  it('leaves out notes on their way out', () => {
    expect(
      roomPinnedNotes(s, { kind: 'project', id: 'p-echo' }, new Set(['a'])).map(
        (n) => n.id,
      ),
    ).toEqual(['c', 'b']);
  });

  it('labels an empty note, and shortens a long first line', () => {
    expect(pinnedLabel('   \n\n', {})).toBe('Empty note');
    expect(pinnedLabel('- [ ] Feed the tauntauns', {})).toBe(
      '☐ Feed the tauntauns',
    );
    const long = pinnedLabel('x'.repeat(80), {});
    expect(long).toHaveLength(PINNED_LABEL_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('drops a leading heading the label already shows', () => {
    expect(pinnedBody('## Standup\n\n- [ ] Check the heaters', {})).toEqual({
      text: '- [ ] Check the heaters',
      offset: 2,
    });
    expect(pinnedBody('\n# Standup\nFed', {})).toEqual({
      text: 'Fed',
      offset: 2,
    });
    // Not a heading, or a heading the label cuts short: kept.
    expect(pinnedBody('Standup\nFed', {}).offset).toBe(0);
    const long = `# ${'x'.repeat(80)}\nFed`;
    expect(pinnedBody(long, {})).toEqual({ text: long, offset: 0 });
    // A tick in what shows lands on the right line of the stored body.
    const body = '## Standup\n\n- [ ] Check the heaters';
    const shown = pinnedBody(body, {});
    expect(toggleCheck(body, 0 + shown.offset)).toBe(
      '## Standup\n\n- [x] Check the heaters',
    );
  });

  it('fits every pin, or as many as fit beside the Pinned menu', () => {
    expect(pinnedFit([], 0, 80)).toBe(0);
    expect(pinnedFit([100, 100], 200, 80)).toBe(2);
    expect(pinnedFit([100, 100, 100], 290, 80)).toBe(2);
    expect(pinnedFit([100, 100, 100], 279, 80)).toBe(1);
    expect(pinnedFit([100, 100], 150, 80)).toBe(0);
  });

  it('opens and closes a note in the query, keeping the rest', () => {
    expect(withNoteQuery('person=pe-han', 'n-1')).toBe(
      'person=pe-han&note=n-1',
    );
    expect(withNoteQuery('person=pe-han&note=n-1', null)).toBe('person=pe-han');
    expect(withNoteQuery('', null)).toBe('');
  });
});
