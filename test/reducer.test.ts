import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { ExportSchema, type Op } from '#shared/protocol';
import { type Changed, merge, OpError, reduce } from '#shared/reducer';
import {
  emptySnapshot,
  GENERAL,
  type Snapshot,
  settingsOf,
} from '#shared/types';
import fixture from './fixtures/export.json';

const T1 = '2026-10-23T10:00:00.000Z';

/** Freeze deeply, so any mutation of the input throws. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Apply ops in order, each at its own minute after T1. */
function run(state: Snapshot, ...ops: Op[]): Snapshot {
  return ops.reduce(
    (s, op, i) =>
      reduce(s, op, `2026-10-23T10:${String(i).padStart(2, '0')}:00.000Z`)
        .state,
    state,
  );
}

function at(state: Snapshot, op: Op, now = T1) {
  return reduce(freeze(state), op, now);
}

function lastLog(state: Snapshot, scope: string): string | undefined {
  return state.activity[scope]?.events[0]?.text;
}

function sorted(changed: Changed[]) {
  return [...changed].sort((a, b) =>
    `${a.col}/${a.id}`.localeCompare(`${b.col}/${b.id}`),
  );
}

/** A project `p1` with two open tasks and a person. */
function base(): Snapshot {
  return run(
    emptySnapshot(),
    { type: 'createProject', id: 'p1', name: 'Echo Base' },
    { type: 'addTask', id: 't1', projectId: 'p1', title: 'Heaters' },
    { type: 'addTask', id: 't2', projectId: 'p1', title: 'Doors' },
    { type: 'addPerson', id: 'u1', name: 'Leia Organa' },
  );
}

const seeded = (): Snapshot => {
  const { exportedAt: _, ...state } = ExportSchema.parse(fixture);
  return state;
};

describe('reduce', () => {
  it('is pure: same input, same output, input untouched', () => {
    const state = freeze(base());
    const op: Op = { type: 'toggleTask', id: 't1', done: true };
    expect(reduce(state, op, T1)).toEqual(reduce(state, op, T1));
    expect(state.tasks.t1?.status).toBe('open');
  });

  it('returns the same state and no changes for a no-op', () => {
    const state = base();
    const result = at(state, { type: 'toggleTask', id: 't1', done: false });
    expect(result.state).toBe(state);
    expect(result.changed).toEqual([]);
  });

  it('refuses with a readable reason', () => {
    expect(() =>
      at(base(), { type: 'toggleTask', id: 'nope', done: true }),
    ).toThrow(new OpError('That task no longer exists'));
    expect(() =>
      at(base(), { type: 'addTask', id: 't9', projectId: 'p9', title: 'x' }),
    ).toThrow('That project no longer exists');
    expect(() =>
      at(base(), { type: 'addTask', id: 't1', projectId: null, title: 'x' }),
    ).toThrow('That task already exists');
  });
});

