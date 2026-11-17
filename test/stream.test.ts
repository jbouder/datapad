import { describe, expect, it } from 'vitest';
import { lanesOf } from '#shared/loops';
import {
  buildStream,
  meetingTouches,
  noteTouches,
  personKeep,
  personLanes,
  personOrgs,
  personProjects,
  personStateLine,
  personStream,
  personTopics,
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

/** The seed with a person room's worth: Han across two projects. */
function hanSeed(): Snapshot {
  const s = seed();
  s.projects.q = project('q', { name: 'Falcon', org: 'Corellia' });
  s.projects.p = { ...(s.projects.p as Project), org: 'Rebels' };
  s.projects.z = project('z', { name: 'Yavin', archived: true });
  Object.assign(s.tasks, {
    // You owe: yours, and it mentions Han.
    't-mine': task('t-mine', { assignee: 'me', desc: 'ask @{han}' }),
    // They owe you: blocked on Han, though assigned to you.
    't-blocked': task('t-blocked', {
      assignee: 'me',
      blocked: { on: 'han', note: '' },
    }),
    // To discuss.
    't-decide': task('t-decide', { decide: true, desc: '@{han}' }),
    // Another person's, mentioning Han: it waits on Chewie.
    't-chewie-han': task('t-chewie-han', {
      assignee: 'chewie',
      desc: '@{han}',
    }),
    // Not Han's at all.
    't-plain': task('t-plain', { assignee: 'me' }),
    // In an archived project: not open.
    't-yavin': task('t-yavin', { projectId: 'z', assignee: 'han' }),
  });
  s.notes['n-q'] = note('n-q', { projectId: 'q', body: '@{han} refit' });
  s.meetings['m-ahead'] = meeting('m-ahead', {
    projectId: 'q',
    attendees: ['me', 'han'],
    date: '2026-11-20',
    time: '10:00',
    topics: [
      { id: 'a', title: 'Motivator', done: false, outcome: '' },
      { id: 'b', title: 'Old', done: true, outcome: 'Fine' },
    ],
  });
  s.meetings['m-soon'] = meeting('m-soon', {
    projectId: null,
    attendees: ['han'],
    date: '2026-11-18',
    topics: [{ id: 'c', title: 'Career', done: false, outcome: '' }],
  });
  s.meetings['m-gone'] = meeting('m-gone', {
    attendees: ['han'],
    date: '2026-11-17',
    time: '08:00',
    end: '08:30',
    topics: [{ id: 'd', title: 'Held', done: false, outcome: '' }],
  });
  return s;
}

describe('a person’s room', () => {
  const ids = (tasks: Task[]) => tasks.map((t) => t.id).sort();

  it('splits their loops into You owe, They owe you and To discuss', () => {
    const lanes = personLanes(hanSeed(), 'me', 'han');
    expect(ids(lanes.mine)).toEqual(['t-mine']);
    expect(lanes.waiting.map((g) => g.personId)).toEqual(['han', 'chewie']);
    expect(ids(lanes.waiting[0]?.tasks ?? [])).toEqual([
      't-blocked',
      't-han',
      't-other',
    ]);
    expect(ids(lanes.decide)).toEqual(['t-decide']);
  });

  it('narrowed to a project, keeps what the project room narrowed to them keeps', () => {
    const state = hanSeed();
    for (const project of ['p', 'q']) {
      const person = lanesOf(state, 'me', personKeep('han', project));
      const room = lanesOf(state, 'me', projectKeep(project, 'han'));
      expect(person).toEqual(room);
      expect(personStream(state, 'han', project)).toEqual(
        projectStream(state, project, 'han'),
      );
    }
    const q = personLanes(state, 'me', 'han', 'q');
    expect(ids(q.waiting[0]?.tasks ?? [])).toEqual(['t-other']);
  });

  it('streams notes that mention them, tasks that touch them, meetings they attend', () => {
    const keys = personStream(hanSeed(), 'han', null, new Set(['n-q'])).map(
      (i) => i.key,
    );
    expect(keys).toContain('note:n-han');
    expect(keys).not.toContain('note:n-q');
    expect(keys).not.toContain('note:n-plain');
    expect(keys).toContain('added:t-other');
    expect(keys).toContain('added:t-blocked');
    expect(keys).not.toContain('added:t-plain');
    expect(keys).toContain('meeting:m-ahead');
    expect(keys).not.toContain('meeting:m-leia');
    expect(keys.some((k) => k.startsWith('milestone:'))).toBe(false);
  });

  it('lists the open topics of meetings ahead with them, soonest first', () => {
    const topics = (project?: string) =>
      personTopics(hanSeed(), 'han', '2026-11-17', '09:00', project).map(
        (t) => t.topic.title,
      );
    expect(topics()).toEqual(['Career', 'Motivator']);
    expect(topics('q')).toEqual(['Motivator']);
  });

  it('offers their projects: members first, then the rest they touch, never archived', () => {
    expect(personProjects(hanSeed(), 'han').map((p) => p.id)).toEqual([
      'p',
      'q',
    ]);
    expect(personProjects(hanSeed(), 'mon').map((p) => p.id)).toEqual(['p']);
    expect(personOrgs(personProjects(hanSeed(), 'han'))).toEqual([
      'Corellia',
      'Rebels',
    ]);
  });

  it('says role, projects and what is open', () => {
    expect(personStateLine({ role: 'Captain' }, 2, 3)).toEqual([
      'Captain',
      '2 projects',
      '3 open',
    ]);
    expect(personStateLine({ role: ' ' }, 1, 0)).toEqual([
      '1 project',
      'Nothing open',
    ]);
    expect(personStateLine({ role: '' }, 0, 1)[0]).toBe('No projects');
  });
});
