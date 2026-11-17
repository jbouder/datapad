import { describe, expect, it } from 'vitest';
import { addDays, dayOf, daysBetween } from '#shared/dates';
import {
  ATTENTION_QUIET_DAYS,
  ATTENTION_TARGET_DAYS,
  attention,
  attentionLine,
  daysSince,
  movementLine,
  prepLine,
  prepOf,
  weekMovement,
} from '#shared/select';
import {
  emptySnapshot,
  type Meeting,
  type Note,
  type Project,
  type Snapshot,
  type Task,
  type Topic,
} from '#shared/types';

/**
 * Focus's briefing (#206): the week's movement, Waiting on, Attention,
 * Follow-ups and an agenda card's prep. The Workers runtime is on UTC, so
 * a timestamp's local day is its UTC day here.
 */

// Tuesday 27 October 2026.
const TODAY = '2026-10-27';
const at = (day: string, time = '12:00') => `${day}T${time}:00.000Z`;

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
    order: 1,
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-01'),
    completedAt: null,
    ...patch,
  };
}

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    org: '',
    status: 'active',
    priority: 'none',
    targetDate: '',
    tags: [],
    desc: '',
    state: '',
    members: [],
    links: [],
    archived: false,
    createdAt: at('2026-10-01'),
    updatedAt: at(TODAY),
    ...patch,
  };
}

function meeting(id: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    projectId: null,
    title: 'Sync',
    date: TODAY,
    time: '10:00',
    end: '',
    attendees: ['u-a'],
    link: '',
    note: '',
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-01'),
    ...patch,
  };
}

const byId = <T extends { id: string }>(...docs: T[]) =>
  Object.fromEntries(docs.map((d) => [d.id, d]));

describe('days', () => {
  it('counts whole days between dates and since a timestamp', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0);
    expect(daysBetween(TODAY, '2026-11-02')).toBe(6);
    expect(daysBetween(TODAY, '2026-10-18')).toBe(-9);
    expect(dayOf(at(TODAY, '23:59'))).toBe(TODAY);
    expect(daysSince(at('2026-10-18', '23:00'), TODAY)).toBe(9);
    // A clock a little ahead is still today.
    expect(daysSince(at('2026-10-28'), TODAY)).toBe(0);
  });
});

describe('weekMovement', () => {
  const projects = byId(project('p'), project('gone', { archived: true }));

  it('counts the last seven days, today included, and what is overdue', () => {
    const tasks = byId(
      task('closed-today', { status: 'done', completedAt: at(TODAY) }),
      task('closed-6', { status: 'done', completedAt: at('2026-10-21') }),
      task('closed-7', { status: 'done', completedAt: at('2026-10-20') }),
      task('added-today', { createdAt: at(TODAY, '00:00') }),
      task('added-6', { createdAt: at('2026-10-21', '00:00') }),
      task('added-7', { createdAt: at('2026-10-20', '23:59') }),
      task('yesterday', { due: '2026-10-26' }),
      task('due-today', { due: TODAY }),
      task('blocked', {
        due: '2026-10-01',
        blocked: { on: null, note: '' },
      }),
      task('done-late', {
        status: 'done',
        due: '2026-10-01',
        completedAt: at('2026-10-02'),
      }),
      task('archived', {
        projectId: 'gone',
        due: '2026-10-01',
        createdAt: at(TODAY),
      }),
    );
    const m = weekMovement(tasks, projects, TODAY);
    expect(m).toEqual({ closed: 2, added: 2, overdue: 2 });
    expect(movementLine(m)).toBe('2 closed this week · 2 added · 2 overdue');
  });

  it('reads all zeros on an empty space', () => {
    const s = emptySnapshot();
    expect(movementLine(weekMovement(s.tasks, s.projects, TODAY))).toBe(
      '0 closed this week · 0 added · 0 overdue',
    );
  });
});