describe('tasks', () => {
  it('addTask fills defaults, orders after the rest, logs and bumps', () => {
    const state = base();
    const { state: next, changed } = at(state, {
      type: 'addTask',
      id: 't3',
      projectId: 'p1',
      title: 'Stables',
      assignee: 'u1',
      sourceNoteId: 'n1',
    });
    expect(next.tasks.t3).toEqual({
      id: 't3',
      title: 'Stables',
      projectId: 'p1',
      status: 'open',
      priority: 'none',
      due: '',
      desc: '',
      tags: [],
      assignee: 'u1',
      links: [],
      order: 3,
      sourceNoteId: 'n1',
      createdAt: T1,
      updatedAt: T1,
      completedAt: null,
    });
    expect(lastLog(next, 'p1')).toBe('Added task "Stables"');
    expect(next.projects.p1?.updatedAt).toBe(T1);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'projects', id: 'p1' },
      { col: 'tasks', id: 't3' },
    ]);
  });

  it('order is max + 1 within the project, counting done tasks', () => {
    const state = run(
      base(),
      { type: 'toggleTask', id: 't2', done: true },
      { type: 'addTask', id: 'g1', projectId: null, title: 'General one' },
    );
    expect(state.tasks.g1?.order).toBe(1);
    const next = at(state, {
      type: 'addTask',
      id: 't3',
      projectId: 'p1',
      title: 'x',
    }).state;
    expect(next.tasks.t3?.order).toBe(3);
  });

  it('General tasks log to the general log and bump no project', () => {
    const { state, changed } = at(base(), {
      type: 'addTask',
      id: 'g1',
      projectId: null,
      title: 'Permit',
    });
    expect(lastLog(state, GENERAL)).toBe('Added task "Permit"');
    expect(changed.map((c) => c.col).sort()).toEqual(['activity', 'tasks']);
  });

  it('toggleTask closes and reopens, with completedAt and the log', () => {
    const closed = at(base(), { type: 'toggleTask', id: 't1', done: true });
    expect(closed.state.tasks.t1).toMatchObject({
      status: 'done',
      completedAt: T1,
      updatedAt: T1,
    });
    expect(lastLog(closed.state, 'p1')).toBe('Closed "Heaters"');
    expect(closed.state.projects.p1?.updatedAt).toBe(T1);

    const T2 = '2026-10-23T11:00:00.000Z';
    const reopened = reduce(
      closed.state,
      { type: 'toggleTask', id: 't1', done: false },
      T2,
    ).state;
    expect(reopened.tasks.t1).toMatchObject({
      status: 'open',
      completedAt: null,
      updatedAt: T2,
    });
    expect(lastLog(reopened, 'p1')).toBe('Reopened "Heaters"');
  });

  it('moveTask logs in both projects and orders at the end of the new one', () => {
    const state = run(
      base(),
      { type: 'createProject', id: 'p2', name: 'Falcon' },
      { type: 'addTask', id: 'f1', projectId: 'p2', title: 'Motivator' },
    );
    const { state: next } = at(state, {
      type: 'moveTask',
      id: 't1',
      projectId: 'p2',
    });
    expect(next.tasks.t1).toMatchObject({ projectId: 'p2', order: 2 });
    expect(lastLog(next, 'p1')).toBe('Moved "Heaters" to Falcon');
    expect(lastLog(next, 'p2')).toBe('Moved "Heaters" here from Echo Base');
    expect(next.projects.p1?.updatedAt).toBe(T1);
    expect(next.projects.p2?.updatedAt).toBe(T1);

    const toGeneral = at(next, {
      type: 'moveTask',
      id: 't1',
      projectId: null,
    }).state;
    expect(lastLog(toGeneral, 'p2')).toBe('Moved "Heaters" to General');
    expect(lastLog(toGeneral, GENERAL)).toBe(
      'Moved "Heaters" here from Falcon',
    );
  });

  it('editTask applies the patch and logs with the new title', () => {
    const { state } = at(base(), {
      type: 'editTask',
      id: 't1',
      patch: { title: 'Fix heaters', priority: 'high', due: '2026-10-31' },
    });
    expect(state.tasks.t1).toMatchObject({
      title: 'Fix heaters',
      priority: 'high',
      due: '2026-10-31',
      updatedAt: T1,
      projectId: 'p1',
    });
    expect(lastLog(state, 'p1')).toBe('Edited task "Fix heaters"');
    expect(state.projects.p1?.updatedAt).toBe(T1);
  });

  it('deleteTask removes it and logs', () => {
    const { state, changed } = at(base(), { type: 'deleteTask', id: 't2' });
    expect(state.tasks.t2).toBeUndefined();
    expect(changed).toContainEqual({ col: 'tasks', id: 't2', deleted: true });
    expect(lastLog(state, 'p1')).toBe('Deleted task "Doors"');
  });

  it('reorderTasks rewrites 1..n and reports only rows that moved', () => {
    const state = run(base(), {
      type: 'addTask',
      id: 't3',
      projectId: 'p1',
      title: 'Stables',
    });
    const before = state.activity.p1;
    const { state: next, changed } = at(state, {
      type: 'reorderTasks',
      projectId: 'p1',
      ids: ['t1', 't3', 't2'],
    });
    expect([
      next.tasks.t1?.order,
      next.tasks.t3?.order,
      next.tasks.t2?.order,
    ]).toEqual([1, 2, 3]);
    expect(sorted(changed)).toEqual([
      { col: 'tasks', id: 't2' },
      { col: 'tasks', id: 't3' },
    ]);
    // Not logged, and the project is not bumped.
    expect(next.activity.p1).toBe(before);
    expect(next.projects.p1).toBe(state.projects.p1);
  });

  it('reorderTasks keeps tasks the sender did not know about, and skips strangers', () => {
    const state = run(base(), {
      type: 'addTask',
      id: 't3',
      projectId: 'p1',
      title: 'Stables',
    });
    const { state: next } = at(state, {
      type: 'reorderTasks',
      projectId: 'p1',
      ids: ['t2', 'ghost', 't1'],
    });
    expect([
      next.tasks.t2?.order,
      next.tasks.t1?.order,
      next.tasks.t3?.order,
    ]).toEqual([1, 2, 3]);
  });
});

