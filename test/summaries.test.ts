import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  eventContext,
  findModel,
  noteContext,
  projectContext,
  REQUEST_SETTINGS,
  SUMMARY_LIMITS,
  SUMMARY_MODELS,
  SYSTEM_PROMPT,
  summaryNoteBody,
  summaryRequest,
  taskContext,
} from '#shared/summaries';
import {
  type Event,
  emptySnapshot,
  type Note,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

const event: Event = {
  id: 'e1',
  projectId: 'p1',
  title: 'Shield review',
  type: 'meeting',
  date: '2026-10-27',
  time: '14:00',
  end: '15:00',
  attendees: ['leia', 'gone'],
  link: '',
  note: 'Power budget.',
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

function note(id: string, patch: Partial<Note>): Note {
  return {
    id,
    projectId: 'p1',
    body: id,
    pinned: false,
    eventId: 'e1',
    phase: null,
    createdAt: '2026-10-21T09:00:00.000Z',
    ...patch,
  };
}

describe('eventContext', () => {
  it('labels linked notes [prep] and [debrief], oldest first, names for mentions', () => {
    const text = eventContext(event, {
      projects: { p1: { id: 'p1', name: 'Echo Base' } as Project },
      people: { leia: { id: 'leia', name: 'Leia Organa', role: '', me: true } },
      notes: {
        b: note('b', {
          phase: 'post',
          body: 'Went well, ask @{leia}',
          createdAt: '2026-10-27T16:00:00.000Z',
        }),
        a: note('a', { phase: 'pre', body: 'Bring the numbers' }),
        c: note('c', { createdAt: '2026-10-28T08:00:00.000Z' }),
        other: note('other', { eventId: 'e2', body: 'Not this one' }),
      },
    });
    expect(text).toBe(
      [
        'Event: Shield review',
        'Type: Meeting',
        'Date: Tue 27 Oct 2026, 14:00–15:00',
        'Project: Echo Base',
        'Attendees: Leia Organa',
        'Agenda: Power budget.',
        '',
        'Linked notes:',
        '[prep] Wed 21 Oct 2026',
        'Bring the numbers',
        '',
        '[debrief] Tue 27 Oct 2026',
        'Went well, ask @Leia Organa',
        '',
        '[note] Wed 28 Oct 2026',
        'c',
      ].join('\n'),
    );
  });

  it('says General and no attendees when there are none', () => {
    const text = eventContext(
      { ...event, projectId: null, attendees: [], note: '' },
      { projects: {}, people: {}, notes: {} },
    );
    expect(text).toContain('Project: General');
    expect(text).toContain('Attendees: none listed');
    expect(text).not.toContain('Agenda');
    expect(text).not.toContain('Linked notes');
  });
});

const project: Project = {
  id: 'p1',
  name: 'Echo Base',
  org: 'Rebel Alliance',
  status: 'active',
  priority: 'high',
  targetDate: '2026-11-20',
  tags: [],
  desc: 'Keep @{leia} posted.',
  state: 'Shield generator half up',
  members: ['leia', 'han'],
  links: [],
  archived: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    projectId: 'p1',
    status: 'open',
    priority: 'none',
    due: '',
    desc: '',
    tags: [],
    assignee: '',
    links: [],
    order: 1,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    completedAt: null,
    ...patch,
  };
}

function world(): Snapshot {
  const state = emptySnapshot();
  state.projects.p1 = project;
  state.people.leia = { id: 'leia', name: 'Leia Organa', role: '', me: true };
  state.people.han = { id: 'han', name: 'Han Solo', role: '', me: false };
  state.events.e1 = event;
  return state;
}

describe('projectContext', () => {
  it('has the fields, open tasks with details, events, notes and activity', () => {
    const state = world();
    state.tasks.a = task('Calibrate shields', {
      priority: 'high',
      due: '2026-10-30',
      assignee: 'han',
      desc: 'Ask @{leia} first',
      order: 2,
    });
    state.tasks.b = task('Order parts', { order: 1 });
    state.tasks.c = task('Old thing', {
      status: 'done',
      completedAt: '2026-10-10T09:00:00.000Z',
    });
    state.tasks.elsewhere = task('Not mine', { projectId: 'p2' });
    state.notes.n1 = note('n1', {
      eventId: null,
      body: 'Power is low',
      createdAt: '2026-10-22T09:00:00.000Z',
    });
    state.notes.n2 = note('n2', {
      phase: 'pre',
      body: 'Bring the numbers',
      createdAt: '2026-10-23T09:00:00.000Z',
    });
    state.activity.p1 = {
      events: [{ t: '2026-10-23T09:00:00.000Z', text: 'Added a note' }],
    };
    const text = projectContext('p1', state);
    expect(text).toBe(
      [
        'Project: Echo Base',
        'Org: Rebel Alliance',
        'Status: active',
        'Health: not set',
        'Priority: high',
        'Target date: Fri 20 Nov 2026',
        'Team: Leia Organa, Han Solo',
        'Current state: Shield generator half up',
        'Description:',
        'Keep @Leia Organa posted.',
        '',
        'Open tasks (2):',
        '- Order parts',
        '- Calibrate shields, priority high, due Fri 30 Oct 2026, assigned to Han Solo',
        '  Ask @Leia Organa first',
        '',
        'Recently done tasks:',
        '- Old thing, closed Sat 10 Oct 2026',
        '',
        'Events:',
        '- Tue 27 Oct 2026 14:00–15:00: Shield review (Meeting)',
        '',
        'Notes, newest first:',
        '[prep] Fri 23 Oct 2026',
        'Bring the numbers',
        '',
        '[note] Thu 22 Oct 2026',
        'Power is low',
        '',
        'Recent activity, newest first:',
        '- Fri 23 Oct 2026: Added a note',
      ].join('\n'),
    );
  });

  it('keeps the last 15 done tasks, 20 notes and 25 activity lines', () => {
    const state = world();
    for (let i = 0; i < 20; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      state.tasks[`d${i}`] = task(`done ${i}`, {
        status: 'done',
        completedAt: `2026-10-${day}T09:00:00.000Z`,
      });
    }
    for (let i = 0; i < 30; i += 1) {
      state.notes[`n${i}`] = note(`n${i}`, {
        eventId: null,
        body: `note ${i}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
      });
    }
    state.activity.p1 = {
      events: Array.from({ length: 40 }, (_, i) => ({
        t: '2026-10-23T09:00:00.000Z',
        text: `line ${i}`,
      })),
    };
    const text = projectContext('p1', state);
    const count = (re: RegExp) => text.match(re)?.length ?? 0;
    expect(count(/^- done \d+/gm)).toBe(SUMMARY_LIMITS.doneTasks);
    // Newest closed first: 19 is in, 4 is out.
    expect(text).toContain('- done 19,');
    expect(text).not.toContain('- done 4,');
    expect(count(/^note \d+$/gm)).toBe(SUMMARY_LIMITS.notes);
    expect(text).toContain('note 29');
    expect(text).not.toContain('note 9\n');
    expect(count(/: line \d+$/gm)).toBe(SUMMARY_LIMITS.activity);
    expect(SUMMARY_LIMITS).toEqual({ doneTasks: 15, notes: 20, activity: 25 });
  });
});

describe('taskContext', () => {
  it('has the fields, details, link labels and the source note', () => {
    const state = world();
    state.notes.src = note('src', {
      eventId: null,
      body: 'From the review with @{han}',
    });
    const text = taskContext(
      task('Calibrate shields', {
        status: 'open',
        priority: 'med',
        assignee: 'leia',
        tags: ['power'],
        desc: 'Details here',
        links: [{ type: 'doc', url: 'https://example.test', label: 'Spec' }],
        sourceNoteId: 'src',
      }),
      state,
    );
    expect(text).toBe(
      [
        'Task: Calibrate shields',
        'Project: Echo Base',
        'Status: open',
        'Priority: medium',
        'Due: none',
        'Assignee: Leia Organa',
        'Tags: power',
        'Details:',
        'Details here',
        'Links: Spec',
        '',
        'Made from a note of Wed 21 Oct 2026:',
        'From the review with @Han Solo',
      ].join('\n'),
    );
    expect(text).not.toContain('https://');
  });
});

describe('noteContext', () => {
  it('has the date, project, event and body', () => {
    const text = noteContext(
      note('x', { phase: 'post', body: 'Ask @{leia}' }),
      world(),
    );
    expect(text).toBe(
      [
        'Note of Wed 21 Oct 2026',
        'Project: Echo Base',
        'Event: debrief of Shield review on Tue 27 Oct 2026',
        '',
        'Ask @Leia Organa',
      ].join('\n'),
    );
  });
});

describe('summaryRequest', () => {
  it('names the item and where Save as note goes', () => {
    const state = world();
    state.tasks.t = task('Calibrate shields', { projectId: null });
    expect(summaryRequest({ kind: 'project', id: 'p1' }, state)).toMatchObject({
      label: 'Echo Base',
      projectId: 'p1',
      eventId: null,
    });
    expect(summaryRequest({ kind: 'task', id: 't' }, state)).toMatchObject({
      label: 'Calibrate shields',
      projectId: null,
      eventId: null,
    });
    expect(summaryRequest({ kind: 'event', id: 'e1' }, state)).toMatchObject({
      label: 'Shield review',
      projectId: 'p1',
      eventId: 'e1',
    });
    expect(summaryRequest({ kind: 'task', id: 'gone' }, state)).toBeNull();
  });

  it('saves as "Summary of <item>" then the text', () => {
    expect(summaryNoteBody('Echo Base', '\nAll good.\n')).toBe(
      'Summary of Echo Base\n\nAll good.',
    );
  });
});

describe('the model', () => {
  it('is holocron’s list, ids, sizes and request settings', () => {
    expect(
      SUMMARY_MODELS.map((m) => [m.id, m.downloadLabel, m.vramLabel]),
    ).toEqual([
      ['Qwen3-1.7B-q4f16_1-MLC', 'about 1 GB', '2 GB'],
      ['Qwen3-4B-q4f16_1-MLC', 'about 2.4 GB', '3.5 GB'],
      ['Qwen3-8B-q4f16_1-MLC', 'about 4.6 GB', '6 GB'],
    ]);
    expect(DEFAULT_MODEL.id).toBe('Qwen3-1.7B-q4f16_1-MLC');
    expect(findModel('nope')).toBe(DEFAULT_MODEL);
    expect(findModel('Qwen3-8B-q4f16_1-MLC').name).toBe('Qwen3 8B');
    expect(REQUEST_SETTINGS).toEqual({
      temperature: 0.3,
      max_tokens: 900,
      extra_body: { enable_thinking: false },
    });
    expect(SYSTEM_PROMPT).toMatch(/^You are summarizing one item/);
  });
});
