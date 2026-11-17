import { describe, expect, it } from 'vitest';
import { lanesOf } from '#shared/loops';
import {
  buildStream,
  meetingTouches,
  noteTouches,
  projectKeep,
  projectStateLine,
  projectStream,
  roomPeople,
} from '#shared/stream';
import {
  emptySnapshot,
  type Meeting,
  type Note,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

/** Noon UTC: the same local day in every zone the suite runs in. */
const at = (day: string, hh = '12') => `${day}T${hh}:00:00.000Z`;

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    org: '',
    status: 'active',
    priority: 'med',
    targetDate: '',
    tags: [],
    desc: '',
    state: '',
    members: [],
    links: [],
    archived: false,
    createdAt: at('2026-11-01'),
    updatedAt: at('2026-11-01'),
    ...patch,
  };
}

function person(id: string, patch: Partial<Person> = {}): Person {
  return { id, name: id, role: '', me: false, ...patch } as Person;
}

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    projectId: 'p',
    status: 'open',
    priority: 'med',
    due: '',
    desc: '',
    assignee: '',
    tags: [],
    links: [],
    order: 0,
    createdAt: at('2026-11-02'),
    updatedAt: at('2026-11-02'),
    completedAt: null,
    ...patch,
  };
}

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    projectId: 'p',
    body: id,
    pinned: false,
    meetingId: null,
    phase: null,
    createdAt: at('2026-11-03'),
    ...patch,
  };
}

function meeting(id: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    projectId: 'p',
    title: id,
    date: '2026-11-04',
    time: '',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: at('2026-11-01'),
    updatedAt: at('2026-11-01'),
    ...patch,
  };
}

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id, i]));

function seed(): Snapshot {
  return {
    ...emptySnapshot(),
    projects: byId([
      project('p', {
        name: 'Echo',
        members: ['leia', 'han'],
        milestones: [{ id: 'ms', title: 'Live', date: '2026-11-20' }],
      }),
      project('q'),
    ]),
    people: byId([
      person('leia', { name: 'Leia' }),
      person('han', { name: 'Han' }),
      person('chewie', { name: 'Chewie' }),
      person('mon', { name: 'Mon' }),
      person('me', { name: 'Me', me: true }),
    ]),
    tasks: byId([
      task('t-han', { assignee: 'han' }),
      task('t-chewie', {
        blocked: { on: 'chewie', note: '' },
        createdAt: at('2026-11-05'),
      }),
      task('t-done', {
        status: 'done',
        desc: 'ask @{mon}',
        completedAt: at('2026-11-06'),
      }),
      task('t-other', { projectId: 'q', assignee: 'han' }),
    ]),
    notes: byId([
      note('n-han', { body: 'with @{han}', createdAt: at('2026-11-07') }),
      note('n-plain'),
      note('n-other', { projectId: 'q' }),
    ]),
    meetings: byId([
      meeting('m-han', { attendees: ['han'], time: '09:00' }),
      meeting('m-leia', { attendees: ['leia'], date: '2026-11-08' }),
    ]),
  };
}

describe('the stream', () => {
  it('has everything in the project, newest first, done tasks twice', () => {
    const keys = projectStream(seed(), 'p').map((i) => i.key);
    expect(keys).toEqual([
      'milestone:ms',
      'meeting:m-leia',
      'note:n-han',
      'done:t-done',
      'added:t-chewie',
      'meeting:m-han',
      'note:n-plain',
      'added:t-done',
      'added:t-han',
    ]);
  });

  it('leaves out notes deleted a moment ago', () => {
    const keys = projectStream(seed(), 'p', null, new Set(['n-han'])).map(
      (i) => i.key,
    );
    expect(keys).not.toContain('note:n-han');
  });

  it('puts notes before tasks within one minute', () => {
    const items = buildStream({
      notes: [note('n', { createdAt: at('2026-11-04', '00') })],
      tasks: [task('t', { createdAt: at('2026-11-04', '00') })],
      meetings: [],
    });
    expect(items.map((i) => i.kind)).toEqual(['note', 'task']);
  });
});

describe('narrowing a project room to a person', () => {
  it('keeps the tasks that touch them, notes that mention them, meetings they attend', () => {
    const keys = projectStream(seed(), 'p', 'han').map((i) => i.key);
    expect(keys).toEqual(['note:n-han', 'meeting:m-han', 'added:t-han']);
  });

  it('counts a mention in a task and a blocker as touching', () => {
    expect(projectStream(seed(), 'p', 'mon').map((i) => i.key)).toEqual([
      'done:t-done',
      'added:t-done',
    ]);
    expect(projectStream(seed(), 'p', 'chewie').map((i) => i.key)).toEqual([
      'added:t-chewie',
    ]);
  });

  it('narrows the lanes the same way', () => {
    const state = seed();
    const all = lanesOf(state, 'me', projectKeep('p'));
    expect(all.mine.map((t) => t.id)).toEqual([]);
    expect(all.waiting.map((g) => g.personId).sort()).toEqual([
      'chewie',
      'han',
    ]);
    const han = lanesOf(state, 'me', projectKeep('p', 'han'));
    expect(han.waiting.map((g) => g.personId)).toEqual(['han']);
    expect(han.waiting[0]?.tasks.map((t) => t.id)).toEqual(['t-han']);
  });

  it('has small rules for notes and meetings', () => {
    expect(noteTouches({ body: 'hi @{han}' }, 'han')).toBe(true);
    expect(noteTouches({ body: 'hi Han' }, 'han')).toBe(false);
    expect(meetingTouches({ attendees: ['han'] }, 'han')).toBe(true);
    expect(meetingTouches({ attendees: [] }, 'han')).toBe(false);
  });
});

describe('the people a project room offers', () => {
  it('lists members first, then whoever its tasks touch, by name', () => {
    expect(roomPeople(seed(), 'p').map((p) => p.id)).toEqual([
      'leia',
      'han',
      'chewie',
      'mon',
    ]);
  });

  it('leaves out people who are gone', () => {
    const state = seed();
    delete state.people.leia;
    expect(roomPeople(state, 'p').map((p) => p.id)).not.toContain('leia');
  });
});

describe('a project room’s state line', () => {
  const day = (d: string) => d;
  it('says health, status, target, next milestone and what is open', () => {
    const p = project('p', {
      health: 'yellow',
      status: 'paused',
      targetDate: '2026-12-01',
      milestones: [
        { id: 'a', title: 'Old', date: '2026-11-01' },
        { id: 'b', title: 'Live', date: '2026-11-20' },
      ],
    });
    expect(projectStateLine(p, 3, '2026-11-17', day)).toEqual([
      'Yellow',
      'Paused',
      'Target 2026-12-01',
      'Next: Live, 2026-11-20',
      '3 open',
    ]);
  });

  it('says only what is open for an active project with nothing set', () => {
    expect(projectStateLine(project('p'), 0, '2026-11-17', day)).toEqual([
      'Nothing open',
    ]);
  });
});