describe('projects', () => {
  it('createProject fills defaults and logs', () => {
    const { state } = at(emptySnapshot(), {
      type: 'createProject',
      id: 'p1',
      name: 'Echo Base',
      org: 'Rebel Alliance',
      status: 'paused',
    });
    expect(state.projects.p1).toEqual({
      id: 'p1',
      name: 'Echo Base',
      org: 'Rebel Alliance',
      status: 'paused',
      priority: 'none',
      targetDate: '',
      tags: [],
      desc: '',
      state: '',
      members: [],
      links: [],
      archived: false,
      createdAt: T1,
      updatedAt: T1,
    });
    expect(lastLog(state, 'p1')).toBe('Created project');
  });

  it('editProject, setState, setStatus, archive and unarchive log their text', () => {
    let state = base();
    const steps: Array<[Op, string]> = [
      [
        { type: 'editProject', id: 'p1', patch: { org: 'Alliance' } },
        'Edited project details',
      ],
      [
        { type: 'setState', id: 'p1', state: 'On track' },
        'Updated current state',
      ],
      [
        { type: 'setStatus', id: 'p1', status: 'paused' },
        'Status changed to paused',
      ],
      [{ type: 'archiveProject', id: 'p1' }, 'Archived project'],
      [{ type: 'unarchiveProject', id: 'p1' }, 'Unarchived project'],
    ];
    for (const [op, text] of steps) {
      state = at(state, op).state;
      expect(state.projects.p1?.updatedAt).toBe(T1);
      expect(lastLog(state, 'p1')).toBe(text);
    }
    expect(state.projects.p1).toMatchObject({
      org: 'Alliance',
      state: 'On track',
      status: 'paused',
      archived: false,
    });
  });

  it('setState, setStatus and archive do nothing when nothing changes', () => {
    const state = run(base(), { type: 'setState', id: 'p1', state: 'Fine' });
    for (const op of [
      { type: 'setState', id: 'p1', state: 'Fine' },
      { type: 'setStatus', id: 'p1', status: 'active' },
      { type: 'unarchiveProject', id: 'p1' },
    ] satisfies Op[]) {
      expect(at(state, op).changed).toEqual([]);
    }
  });

  it('deleteProject deletes tasks, notes and activity; events go to General', () => {
    const state = run(
      base(),
      { type: 'createProject', id: 'p2', name: 'Falcon' },
      { type: 'addTask', id: 'f1', projectId: 'p2', title: 'Keep me' },
      { type: 'addNote', id: 'n1', projectId: 'p1', body: 'Bye' },
      {
        type: 'addEvent',
        id: 'e1',
        projectId: 'p1',
        title: 'Review',
        eventType: 'meeting',
        date: '2026-10-27',
      },
    );
    const { state: next, changed } = at(state, {
      type: 'deleteProject',
      id: 'p1',
    });
    expect(next.projects.p1).toBeUndefined();
    expect(next.tasks.t1).toBeUndefined();
    expect(next.tasks.t2).toBeUndefined();
    expect(next.notes.n1).toBeUndefined();
    expect(next.activity.p1).toBeUndefined();
    expect(next.events.e1).toMatchObject({ projectId: null, updatedAt: T1 });
    expect(next.tasks.f1).toBeDefined();
    expect(next.projects.p2).toBeDefined();
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1', deleted: true },
      { col: 'events', id: 'e1' },
      { col: 'notes', id: 'n1', deleted: true },
      { col: 'projects', id: 'p1', deleted: true },
      { col: 'tasks', id: 't1', deleted: true },
      { col: 'tasks', id: 't2', deleted: true },
    ]);
  });

  it('remove on a project cascades the same way', () => {
    const { state } = at(base(), { type: 'remove', col: 'projects', id: 'p1' });
    expect(state.projects.p1).toBeUndefined();
    expect(state.tasks.t1).toBeUndefined();
  });
});

