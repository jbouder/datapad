import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { ExportSchema, type Op, OpSchema } from '#shared/protocol';
import { type Changed, merge, OpError, reduce } from '#shared/reducer';
import {
  emptySnapshot,
  GENERAL,
  type Project,
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
      health: 'none',
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
      [{ type: 'setHealth', id: 'p1', health: 'red' }, 'Health set to red'],
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
      health: 'red',
      archived: false,
    });
  });

  it('health starts as none, and a project without it reads as none', () => {
    const state = run(base(), {
      type: 'createProject',
      id: 'p2',
      name: 'Falcon',
      health: 'yellow',
    });
    expect(state.projects.p2?.health).toBe('yellow');
    const old = base();
    const { health: _, ...legacy } = old.projects.p1 as Project;
    old.projects.p1 = legacy;
    expect(
      at(old, { type: 'setHealth', id: 'p1', health: 'none' }).changed,
    ).toEqual([]);
    expect(
      lastLog(run(old, { type: 'setHealth', id: 'p1', health: 'green' }), 'p1'),
    ).toBe('Health set to green');
  });

  it('a start date is optional and cannot fall after the target', () => {
    let state = run(base(), {
      type: 'createProject',
      id: 'p2',
      name: 'Falcon',
      startDate: '2026-11-02',
      targetDate: '2026-12-01',
    });
    expect(state.projects.p2?.startDate).toBe('2026-11-02');
    expect(state.projects.p1).not.toHaveProperty('startDate');
    expect(() =>
      run(state, {
        type: 'editProject',
        id: 'p2',
        patch: { targetDate: '2026-11-01' },
      }),
    ).toThrow('The start date is after the target date');
    expect(() =>
      run(state, {
        type: 'createProject',
        id: 'p3',
        name: 'Late',
        startDate: '2026-12-02',
        targetDate: '2026-12-01',
      }),
    ).toThrow(OpError);
    state = run(state, {
      type: 'editProject',
      id: 'p2',
      patch: { startDate: '' },
    });
    expect(state.projects.p2?.startDate).toBe('');
  });

  it('setState, setStatus and archive do nothing when nothing changes', () => {
    const state = run(base(), { type: 'setState', id: 'p1', state: 'Fine' });
    for (const op of [
      { type: 'setState', id: 'p1', state: 'Fine' },
      { type: 'setStatus', id: 'p1', status: 'active' },
      { type: 'setHealth', id: 'p1', health: 'none' },
      { type: 'unarchiveProject', id: 'p1' },
    ] satisfies Op[]) {
      expect(at(state, op).changed).toEqual([]);
    }
  });

  it('deleteProject deletes tasks, notes, milestones and activity; meetings go to General', () => {
    const state = run(
      base(),
      { type: 'createProject', id: 'p2', name: 'Falcon' },
      { type: 'addTask', id: 'f1', projectId: 'p2', title: 'Keep me' },
      { type: 'addNote', id: 'n1', projectId: 'p1', body: 'Bye' },
      {
        type: 'addMeeting',
        id: 'e1',
        projectId: 'p1',
        title: 'Review',
        date: '2026-10-27',
      },
      {
        type: 'addMilestone',
        projectId: 'p1',
        id: 'm1',
        title: 'Launch',
        date: '2026-11-14',
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
    expect(next.meetings.e1).toMatchObject({ projectId: null, updatedAt: T1 });
    expect(next.tasks.f1).toBeDefined();
    expect(next.projects.p2).toBeDefined();
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1', deleted: true },
      { col: 'meetings', id: 'e1' },
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
      meetingId: null,
      phase: null,
      taskId: null,
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
    expect(lastLog(state, 'p1')).toBe('Saved a summary as a note');
  });

  it('links a note to a meeting with its phase', () => {
    const state = run(base(), {
      type: 'addMeeting',
      id: 'e1',
      projectId: 'p1',
      title: 'Review',
      date: '2026-10-27',
    });
    const { state: next } = at(state, {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Prep: Review',
      meetingId: 'e1',
      phase: 'pre',
    });
    expect(next.notes.n1).toMatchObject({ meetingId: 'e1', phase: 'pre' });
    expect(() =>
      at(state, {
        type: 'addNote',
        id: 'n2',
        projectId: 'p1',
        body: 'x',
        meetingId: 'e9',
      }),
    ).toThrow('That meeting no longer exists');
  });

  it('addNote on a task: the task’s project, its log line, both bumped', () => {
    const T0 = '2026-10-23T09:00:00.000Z';
    const state = reduce(
      base(),
      { type: 'moveTask', id: 't2', projectId: null },
      T0,
    ).state;
    const { state: next, changed } = at(state, {
      type: 'addNote',
      id: 'n1',
      projectId: null,
      body: 'Pinged legal, waiting on the redline',
      taskId: 't1',
    });
    expect(next.notes.n1).toMatchObject({
      projectId: 'p1',
      taskId: 't1',
      meetingId: null,
      phase: null,
    });
    expect(lastLog(next, 'p1')).toBe('Added a note to "Heaters"');
    expect(next.tasks.t1?.updatedAt).toBe(T1);
    expect(next.projects.p1?.updatedAt).toBe(T1);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'notes', id: 'n1' },
      { col: 'projects', id: 'p1' },
      { col: 'tasks', id: 't1' },
    ]);

    // A General task's note is General's.
    const general = at(state, {
      type: 'addNote',
      id: 'n2',
      projectId: 'p1',
      body: 'Asked again',
      taskId: 't2',
    }).state;
    expect(general.notes.n2).toMatchObject({ projectId: null, taskId: 't2' });
    expect(lastLog(general, GENERAL)).toBe('Added a note to "Doors"');
  });

  it('addNote refuses an unknown task, and a meeting and a task together', () => {
    expect(() =>
      at(base(), {
        type: 'addNote',
        id: 'n1',
        projectId: 'p1',
        body: 'x',
        taskId: 't9',
      }),
    ).toThrow('That task no longer exists');
    const state = run(base(), {
      type: 'addMeeting',
      id: 'e1',
      projectId: 'p1',
      title: 'Review',
      date: '2026-10-27',
    });
    expect(() =>
      at(state, {
        type: 'addNote',
        id: 'n1',
        projectId: 'p1',
        body: 'x',
        meetingId: 'e1',
        taskId: 't1',
      }),
    ).toThrow('A note goes on a meeting or a task, not both');
  });

  it('deleteTask keeps its notes', () => {
    const state = run(base(), {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Running note',
      taskId: 't1',
    });
    const { state: next, changed } = at(state, {
      type: 'deleteTask',
      id: 't1',
    });
    expect(next.tasks.t1).toBeUndefined();
    expect(next.notes.n1).toMatchObject({
      projectId: 'p1',
      taskId: 't1',
      body: 'Running note',
    });
    expect(changed).not.toContainEqual(
      expect.objectContaining({ col: 'notes' }),
    );
  });

  it('moving a task moves its notes, and only its notes', () => {
    const state = run(
      base(),
      { type: 'createProject', id: 'p2', name: 'Hoth' },
      {
        type: 'addNote',
        id: 'n1',
        projectId: 'p1',
        body: 'On t1',
        taskId: 't1',
      },
      {
        type: 'addNote',
        id: 'n2',
        projectId: 'p1',
        body: 'On t2',
        taskId: 't2',
      },
      { type: 'addNote', id: 'n3', projectId: 'p1', body: 'Loose' },
    );
    const { state: next, changed } = at(state, {
      type: 'moveTask',
      id: 't1',
      projectId: 'p2',
    });
    expect(next.tasks.t1?.projectId).toBe('p2');
    expect(next.notes.n1).toMatchObject({ projectId: 'p2', taskId: 't1' });
    expect(next.notes.n2?.projectId).toBe('p1');
    expect(next.notes.n3?.projectId).toBe('p1');
    expect(changed).toContainEqual({ col: 'notes', id: 'n1' });
    expect(changed).not.toContainEqual({ col: 'notes', id: 'n2' });

    const general = at(next, { type: 'moveTask', id: 't1', projectId: null });
    expect(general.state.notes.n1?.projectId).toBeNull();
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

describe('meetings', () => {
  const add: Op = {
    type: 'addMeeting',
    id: 'e1',
    projectId: 'p1',
    title: 'Review',
    date: '2026-10-27',
    time: '14:00',
  };

  it('addMeeting, editMeeting and deleteMeeting log their text', () => {
    let { state } = at(base(), add);
    expect(state.meetings.e1).toEqual({
      id: 'e1',
      projectId: 'p1',
      title: 'Review',
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

    const T2 = '2026-10-23T11:00:00.000Z';
    state = reduce(
      state,
      { type: 'editMeeting', id: 'e1', patch: { title: 'Launch review' } },
      T2,
    ).state;
    expect(state.meetings.e1).toMatchObject({
      title: 'Launch review',
      updatedAt: T2,
    });
    expect(lastLog(state, 'p1')).toBe('Edited meeting "Launch review"');
    expect(state.projects.p1?.updatedAt).toBe(T2);

    state = at(state, { type: 'deleteMeeting', id: 'e1' }).state;
    expect(state.meetings.e1).toBeUndefined();
    expect(lastLog(state, 'p1')).toBe('Deleted meeting "Launch review"');
  });

  it('has no type, and refuses a meeting that is gone', () => {
    const { state } = at(base(), add);
    expect(state.meetings.e1).not.toHaveProperty('type');
    expect(() =>
      at(base(), { type: 'editMeeting', id: 'e9', patch: { title: 'x' } }),
    ).toThrow('That meeting no longer exists');
    expect(() => at(base(), { type: 'deleteMeeting', id: 'e9' })).toThrow(
      'That meeting no longer exists',
    );
  });

  it('moving a meeting logs in its new project and bumps both', () => {
    const state = run(base(), add, {
      type: 'createProject',
      id: 'p2',
      name: 'Falcon',
    });
    const T2 = '2026-10-23T11:00:00.000Z';
    const { state: next } = reduce(
      state,
      { type: 'editMeeting', id: 'e1', patch: { projectId: 'p2' } },
      T2,
    );
    expect(next.meetings.e1?.projectId).toBe('p2');
    expect(lastLog(next, 'p2')).toBe('Edited meeting "Review"');
    expect(next.projects.p1?.updatedAt).toBe(T2);
    expect(next.projects.p2?.updatedAt).toBe(T2);
  });

  it('deleting a meeting keeps its notes', () => {
    const state = run(base(), add, {
      type: 'addNote',
      id: 'n1',
      projectId: 'p1',
      body: 'Prep',
      meetingId: 'e1',
      phase: 'pre',
    });
    const { state: next } = at(state, { type: 'deleteMeeting', id: 'e1' });
    expect(next.notes.n1).toMatchObject({ meetingId: 'e1', phase: 'pre' });
  });
});

describe('action items', () => {
  const meetingIn = (projectId: string | null): Op => ({
    type: 'addMeeting',
    id: 'e1',
    projectId,
    title: 'Review',
    date: '2026-10-27',
  });

  it('addTask with a meeting: the meeting’s project, linked, its log line', () => {
    const state = run(base(), meetingIn('p1'), {
      type: 'createProject',
      id: 'p2',
      name: 'Hoth',
    });
    const T2 = '2026-10-23T11:00:00.000Z';
    const { state: next, changed } = at(
      state,
      {
        type: 'addTask',
        id: 't3',
        projectId: 'p2',
        title: 'Send the redline',
        meetingId: 'e1',
      },
      T2,
    );
    expect(next.tasks.t3).toMatchObject({
      projectId: 'p1',
      meetingId: 'e1',
      status: 'open',
      order: 3,
    });
    expect(lastLog(next, 'p1')).toBe(
      'Added action item "Send the redline" to "Review"',
    );
    expect(lastLog(next, 'p2')).not.toContain('Send the redline');
    expect(next.projects.p1?.updatedAt).toBe(T2);
    // The meeting itself is not rewritten.
    expect(next.meetings.e1).toBe(state.meetings.e1);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'projects', id: 'p1' },
      { col: 'tasks', id: 't3' },
    ]);
  });

  it('a General meeting’s action item is General’s', () => {
    const state = run(base(), meetingIn(null));
    const { state: next } = at(state, {
      type: 'addTask',
      id: 't3',
      projectId: 'p1',
      title: 'Book the room',
      meetingId: 'e1',
    });
    expect(next.tasks.t3).toMatchObject({ projectId: null, meetingId: 'e1' });
    expect(lastLog(next, GENERAL)).toBe(
      'Added action item "Book the room" to "Review"',
    );
  });

  it('a task from no meeting has no meetingId at all', () => {
    expect(base().tasks.t1).not.toHaveProperty('meetingId');
  });

  it('addTask refuses a meeting that is gone', () => {
    expect(() =>
      at(base(), {
        type: 'addTask',
        id: 't3',
        projectId: 'p1',
        title: 'x',
        meetingId: 'e9',
      }),
    ).toThrow('That meeting no longer exists');
  });

  it('deleteMeeting keeps its action items, unlinked', () => {
    const state = run(
      base(),
      meetingIn('p1'),
      {
        type: 'addTask',
        id: 't3',
        projectId: 'p1',
        title: 'Send the redline',
        meetingId: 'e1',
      },
      { type: 'toggleTask', id: 't3', done: true },
    );
    const { state: next, changed } = at(state, {
      type: 'deleteMeeting',
      id: 'e1',
    });
    expect(next.meetings.e1).toBeUndefined();
    expect(next.tasks.t3).toEqual({ ...state.tasks.t3, meetingId: null });
    expect(next.tasks.t1).toBe(state.tasks.t1);
    expect(changed).toContainEqual({ col: 'tasks', id: 't3' });
    expect(changed).not.toContainEqual({ col: 'tasks', id: 't1' });
    expect(lastLog(next, 'p1')).toBe('Deleted meeting "Review"');
  });

  it('moving an action item to another project keeps its meeting', () => {
    const state = run(
      base(),
      meetingIn('p1'),
      { type: 'createProject', id: 'p2', name: 'Hoth' },
      {
        type: 'addTask',
        id: 't3',
        projectId: 'p1',
        title: 'Send the redline',
        meetingId: 'e1',
      },
    );
    const { state: next } = at(state, {
      type: 'moveTask',
      id: 't3',
      projectId: 'p2',
    });
    expect(next.tasks.t3).toMatchObject({ projectId: 'p2', meetingId: 'e1' });
  });
});

describe('topics', () => {
  const meeting: Op = {
    type: 'addMeeting',
    id: 'e1',
    projectId: 'p1',
    title: 'Review',
    date: '2026-10-27',
  };
  const add = (id: string, title: string, after?: string): Op => ({
    type: 'addTopic',
    meetingId: 'e1',
    id,
    title,
    ...(after ? { after } : {}),
  });
  const T2 = '2026-10-24T09:00:00.000Z';
  /** A meeting `e1` on `p1` with topics a, b and c, in that order. */
  const three = () =>
    run(
      base(),
      meeting,
      add('a', 'Shields'),
      add('b', 'Doors'),
      add('c', 'Power'),
    );
  const ids = (state: Snapshot) => state.meetings.e1?.topics?.map((t) => t.id);
  /** Every op bumps the meeting and its project, nothing else in the log. */
  const bumped = (state: Snapshot) => {
    expect(state.meetings.e1?.updatedAt).toBe(T2);
    expect(state.projects.p1?.updatedAt).toBe(T2);
  };

  it('addTopic appends, logs its text and bumps the meeting and project', () => {
    const before = run(base(), meeting);
    expect(before.meetings.e1).not.toHaveProperty('topics');
    const { state, changed } = reduce(freeze(before), add('a', 'Shields'), T2);
    expect(state.meetings.e1?.topics).toEqual([
      { id: 'a', title: 'Shields', done: false, outcome: '' },
    ]);
    expect(lastLog(state, 'p1')).toBe('Added topic "Shields" to "Review"');
    bumped(state);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'meetings', id: 'e1' },
      { col: 'projects', id: 'p1' },
    ]);
  });

  it('addTopic with `carriedFrom` keeps the day and logs a carry', () => {
    const { state } = at(run(base(), meeting), {
      type: 'addTopic',
      meetingId: 'e1',
      id: 'a',
      title: 'Shields',
      carriedFrom: '2026-10-20',
    });
    expect(state.meetings.e1?.topics).toEqual([
      {
        id: 'a',
        title: 'Shields',
        done: false,
        outcome: '',
        carriedFrom: '2026-10-20',
      },
    ]);
    expect(lastLog(state, 'p1')).toBe(
      'Carried topic "Shields" forward to "Review"',
    );
    expect(() =>
      OpSchema.parse({
        type: 'addTopic',
        meetingId: 'e1',
        id: 'b',
        title: 'Doors',
        carriedFrom: '2026-02-30',
      }),
    ).toThrow();
  });

  it('addTopic with `after` inserts right after that topic', () => {
    let state = run(three(), add('d', 'Comms', 'a'));
    expect(ids(state)).toEqual(['a', 'd', 'b', 'c']);
    state = run(state, add('e', 'Exit', 'c'));
    expect(ids(state)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(() => at(state, add('f', 'Lost', 'zz'))).toThrow(
      'That topic no longer exists',
    );
  });

  it('addTopic refuses a duplicate id, a missing meeting and topic 51', () => {
    const state = three();
    expect(() => at(state, add('a', 'Again'))).toThrow(
      'That topic already exists',
    );
    expect(() =>
      at(state, { type: 'addTopic', meetingId: 'e9', id: 'x', title: 'X' }),
    ).toThrow('That meeting no longer exists');
    const full = run(
      base(),
      meeting,
      ...Array.from({ length: LIMITS.topicsMax }, (_, i) =>
        add(`t${i}`, `Topic ${i}`),
      ),
    );
    expect(full.meetings.e1?.topics).toHaveLength(LIMITS.topicsMax);
    expect(() => at(full, add('over', 'One more'))).toThrow(
      `A meeting has ${LIMITS.topicsMax} topics at most`,
    );
  });

  it('editTopic changes the title or outcome, silently', () => {
    const state = three();
    const { state: next } = reduce(
      freeze(state),
      {
        type: 'editTopic',
        meetingId: 'e1',
        id: 'b',
        patch: { title: 'Blast doors', outcome: 'Fixed by Friday' },
      },
      T2,
    );
    expect(next.meetings.e1?.topics?.[1]).toEqual({
      id: 'b',
      title: 'Blast doors',
      done: false,
      outcome: 'Fixed by Friday',
    });
    expect(next.activity.p1).toBe(state.activity.p1);
    bumped(next);
    expect(() =>
      at(state, {
        type: 'editTopic',
        meetingId: 'e1',
        id: 'zz',
        patch: { title: 'X' },
      }),
    ).toThrow('That topic no longer exists');
  });

  it('toggleTopic says the outcome, silently, and is idempotent', () => {
    const state = three();
    const op: Op = {
      type: 'toggleTopic',
      meetingId: 'e1',
      id: 'c',
      done: true,
    };
    const { state: next } = reduce(freeze(state), op, T2);
    expect(next.meetings.e1?.topics?.map((t) => t.done)).toEqual([
      false,
      false,
      true,
    ]);
    expect(next.activity.p1).toBe(state.activity.p1);
    bumped(next);
    const again = reduce(freeze(next), op, T1);
    expect(again.state).toBe(next);
    expect(again.changed).toEqual([]);
    const back = reduce(next, { ...op, done: false }, T1).state;
    expect(back.meetings.e1?.topics?.[2]?.done).toBe(false);
  });

  it('reorderTopics takes every id in the new order, silently', () => {
    const state = three();
    const { state: next } = reduce(
      freeze(state),
      { type: 'reorderTopics', meetingId: 'e1', ids: ['c', 'a', 'b'] },
      T2,
    );
    expect(ids(next)).toEqual(['c', 'a', 'b']);
    expect(next.activity.p1).toBe(state.activity.p1);
    bumped(next);
    const same = at(next, {
      type: 'reorderTopics',
      meetingId: 'e1',
      ids: ['c', 'a', 'b'],
    });
    expect(same.state).toBe(next);
  });

  it('reorderTopics refuses a list that omits, repeats or invents an id', () => {
    const state = freeze(three());
    for (const list of [
      ['c', 'a'],
      ['c', 'a', 'a'],
      ['c', 'a', 'b', 'z'],
      ['c', 'a', 'z'],
    ]) {
      expect(() =>
        reduce(
          state,
          { type: 'reorderTopics', meetingId: 'e1', ids: list },
          T2,
        ),
      ).toThrow(OpError);
    }
    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(state.meetings.e1?.updatedAt).not.toBe(T2);
  });

  it('deleteTopic logs its text and bumps the meeting and project', () => {
    const { state } = reduce(
      freeze(three()),
      { type: 'deleteTopic', meetingId: 'e1', id: 'b' },
      T2,
    );
    expect(ids(state)).toEqual(['a', 'c']);
    expect(lastLog(state, 'p1')).toBe('Removed topic "Doors" from "Review"');
    bumped(state);
    expect(() =>
      at(state, { type: 'deleteTopic', meetingId: 'e1', id: 'b' }),
    ).toThrow('That topic no longer exists');
  });

  it('logs in General for a meeting without a project', () => {
    const state = run(
      emptySnapshot(),
      { ...meeting, projectId: null } as Op,
      add('a', 'Shields'),
    );
    expect(lastLog(state, GENERAL)).toBe('Added topic "Shields" to "Review"');
  });

  it('deleteMeeting takes its topics with it', () => {
    const { state, changed } = at(three(), { type: 'deleteMeeting', id: 'e1' });
    expect(state.meetings.e1).toBeUndefined();
    expect(changed).toContainEqual({
      col: 'meetings',
      id: 'e1',
      deleted: true,
    });
  });

  it('merge() replaces a meeting, topics and all, by id', () => {
    const state = three();
    const e1 = state.meetings.e1;
    if (!e1) throw new Error('No meeting');
    const incoming = ExportSchema.parse({
      exportedAt: T2,
      meetings: {
        e1: { ...e1, topics: [{ id: 'z', title: 'Only this', done: true }] },
      },
    });
    const { state: next } = merge(state, incoming);
    expect(next.meetings.e1?.topics).toEqual([
      { id: 'z', title: 'Only this', done: true, outcome: '' },
    ]);
  });
});