describe('attention', () => {
  const quiet = ATTENTION_QUIET_DAYS;
  const near = ATTENTION_TARGET_DAYS;
  const ago = (n: number) => at(addDays(TODAY, -n));
  const projects = byId(
    project('fine'),
    project('green-far', { health: 'green', targetDate: '2026-12-31' }),
    project('yellow', { health: 'yellow', name: 'Yellow' }),
    project('red', { health: 'red', targetDate: '2026-11-30' }),
    project('red-soon', { health: 'red', targetDate: '2026-11-02' }),
    project('edge', { targetDate: addDays(TODAY, near) }),
    project('beyond', { targetDate: addDays(TODAY, near + 1) }),
    project('past', { targetDate: '2026-10-24' }),
    project('today', { targetDate: TODAY }),
    project('quiet', { updatedAt: ago(quiet) }),
    project('nearly', { updatedAt: ago(quiet - 1) }),
    project('paused', { status: 'paused', health: 'red' }),
    project('done', { status: 'done', updatedAt: ago(90) }),
    project('archived', { archived: true, health: 'red' }),
  );

  it('flags health, a near or past target, and quiet; in order', () => {
    const items = attention(projects, TODAY);
    expect(items.map((i) => i.project.id)).toEqual([
      'red-soon',
      'red',
      'yellow',
      'past',
      'today',
      'edge',
      'quiet',
    ]);
    const line = (id: string) =>
      attentionLine(items.find((i) => i.project.id === id)?.reasons ?? []);
    expect(line('red-soon')).toBe('red · target in 6 days');
    expect(line('red')).toBe('red');
    expect(line('yellow')).toBe('yellow');
    expect(line('past')).toBe('target passed 3 days ago');
    expect(line('today')).toBe('target today');
    expect(line('edge')).toBe(`target in ${near} days`);
    expect(line('quiet')).toBe(`quiet ${quiet} days`);
  });

  it('follows Focus’s rules: target window, quiet off, yellow left out (#311)', () => {
    const items = attention(projects, TODAY, 7, null, false);
    expect(items.map((i) => i.project.id)).toEqual([
      'red-soon',
      'red',
      'past',
      'today',
    ]);
    const month = attention(projects, TODAY, 30, 30, true);
    expect(month.map((i) => i.project.id)).toContain('edge');
    expect(month.map((i) => i.project.id)).toContain('beyond');
    expect(month.map((i) => i.project.id)).not.toContain('quiet');
  });

  it('puts every reason on one line', () => {
    const all = byId(
      project('all', {
        health: 'yellow',
        targetDate: '2026-11-02',
        updatedAt: at('2026-10-11'),
      }),
      project('tomorrow', { targetDate: '2026-10-28' }),
      project('yesterday', { targetDate: '2026-10-26' }),
    );
    const items = attention(all, TODAY);
    expect(items.map((i) => attentionLine(i.reasons))).toEqual([
      'yellow · target in 6 days · quiet 16 days',
      'target passed 1 day ago',
      'target tomorrow',
    ]);
  });
});

describe('prep', () => {
  const topic = (id: string, patch: Partial<Topic> = {}): Topic => ({
    id,
    title: id,
    done: false,
    outcome: '',
    ...patch,
  });
  const series = { projectId: 'p', title: 'Shield review', attendees: ['a'] };
  const last = meeting('last', { ...series, date: '2026-10-20' });
  const before = meeting('before', { ...series, date: '2026-10-13' });
  const now = meeting('now', {
    ...series,
    topics: [
      topic('a', { done: true }),
      topic('b', { carriedFrom: '2026-10-13' }),
      topic('c', { done: true, carriedFrom: '2026-10-13' }),
      topic('d'),
      topic('e'),
    ],
  });
  const other = meeting('other', { title: 'Other', date: '2026-10-20' });
  const snapshot = (notes: Note[] = []): Snapshot => ({
    ...emptySnapshot(),
    meetings: byId(last, before, now, other),
    tasks: byId(
      task('x', { meetingId: 'last' }),
      task('y', { meetingId: 'last' }),
      task('z', { meetingId: 'last', status: 'done', completedAt: at(TODAY) }),
      task('w', { meetingId: 'before' }),
      task('v', { meetingId: 'other' }),
    ),
    notes: byId(...notes),
  });

  it('says what is left, what was carried, last time’s items and the note', () => {
    const prep = prepOf(now, snapshot());
    expect(prep).toMatchObject({
      topics: 5,
      left: 3,
      carried: 1,
      actionItems: 2,
      hasNote: false,
    });
    expect(prep.previous?.id).toBe('last');
    expect(prepLine(prep, TODAY)).toBe(
      '3 of 5 topics left · 1 carried · 2 action items open from Tue 20 Oct · no note yet',
    );
  });

  it('leaves out what has nothing to say', () => {
    const note: Note = {
      id: 'n',
      projectId: 'p',
      body: 'Prep',
      pinned: false,
      meetingId: 'now',
      phase: null,
      createdAt: at(TODAY),
    };
    const covered = {
      ...now,
      topics: [topic('a', { done: true })],
    };
    expect(prepLine(prepOf(covered, snapshot([note])), TODAY)).toBe(
      'all topics covered · 2 action items open from Tue 20 Oct',
    );
    // The first of its series, no topics, a note: nothing to say.
    expect(
      prepLine(
        prepOf(before, snapshot([{ ...note, meetingId: 'before' }])),
        TODAY,
      ),
    ).toBe('');
    expect(prepLine(prepOf(other, snapshot()), TODAY)).toBe('no note yet');
  });

  it('says one of each in the singular', () => {
    const one = { ...now, topics: [topic('only', { carriedFrom: TODAY })] };
    const s = snapshot();
    s.tasks = byId(task('x', { meetingId: 'last' }));
    expect(prepLine(prepOf(one, s), TODAY)).toBe(
      '1 of 1 topic left · 1 carried · 1 action item open from Tue 20 Oct · no note yet',
    );
  });
});