describe('notes', () => {
  it('addNote, editNote and deleteNote log and bump the project', () => {
    let { state } = at(base(), {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Standup',
    });
    expect(state.notes.n1).toEqual({
      id: 'n1',
      projectId: 'p1',
      body: 'Standup',
      pinned: false,
      eventId: null,
      phase: null,
      createdAt: T1,
    });
    expect(lastLog(state, 'p1')).toBe('Added a note');
    expect(state.projects.p1?.updatedAt).toBe(T1);

    const T2 = '2026-10-23T11:00:00.000Z';
    state = reduce(
      state,
      { type: 'editNote', id: 'n1', body: 'Standup!' },
      T2,
    ).state;
    expect(state.notes.n1).toMatchObject({ body: 'Standup!', editedAt: T2 });
    expect(state.projects.p1?.updatedAt).toBe(T2);

    state = at(state, { type: 'deleteNote', id: 'n1' }).state;
    expect(state.notes.n1).toBeUndefined();
    expect(lastLog(state, 'p1')).toBe('Deleted a note');
  });

  it('a saved summary logs its own text', () => {
    const { state } = at(base(), {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Summary of Echo Base',
      summary: true,
    });
    expect(lastLog(state, 'p1')).toBe('Saved a Claude summary as a note');
  });

  it('links a note to an event with its phase', () => {
    const state = run(base(), {
      type: 'addEvent',
      id: 'e1',
      projectId: 'p1',
      title: 'Review',
      eventType: 'meeting',
      date: '2026-10-27',
    });
    const { state: next } = at(state, {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Prep: Review',
      eventId: 'e1',
      phase: 'pre',
    });
    expect(next.notes.n1).toMatchObject({ eventId: 'e1', phase: 'pre' });
    expect(() =>
      at(state, {
        type: 'addNote',
        id: 'n2',
        projectId: 'p1',
        body: 'x',
        eventId: 'e9',
      }),
    ).toThrow('That event no longer exists');
  });

  it('pinNote is not logged', () => {
    const state = run(base(), {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Pin me',
    });
    const { state: next } = at(state, {
      type: 'pinNote',
      id: 'n1',
      pinned: true,
    });
    expect(next.notes.n1?.pinned).toBe(true);
    expect(next.activity.p1).toBe(state.activity.p1);
  });
});

describe('events', () => {
  const add: Op = {
    type: 'addEvent',
    id: 'e1',
    projectId: 'p1',
    title: 'Review',
    eventType: 'meeting',
    date: '2026-10-27',
    time: '14:00',
  };

  it('addEvent, editEvent and deleteEvent log their text', () => {
    let { state } = at(base(), add);
    expect(state.events.e1).toEqual({
      id: 'e1',
      projectId: 'p1',
      title: 'Review',
      type: 'meeting',
      date: '2026-10-27',
      time: '14:00',
      end: '',
      attendees: [],
      link: '',
      note: '',
      createdAt: T1,
      updatedAt: T1,
    });
    expect(lastLog(state, 'p1')).toBe('Added meeting "Review"');
    expect(state.projects.p1?.updatedAt).toBe(T1);

    state = at(state, {
      type: 'editEvent',
      id: 'e1',
      patch: { type: 'milestone', title: 'Launch' },
    }).state;
    expect(lastLog(state, 'p1')).toBe('Edited milestone "Launch"');

    state = at(state, { type: 'deleteEvent', id: 'e1' }).state;
    expect(state.events.e1).toBeUndefined();
    expect(lastLog(state, 'p1')).toBe('Deleted event "Launch"');
  });

  it('deleting an event keeps its notes', () => {
    const state = run(base(), add, {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Prep',
      eventId: 'e1',
      phase: 'pre',
    });
    const { state: next } = at(state, { type: 'deleteEvent', id: 'e1' });
    expect(next.notes.n1).toMatchObject({ eventId: 'e1', phase: 'pre' });
  });
});

describe('people', () => {
  it('at most one person is me', () => {
    let state = run(
      base(),
      { type: 'addPerson', id: 'u2', name: 'Han Solo', me: true },
      { type: 'addPerson', id: 'u3', name: 'Chewbacca' },
    );
    expect(state.people.u2?.me).toBe(true);
    state = at(state, {
      type: 'editPerson',
      id: 'u3',
      patch: { me: true },
    }).state;
    expect(Object.values(state.people).filter((p) => p.me)).toEqual([
      { id: 'u3', name: 'Chewbacca', role: '', me: true },
    ]);
    state = at(state, {
      type: 'addPerson',
      id: 'u4',
      name: 'Lando',
      me: true,
    }).state;
    expect(
      Object.values(state.people)
        .filter((p) => p.me)
        .map((p) => p.id),
    ).toEqual(['u4']);
  });

  it('removePerson leaves their mentions and assignments alone', () => {
    const state = run(base(), {
      type: 'editTask',
      id: 't1',
      patch: { assignee: 'u1', desc: 'Ask @{u1}' },
    });
    const { state: next } = at(state, { type: 'removePerson', id: 'u1' });
    expect(next.people.u1).toBeUndefined();
    expect(next.tasks.t1).toMatchObject({ assignee: 'u1', desc: 'Ask @{u1}' });
  });
});