describe('milestones', () => {
  const add = (id: string, title: string, date: string): Op => ({
    type: 'addMilestone',
    projectId: 'p1',
    id,
    title,
    date,
  });

  it('addMilestone, editMilestone and deleteMilestone log their text', () => {
    let { state, changed } = at(base(), add('m1', 'Launch', '2026-11-14'));
    expect(state.projects.p1?.milestones).toEqual([
      { id: 'm1', title: 'Launch', date: '2026-11-14' },
    ]);
    expect(lastLog(state, 'p1')).toBe(
      'Added milestone "Launch" (Sat 14 Nov 2026)',
    );
    expect(state.projects.p1?.updatedAt).toBe(T1);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'projects', id: 'p1' },
    ]);

    const T2 = '2026-10-23T11:00:00.000Z';
    state = reduce(
      state,
      {
        type: 'editMilestone',
        projectId: 'p1',
        id: 'm1',
        patch: { title: 'Go live', date: '2026-11-20' },
      },
      T2,
    ).state;
    expect(state.projects.p1?.milestones).toEqual([
      { id: 'm1', title: 'Go live', date: '2026-11-20' },
    ]);
    expect(lastLog(state, 'p1')).toBe('Edited milestone "Go live"');
    expect(state.projects.p1?.updatedAt).toBe(T2);

    const T3 = '2026-10-23T12:00:00.000Z';
    ({ state, changed } = reduce(
      state,
      { type: 'deleteMilestone', projectId: 'p1', id: 'm1' },
      T3,
    ));
    expect(state.projects.p1?.milestones).toEqual([]);
    expect(lastLog(state, 'p1')).toBe('Deleted milestone "Go live"');
    expect(state.projects.p1?.updatedAt).toBe(T3);
  });

  it('keeps them by date, then title, through adds and edits', () => {
    let state = run(
      base(),
      add('m1', 'Beta', '2026-12-01'),
      add('m2', 'Alpha', '2026-11-01'),
      add('m3', 'Also beta', '2026-12-01'),
    );
    const ids = () => state.projects.p1?.milestones?.map((m) => m.id);
    expect(ids()).toEqual(['m2', 'm3', 'm1']);
    state = at(state, {
      type: 'editMilestone',
      projectId: 'p1',
      id: 'm2',
      patch: { date: '2027-01-01' },
    }).state;
    expect(ids()).toEqual(['m3', 'm1', 'm2']);
  });

  it('reads a project without milestones as none, and refuses what is not there', () => {
    const state = base();
    expect(state.projects.p1).not.toHaveProperty('milestones');
    expect(() =>
      at(state, {
        type: 'editMilestone',
        projectId: 'p1',
        id: 'm9',
        patch: { title: 'x' },
      }),
    ).toThrow('That milestone no longer exists');
    expect(() =>
      at(state, { type: 'deleteMilestone', projectId: 'p1', id: 'm9' }),
    ).toThrow('That milestone no longer exists');
    expect(() =>
      at(state, {
        type: 'addMilestone',
        projectId: 'p9',
        id: 'm1',
        title: 'x',
        date: '2026-11-01',
      }),
    ).toThrow('That project no longer exists');
    const once = run(state, add('m1', 'Launch', '2026-11-14'));
    expect(() => at(once, add('m1', 'Again', '2026-11-15'))).toThrow(
      'That milestone already exists',
    );
  });

  it(`caps a project at ${LIMITS.milestonesMax}`, () => {
    let state = base();
    for (let i = 0; i < LIMITS.milestonesMax; i += 1) {
      state = reduce(state, add(`m${i}`, `M${i}`, '2026-11-01'), T1).state;
    }
    expect(() => at(state, add('one-more', 'Too many', '2026-11-02'))).toThrow(
      `A project has ${LIMITS.milestonesMax} milestones at most`,
    );
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

  it('setBlocked logs who it waits on, and unblocking', () => {
    let state = base();
    state = at(state, {
      type: 'setBlocked',
      id: 't1',
      blocked: { on: 'u1', note: 'Needs the budget' },
    }).state;
    expect(state.tasks.t1?.blocked).toEqual({
      on: 'u1',
      note: 'Needs the budget',
    });
    expect(lastLog(state, 'p1')).toBe('Blocked "Heaters" on Leia Organa');
    expect(state.projects.p1?.updatedAt).toBe(T1);
    // The same again changes nothing.
    expect(
      at(state, {
        type: 'setBlocked',
        id: 't1',
        blocked: { on: 'u1', note: 'Needs the budget' },
      }).changed,
    ).toEqual([]);
    state = at(state, {
      type: 'setBlocked',
      id: 't2',
      blocked: { on: null, note: '' },
    }).state;
    expect(lastLog(state, 'p1')).toBe('Blocked "Doors"');
    state = at(state, { type: 'setBlocked', id: 't1', blocked: null }).state;
    expect(lastLog(state, 'p1')).toBe('Unblocked "Heaters"');
    // A task that never had the field is not blocked.
    expect(
      at(base(), { type: 'setBlocked', id: 't1', blocked: null }).changed,
    ).toEqual([]);
    expect(() =>
      at(base(), {
        type: 'setBlocked',
        id: 't1',
        blocked: { on: 'ghost', note: '' },
      }),
    ).toThrow('That person no longer exists');
  });

  it('decisions: propose, decide (dated), revisit, edit, delete, with their log lines', () => {
    let state = base();
    state = at(state, {
      type: 'addDecision',
      id: 'd1',
      projectId: 'p1',
      title: 'Move to Hoth',
      deciders: ['u1'],
    }).state;
    expect(state.decisions.d1).toMatchObject({
      status: 'proposed',
      decidedAt: '',
      rationale: '',
      deciders: ['u1'],
    });
    expect(lastLog(state, 'p1')).toBe('Proposed "Move to Hoth"');
    state = at(state, {
      type: 'setDecisionStatus',
      id: 'd1',
      status: 'decided',
      day: '2026-10-21',
    }).state;
    expect(state.decisions.d1?.decidedAt).toBe('2026-10-21');
    expect(lastLog(state, 'p1')).toBe('Decided "Move to Hoth"');
    state = at(state, {
      type: 'setDecisionStatus',
      id: 'd1',
      status: 'revisited',
    }).state;
    expect(lastLog(state, 'p1')).toBe('Revisited "Move to Hoth"');
    // Deciding again keeps the first date.
    state = at(state, {
      type: 'setDecisionStatus',
      id: 'd1',
      status: 'decided',
    }).state;
    expect(state.decisions.d1?.decidedAt).toBe('2026-10-21');
    expect(
      at(state, { type: 'setDecisionStatus', id: 'd1', status: 'decided' })
        .changed,
    ).toEqual([]);
    state = at(state, {
      type: 'editDecision',
      id: 'd1',
      patch: { rationale: 'Further from the core' },
    }).state;
    expect(lastLog(state, 'p1')).toBe('Edited decision "Move to Hoth"');
    state = at(state, { type: 'deleteDecision', id: 'd1' }).state;
    expect(state.decisions.d1).toBeUndefined();
    expect(lastLog(state, 'p1')).toBe('Deleted decision "Move to Hoth"');
  });

  it('a decision made decided starts dated; it outlives its project and deciders', () => {
    let state = run(
      base(),
      {
        type: 'addDecision',
        id: 'd1',
        projectId: 'p1',
        title: 'Shields first',
        status: 'decided',
        decidedAt: '2026-10-01',
        deciders: ['u1'],
      },
      { type: 'removePerson', id: 'u1' },
    );
    expect(lastLog(state, 'p1')).toBe('Decided "Shields first"');
    expect(state.decisions.d1?.deciders).toEqual([]);
    state = run(state, { type: 'deleteProject', id: 'p1' });
    expect(state.decisions.d1?.projectId).toBeNull();
  });

  it('organizeOrgs makes orgs from project text, links them, and is idempotent', () => {
    let state = run(
      base(),
      { type: 'editProject', id: 'p1', patch: { org: 'Rebel Alliance' } },
      {
        type: 'createProject',
        id: 'p2',
        name: 'Falcon',
        org: 'rebel alliance',
      },
      { type: 'createProject', id: 'p3', name: 'Yavin', org: 'Corellia' },
    );
    const plan = {
      type: 'organizeOrgs' as const,
      orgs: [
        { id: 'o1', name: 'Rebel Alliance' },
        { id: 'o2', name: 'Corellia', kind: 'vendor' as const },
      ],
    };
    state = at(state, plan).state;
    expect(Object.keys(state.orgs).sort()).toEqual(['o1', 'o2']);
    expect(state.orgs.o2?.kind).toBe('vendor');
    expect(state.projects.p1?.orgId).toBe('o1');
    // Case does not matter.
    expect(state.projects.p2?.orgId).toBe('o1');
    expect(state.projects.p3?.orgId).toBe('o2');
    expect(lastLog(state, 'general')).toBe(
      'Organized orgs: 2 new, 3 projects linked',
    );
    // Again, even with fresh ids: nothing changes.
    expect(
      at(state, {
        type: 'organizeOrgs',
        orgs: [{ id: 'o9', name: 'Rebel Alliance' }],
      }).changed,
    ).toEqual([]);
  });

  it('renaming an org renames it on its projects; deleting keeps the text', () => {
    let state = run(
      base(),
      { type: 'addOrg', id: 'o1', name: 'Alliance' },
      {
        type: 'editProject',
        id: 'p1',
        patch: { org: 'Alliance', orgId: 'o1' },
      },
      { type: 'editOrg', id: 'o1', patch: { name: 'Rebel Alliance' } },
    );
    expect(state.projects.p1).toMatchObject({
      org: 'Rebel Alliance',
      orgId: 'o1',
    });
    expect(() =>
      at(state, { type: 'addOrg', id: 'o2', name: 'rebel alliance' }),
    ).toThrow('There is already an org called rebel alliance');
    state = at(state, { type: 'deleteOrg', id: 'o1' }).state;
    expect(state.orgs.o1).toBeUndefined();
    expect(state.projects.p1?.org).toBe('Rebel Alliance');
    expect(state.projects.p1?.orgId).toBeUndefined();
    expect(() =>
      at(state, { type: 'editProject', id: 'p1', patch: { orgId: 'o1' } }),
    ).toThrow('That org no longer exists');
  });

  it('a template starts a project with its tasks in order and its tags', () => {
    let state = run(emptySnapshot(), {
      type: 'addTemplate',
      id: 'tp',
      name: 'Kickoff',
      tasks: [
        { title: 'Kickoff call', priority: 'high', tags: ['setup'] },
        { title: 'Access requests', priority: 'none', tags: [] },
      ],
      defaultTags: ['client', 'new'],
    });
    state = at(state, {
      type: 'createProject',
      id: 'p1',
      name: 'Echo Base',
      tags: ['new'],
      template: { id: 'tp', taskIds: ['k1', 'k2'] },
    }).state;
    expect(state.projects.p1?.tags).toEqual(['new', 'client']);
    expect(state.tasks.k1).toMatchObject({
      title: 'Kickoff call',
      projectId: 'p1',
      priority: 'high',
      tags: ['setup'],
      order: 1,
      status: 'open',
    });
    expect(state.tasks.k2?.order).toBe(2);
    expect(lastLog(state, 'p1')).toBe(
      'Created project from template "Kickoff"',
    );
    // Ids must match the template's tasks one for one.
    expect(() =>
      at(state, {
        type: 'createProject',
        id: 'p2',
        name: 'Hoth',
        template: { id: 'tp', taskIds: ['x1'] },
      }),
    ).toThrow('That template changed. Try again.');
    expect(() =>
      at(state, {
        type: 'createProject',
        id: 'p3',
        name: 'Hoth',
        template: { id: 'gone', taskIds: [] },
      }),
    ).toThrow('That template no longer exists');
    state = run(
      state,
      { type: 'editTemplate', id: 'tp', patch: { name: 'Client kickoff' } },
      { type: 'deleteTemplate', id: 'tp' },
    );
    expect(state.templates.tp).toBeUndefined();
  });

  it('removePerson keeps a task blocked but on no one listed', () => {
    const state = run(base(), {
      type: 'setBlocked',
      id: 't1',
      blocked: { on: 'u1', note: 'Budget' },
    });
    const next = at(state, { type: 'removePerson', id: 'u1' }).state;
    expect(next.tasks.t1?.blocked).toEqual({ on: null, note: 'Budget' });
  });

  it('removePerson unassigns them and drops them from members and attendees; mentions stay', () => {
    const state = run(
      base(),
      {
        type: 'editTask',
        id: 't1',
        patch: { assignee: 'u1', desc: 'Ask @{u1}' },
      },
      { type: 'addPerson', id: 'u2', name: 'Han Solo' },
      { type: 'editTask', id: 't2', patch: { assignee: 'u2' } },
      { type: 'editProject', id: 'p1', patch: { members: ['u1', 'u2'] } },
      {
        type: 'addMeeting',
        id: 'e1',
        projectId: 'p1',
        title: 'Briefing',
        date: '2026-10-27',
        attendees: ['u2', 'u1'],
      },
    );
    const { state: next } = at(state, { type: 'removePerson', id: 'u1' });
    expect(next.people.u1).toBeUndefined();
    expect(next.tasks.t1).toMatchObject({ assignee: '', desc: 'Ask @{u1}' });
    expect(next.tasks.t2?.assignee).toBe('u2');
    expect(next.projects.p1?.members).toEqual(['u2']);
    expect(next.meetings.e1?.attendees).toEqual(['u2']);
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

describe('batch', () => {
  it('applies every op as one change, logging each', () => {
    const { state, changed } = at(base(), {
      type: 'batch',
      ops: [
        { type: 'toggleTask', id: 't1', done: true },
        { type: 'toggleTask', id: 't2', done: true },
      ],
    });
    expect(state.tasks.t1?.status).toBe('done');
    expect(state.tasks.t2?.status).toBe('done');
    expect(state.activity.p1?.events.slice(0, 2).map((e) => e.text)).toEqual([
      'Closed "Doors"',
      'Closed "Heaters"',
    ]);
    expect(sorted(changed)).toEqual([
      { col: 'activity', id: 'p1' },
      { col: 'projects', id: 'p1' },
      { col: 'tasks', id: 't1' },
      { col: 'tasks', id: 't2' },
    ]);
  });

  it('is all or nothing', () => {
    const state = freeze(base());
    expect(() =>
      reduce(
        state,
        {
          type: 'batch',
          ops: [
            { type: 'toggleTask', id: 't1', done: true },
            { type: 'deleteTask', id: 'ghost' },
          ],
        },
        T1,
      ),
    ).toThrow('That task no longer exists');
    expect(state.tasks.t1?.status).toBe('open');
  });
});

describe('settings', () => {
  it('starts from the defaults and stores a patch, unlogged', () => {
    const state = base();
    // No default org until you pick one.
    expect(settingsOf(state)).toEqual({ defaultOrg: '' });
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

describe('page preferences (#186)', () => {
  const pages = (state: Snapshot) => settingsOf(state).pages;
  const many = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'x']));

  it('setPagePrefs merges a patch, unlogged, and leaves the default org', () => {
    const state = run(base(), {
      type: 'setSettings',
      patch: { defaultOrg: 'Rebel Alliance' },
    });
    const { state: next, changed } = at(state, {
      type: 'setPagePrefs',
      page: 'tasks',
      patch: { view: 'board', group: 'due', filters: { status: 'done' } },
    });
    expect(pages(next)).toEqual({
      tasks: { view: 'board', group: 'due', filters: { status: 'done' } },
    });
    expect(settingsOf(next).defaultOrg).toBe('Rebel Alliance');
    expect(changed).toEqual([{ col: 'settings', id: 'user' }]);
    // Not logged: no activity text anywhere.
    expect(next.activity).toBe(state.activity);
  });

  it('merges key by key; null clears, and an emptied page goes', () => {
    const state = run(
      base(),
      {
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { view: 'board', filters: { status: 'done', who: 'mine' } },
      },
      {
        type: 'setPagePrefs',
        page: 'focus',
        patch: { sections: { 'day:later': true } },
      },
    );
    const next = run(state, {
      type: 'setPagePrefs',
      page: 'tasks',
      patch: { sort: 'title', filters: { who: null } },
    });
    expect(pages(next)?.tasks).toEqual({
      view: 'board',
      sort: 'title',
      filters: { status: 'done' },
    });
    const cleared = run(next, {
      type: 'setPagePrefs',
      page: 'tasks',
      patch: { view: null, sort: null, filters: { status: null } },
    });
    expect(pages(cleared)).toEqual({
      focus: { sections: { 'day:later': true } },
    });
  });

  it('resetPagePrefs resets one page, or every page, unlogged', () => {
    const state = run(
      base(),
      { type: 'setPagePrefs', page: 'tasks', patch: { view: 'board' } },
      { type: 'setPagePrefs', page: 'notes', patch: { view: 'grid' } },
    );
    const one = at(state, { type: 'resetPagePrefs', page: 'tasks' });
    expect(pages(one.state)).toEqual({ notes: { view: 'grid' } });
    expect(one.state.activity).toBe(state.activity);
    const all = at(state, { type: 'resetPagePrefs', page: null });
    // Kept, empty: the space has saved (nothing), so nothing carries over.
    expect(pages(all.state)).toEqual({});
    expect(all.changed).toEqual([{ col: 'settings', id: 'user' }]);
  });

  it('refuses more saved filters or sections than the limits', () => {
    const full = run(base(), {
      type: 'setPagePrefs',
      page: 'tasks',
      patch: {
        filters: many(LIMITS.prefFiltersMax),
        sections: Object.fromEntries(
          Array.from({ length: LIMITS.prefSectionsMax }, (_, i) => [
            `s${i}`,
            false,
          ]),
        ),
      },
    });
    expect(() =>
      at(full, {
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { filters: { extra: 'x' } },
      }),
    ).toThrow(`${LIMITS.prefFiltersMax} saved filters per page at most`);
    expect(() =>
      at(full, {
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { sections: { extra: true } },
      }),
    ).toThrow(OpError);
  });

  it('validates the ops: known pages, sizes, something to change', () => {
    const ok = (op: unknown) => OpSchema.safeParse(op).success;
    expect(
      ok({ type: 'setPagePrefs', page: 'tasks', patch: { view: 'board' } }),
    ).toBe(true);
    expect(ok({ type: 'resetPagePrefs', page: null })).toBe(true);
    expect(ok({ type: 'resetPagePrefs', page: 'project' })).toBe(true);
    expect(
      ok({ type: 'setPagePrefs', page: 'orgs', patch: { view: 'x' } }),
    ).toBe(false);
    expect(ok({ type: 'setPagePrefs', page: 'tasks', patch: {} })).toBe(false);
    expect(
      ok({
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { view: 'x'.repeat(LIMITS.prefValueMax + 1) },
      }),
    ).toBe(false);
    expect(
      ok({
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { filters: { 'Not a key': 'x' } },
      }),
    ).toBe(false);
    expect(
      ok({
        type: 'setPagePrefs',
        page: 'tasks',
        patch: { filters: many(LIMITS.prefFiltersMax + 1) },
      }),
    ).toBe(false);
  });

  it('round-trips through an export; one without pages imports unchanged', () => {
    const state = run(base(), {
      type: 'setPagePrefs',
      page: 'project',
      patch: { view: 'board', sections: { activity: true } },
    });
    const file = JSON.parse(JSON.stringify({ exportedAt: T1, ...state }));
    const { state: next } = merge(emptySnapshot(), ExportSchema.parse(file));
    expect(pages(next)).toEqual({
      project: { view: 'board', sections: { activity: true } },
    });
    // An older export: settings without pages stay without pages.
    const old = ExportSchema.parse({
      settings: { user: { defaultOrg: 'Rebel Alliance' } },
    });
    expect(old.settings.user).toEqual({ defaultOrg: 'Rebel Alliance' });
    // A page this version does not know is dropped, not refused.
    const future = ExportSchema.parse({
      settings: {
        user: { defaultOrg: '', pages: { tasks: { view: 'x' }, later: {} } },
      },
    });
    expect(future.settings.user?.pages).toEqual({ tasks: { view: 'x' } });
  });
});

describe('merge (import)', () => {
  it('round-trips a task’s notes, and leaves a note without taskId as it was', () => {
    const state = run(
      base(),
      {
        type: 'addNote',
        id: 'n1',
        projectId: 'p1',
        body: 'On t1',
        taskId: 't1',
      },
      { type: 'addNote', id: 'n2', projectId: 'p1', body: 'Loose' },
    );
    const file = JSON.parse(JSON.stringify({ exportedAt: T1, ...state }));
    const { state: next } = merge(emptySnapshot(), ExportSchema.parse(file));
    expect(next.notes).toEqual(state.notes);
    expect(next.notes.n1?.taskId).toBe('t1');

    // An export from before taskId.
    const { taskId: _, ...old } = state.notes.n2 as NonNullable<
      typeof state.notes.n2
    >;
    const before = ExportSchema.parse({ exportedAt: T1, notes: { n2: old } });
    expect(before.notes.n2).toEqual(old);
    const merged = merge(emptySnapshot(), before).state.notes.n2;
    expect(merged).toEqual(old);
    expect(merged?.taskId ?? null).toBeNull();
  });

  it('round-trips an action item, and leaves a task without meetingId as it was', () => {
    const state = run(
      base(),
      {
        type: 'addMeeting',
        id: 'e1',
        projectId: 'p1',
        title: 'Review',
        date: '2026-10-27',
      },
      {
        type: 'addTask',
        id: 't3',
        projectId: 'p1',
        title: 'Send the redline',
        meetingId: 'e1',
      },
    );
    const file = JSON.parse(JSON.stringify({ exportedAt: T1, ...state }));
    const { state: next } = merge(emptySnapshot(), ExportSchema.parse(file));
    expect(next.tasks).toEqual(state.tasks);
    expect(next.tasks.t3?.meetingId).toBe('e1');

    // An export from before meetingId.
    const old = state.tasks.t1 as NonNullable<typeof state.tasks.t1>;
    expect(old).not.toHaveProperty('meetingId');
    const before = ExportSchema.parse({ exportedAt: T1, tasks: { t1: old } });
    expect(before.tasks.t1).toEqual(old);
    const merged = merge(emptySnapshot(), before).state.tasks.t1;
    expect(merged).toEqual(old);
    expect(merged?.meetingId ?? null).toBeNull();
  });

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

describe('setNav', () => {
  it('stores order, hidden and extras, unlogged, and validates names', () => {
    const state = base();
    expect(settingsOf(state).nav).toBeUndefined();
    const { state: next, changed } = at(state, {
      type: 'setNav',
      patch: { order: ['tasks', 'focus'], hidden: ['meetings'] },
    });
    expect(settingsOf(next).nav).toEqual({
      order: ['tasks', 'focus'],
      hidden: ['meetings'],
    });
    expect(settingsOf(next).defaultOrg).toBe('');
    expect(changed).toEqual([{ col: 'settings', id: 'user' }]);
    // Not logged, like setSettings.
    expect(next.activity).toBe(state.activity);
    expect(
      OpSchema.safeParse({ type: 'setNav', patch: { hidden: ['people'] } })
        .success,
    ).toBe(false);
    expect(OpSchema.safeParse({ type: 'setNav', patch: {} }).success).toBe(
      false,
    );
  });

  it('merges extras switch by switch and keeps the other keys', () => {
    const state = run(
      base(),
      { type: 'setSettings', patch: { defaultOrg: 'Rebel Alliance' } },
      { type: 'setNav', patch: { extras: { digest: false } } },
      { type: 'setNav', patch: { extras: { archived: false } } },
      { type: 'setNav', patch: { hidden: ['notes', 'notes'] } },
    );
    expect(settingsOf(state)).toEqual({
      defaultOrg: 'Rebel Alliance',
      nav: { extras: { digest: false, archived: false }, hidden: ['notes'] },
    });
  });

  it('clears keys with null, and resets to no nav at all', () => {
    const state = run(
      base(),
      { type: 'setSettings', patch: { defaultOrg: 'Rebel Alliance' } },
      {
        type: 'setNav',
        patch: {
          order: ['notes'],
          hidden: ['focus'],
          extras: { activeProjects: false },
        },
      },
    );
    const one = at(state, { type: 'setNav', patch: { hidden: null } }).state;
    expect(settingsOf(one).nav).toEqual({
      order: ['notes'],
      extras: { activeProjects: false },
    });
    const reset = at(state, {
      type: 'setNav',
      patch: { order: null, hidden: null, extras: null },
    }).state;
    expect(reset.settings.user).toEqual({ defaultOrg: 'Rebel Alliance' });
  });

  it('imports an export without nav unchanged, and one with stale names', () => {
    const file = JSON.parse(JSON.stringify({ exportedAt: T1, ...base() }));
    const old = merge(emptySnapshot(), ExportSchema.parse(file)).state;
    expect(settingsOf(old).nav).toBeUndefined();

    file.settings = {
      user: {
        defaultOrg: '',
        nav: { order: ['reports', 'notes'], hidden: ['people'] },
      },
    };
    const next = merge(emptySnapshot(), ExportSchema.parse(file)).state;
    // Kept as stored; `navOf` ignores what it does not know.
    expect(settingsOf(next).nav).toEqual({
      order: ['reports', 'notes'],
      hidden: ['people'],
    });
  });
});