describe('generic ops and the log', () => {
  it('put replaces a whole document; remove deletes one', () => {
    const doc = {
      ...(base().tasks.t1 as NonNullable<Snapshot['tasks']['t1']>),
    };
    doc.title = 'Replaced';
    const { state, changed } = at(base(), { type: 'put', col: 'tasks', doc });
    expect(state.tasks.t1?.title).toBe('Replaced');
    expect(changed).toEqual([{ col: 'tasks', id: 't1' }]);
    const removed = at(state, { type: 'remove', col: 'tasks', id: 't1' });
    expect(removed.changed).toEqual([
      { col: 'tasks', id: 't1', deleted: true },
    ]);
  });

  it('log prepends to a project or General', () => {
    const { state } = at(base(), { type: 'log', scope: 'p1', text: 'Hello' });
    expect(state.activity.p1?.events[0]).toEqual({ t: T1, text: 'Hello' });
    expect(
      at(base(), { type: 'log', scope: GENERAL, text: 'Hi' }).state.activity
        .general?.events[0]?.text,
    ).toBe('Hi');
    expect(() => at(base(), { type: 'log', scope: 'p9', text: 'x' })).toThrow(
      'That project no longer exists',
    );
  });

  it('keeps the newest 150 activity entries', () => {
    let state = base();
    for (let i = 0; i < LIMITS.activityMax + 10; i += 1) {
      state = reduce(
        state,
        { type: 'log', scope: 'p1', text: `line ${i}` },
        T1,
      ).state;
    }
    const events = state.activity.p1?.events ?? [];
    expect(events).toHaveLength(LIMITS.activityMax);
    expect(events[0]?.text).toBe(`line ${LIMITS.activityMax + 9}`);
  });

  it('clips a log line that would not fit', () => {
    const title = 'x'.repeat(LIMITS.titleMax);
    const state = run(
      base(),
      { type: 'createProject', id: 'p2', name: 'y'.repeat(LIMITS.nameMax) },
      { type: 'addTask', id: 't9', projectId: 'p1', title },
      { type: 'moveTask', id: 't9', projectId: 'p2' },
    );
    const text = lastLog(state, 'p1') ?? '';
    expect(text.length).toBe(LIMITS.activityTextMax);
    expect(text.endsWith('…')).toBe(true);
  });

  it('refuses a document over the size limit', () => {
    const doc = {
      ...(base().tasks.t1 as NonNullable<Snapshot['tasks']['t1']>),
      desc: '𝕏'.repeat(LIMITS.docBytes / 4 + 1),
    };
    expect(() => at(base(), { type: 'put', col: 'tasks', doc })).toThrow(
      'That is too big to save',
    );
  });
});

describe('settings', () => {
  it('starts from the defaults and stores a patch, unlogged', () => {
    const state = base();
    expect(settingsOf(state)).toEqual({ defaultOrg: 'OpenTeams Internal' });
    const { state: next, changed } = at(state, {
      type: 'setSettings',
      patch: { defaultOrg: 'Rebel Alliance' },
    });
    expect(settingsOf(next).defaultOrg).toBe('Rebel Alliance');
    expect(changed).toEqual([{ col: 'settings', id: 'user' }]);
    expect(next.activity).toBe(state.activity);
    // Empty means "no default org".
    const cleared = at(next, {
      type: 'setSettings',
      patch: { defaultOrg: '' },
    });
    expect(settingsOf(cleared.state).defaultOrg).toBe('');
  });
});

describe('merge (import)', () => {
  it('adds new documents and replaces same ids', () => {
    const state = run(emptySnapshot(), {
      type: 'addTask',
      id: 't-1',
      projectId: null,
      title: 'Local version',
    });
    const incoming = ExportSchema.parse(fixture);
    const { state: next } = merge(state, incoming);
    expect(next.tasks['t-1']?.title).toBe('Confirm shield generator delivery');
    expect(Object.keys(next.projects)).toHaveLength(3);
    expect(next).toEqual(seeded());
  });

  it('keeps documents the import does not mention, and one me', () => {
    const state = run(emptySnapshot(), {
      type: 'addPerson',
      id: 'u-local',
      name: 'Local me',
      me: true,
    });
    const { state: next } = merge(state, ExportSchema.parse(fixture));
    expect(next.people['u-local']).toMatchObject({ me: false });
    expect(
      Object.values(next.people)
        .filter((p) => p.me)
        .map((p) => p.id),
    ).toEqual(['u-leia']);
  });
});
