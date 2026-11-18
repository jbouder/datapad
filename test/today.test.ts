import { describe, expect, it } from 'vitest';
import {
  dayEntries,
  dayLine,
  dueOn,
  highPriority,
  localTime,
  meetingPast,
  nextMeeting,
  weekAround,
  weekDayLine,
  weekDays,
  weekLine,
} from '#shared/today';
import {
  emptySnapshot,
  type Meeting,
  type Note,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

// Vitest runs in workerd, on UTC: a timestamp's local time is its UTC one.
const DAY = '2026-11-16';
const AT = `${DAY}T09:00:00.000Z`;

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
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: AT,
    completedAt: null,
    ...patch,
  } as Task;
}

function meeting(id: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    projectId: null,
    title: id,
    date: DAY,
    time: '',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: AT,
    updatedAt: AT,
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
    updatedAt: AT,
    ...patch,
  } as Note;
}

function state(parts: Partial<Snapshot>): Snapshot {
  return {
    ...emptySnapshot(),
    projects: {
      'p-echo': project('p-echo'),
      'p-old': project('p-old', { archived: true }),
    },
    ...parts,
  };
}

describe('localTime', () => {
  it('is the local HH:MM', () => {
    expect(localTime('2026-11-16T07:05:00.000Z')).toBe('07:05');
  });
});

describe('dayEntries', () => {
  const s = state({
    meetings: {
      standup: meeting('standup', { time: '09:30', end: '09:45' }),
      offsite: meeting('offsite'),
      review: meeting('review', { time: '14:00' }),
      old: meeting('old', { projectId: 'p-old', time: '10:00' }),
      other: meeting('other', { date: '2026-11-17', time: '08:00' }),
    },
    tasks: {
      added: task('added', { createdAt: `${DAY}T08:15:00.000Z` }),
      done: task('done', {
        status: 'done',
        completedAt: `${DAY}T11:00:00.000Z`,
      }),
      both: task('both', {
        status: 'done',
        createdAt: `${DAY}T10:00:00.000Z`,
        completedAt: `${DAY}T16:00:00.000Z`,
      }),
      archived: task('archived', {
        projectId: 'p-old',
        createdAt: `${DAY}T10:00:00.000Z`,
      }),
      before: task('before'),
    },
    notes: {
      n1: note('n1', { createdAt: `${DAY}T12:30:00.000Z` }),
      n2: note('n2', { createdAt: '2026-11-15T12:30:00.000Z' }),
      n3: note('n3', {
        projectId: 'p-old',
        createdAt: `${DAY}T12:30:00.000Z`,
      }),
    },
  });

  it('lists the day in time order, untimed meetings first', () => {
    expect(
      dayEntries(s, DAY).map((e) => [
        e.kind,
        e.at,
        e.kind === 'meeting'
          ? e.meeting.id
          : e.kind === 'note'
            ? e.note.id
            : e.task.id,
      ]),
    ).toEqual([
      ['meeting', '', 'offsite'],
      ['added', '08:15', 'added'],
      ['meeting', '09:30', 'standup'],
      ['added', '10:00', 'both'],
      ['done', '11:00', 'done'],
      ['note', '12:30', 'n1'],
      ['meeting', '14:00', 'review'],
      ['done', '16:00', 'both'],
    ]);
  });

  it('leaves out archived projects and other days', () => {
    const entries = dayEntries(s, DAY);
    expect(
      entries.some((e) => e.kind === 'meeting' && e.meeting.id === 'old'),
    ).toBe(false);
    expect(entries.some((e) => 'task' in e && e.task.id === 'archived')).toBe(
      false,
    );
    expect(entries.some((e) => e.kind === 'note' && e.note.id === 'n3')).toBe(
      false,
    );
  });

  it('is empty for a day with nothing', () => {
    expect(dayEntries(s, '2026-12-25')).toEqual([]);
  });
});

describe('highPriority', () => {
  const s = state({
    tasks: {
      high: task('high', { priority: 'high' }),
      dueHigh: task('dueHigh', { priority: 'high', due: DAY }),
      med: task('med', { priority: 'med' }),
      done: task('done', {
        priority: 'high',
        status: 'done',
        completedAt: AT,
      }),
      archived: task('archived', { priority: 'high', projectId: 'p-old' }),
    },
  });

  it('is the open high-priority tasks in live projects', () => {
    expect(highPriority(s).map((t) => t.id)).toEqual(['dueHigh', 'high']);
  });

  it('leaves out what is already shown under Due', () => {
    const due = dueOn(s, DAY, DAY);
    expect(highPriority(s, due).map((t) => t.id)).toEqual(['high']);
  });
});

describe('dueOn', () => {
  const s = state({
    tasks: {
      late: task('late', { due: '2026-11-10' }),
      today: task('today', { due: DAY }),
      tomorrow: task('tomorrow', { due: '2026-11-17' }),
      undated: task('undated'),
      done: task('done', { due: DAY, status: 'done', completedAt: AT }),
      archived: task('archived', { due: DAY, projectId: 'p-old' }),
    },
  });

  it('is due today and overdue on today', () => {
    expect(dueOn(s, DAY, DAY).map((t) => t.id)).toEqual(['late', 'today']);
  });

  it('is only that day on another day', () => {
    expect(dueOn(s, '2026-11-17', DAY).map((t) => t.id)).toEqual(['tomorrow']);
    expect(dueOn(s, '2026-11-10', DAY).map((t) => t.id)).toEqual(['late']);
  });
});

describe('meetingPast', () => {
  it('reads the end, then the start; untimed is never over today', () => {
    const m = meeting('m', { time: '09:00', end: '10:00' });
    expect(meetingPast(m, DAY, '09:30')).toBe(false);
    expect(meetingPast(m, DAY, '10:01')).toBe(true);
    expect(meetingPast(meeting('m', { time: '09:00' }), DAY, '09:01')).toBe(
      true,
    );
    expect(meetingPast(meeting('m'), DAY, '23:59')).toBe(false);
    expect(meetingPast(meeting('m'), '2026-11-17', '23:59')).toBe(true);
  });
});

describe('nextMeeting', () => {
  const s = state({
    meetings: {
      early: meeting('early', { time: '08:00', end: '08:30' }),
      now: meeting('now', { time: '09:00', end: '10:00' }),
      later: meeting('later', { time: '15:00' }),
      tomorrow: meeting('tomorrow', { date: '2026-11-17', time: '08:00' }),
      allDay: meeting('allDay', { date: '2026-11-17' }),
      old: meeting('old', { projectId: 'p-old', date: '2026-11-17' }),
      far: meeting('far', { date: '2026-12-01', time: '08:00' }),
    },
  });

  it('is the one going on, then the next', () => {
    expect(nextMeeting(s, DAY, '09:30')?.id).toBe('now');
    expect(nextMeeting(s, DAY, '10:30')?.id).toBe('later');
  });

  it('moves to a later day, untimed first, never an archived project', () => {
    expect(nextMeeting(s, DAY, '16:00')?.id).toBe('allDay');
  });

  it('is an untimed meeting today, all day', () => {
    const today = state({ meetings: { m: meeting('m') } });
    expect(nextMeeting(today, DAY, '23:00')?.id).toBe('m');
  });

  it('looks only `days` ahead when asked', () => {
    const one = state({ meetings: { far: s.meetings.far as Meeting } });
    expect(nextMeeting(one, DAY, '16:00')?.id).toBe('far');
    expect(nextMeeting(one, DAY, '16:00', 7)).toBeNull();
  });
});

describe('dayLine', () => {
  it('counts the day', () => {
    expect(dayLine({ meetings: 2, due: 3, waiting: 4, decide: 1 })).toBe(
      '2 meetings, 3 due, 4 waiting on others, 1 to decide',
    );
    expect(dayLine({ meetings: 1, due: 0, waiting: 0, decide: 0 })).toBe(
      '1 meeting, 0 due, 0 waiting on others, 0 to decide',
    );
  });
});

describe('the week zoom (#332)', () => {
  it('is Monday to Sunday around a day', () => {
    // 2026-11-16 is a Monday.
    expect(weekAround(DAY)).toEqual({ from: DAY, to: '2026-11-22' });
    expect(weekAround('2026-11-19')).toEqual({ from: DAY, to: '2026-11-22' });
    expect(weekAround('2026-11-22')).toEqual({ from: DAY, to: '2026-11-22' });
    expect(weekAround('2026-11-23').from).toBe('2026-11-23');
  });

  it('has each day’s meetings and its due, done and notes', () => {
    const s = state({
      meetings: {
        later: meeting('later', { time: '15:00', date: '2026-11-17' }),
        early: meeting('early', { time: '09:00', date: '2026-11-17' }),
        allDay: meeting('allDay', { date: '2026-11-17' }),
        old: meeting('old', { projectId: 'p-old', date: '2026-11-17' }),
        before: meeting('before', { date: '2026-11-15' }),
      },
      tasks: {
        due: task('due', { due: '2026-11-18' }),
        doneDue: task('doneDue', {
          due: '2026-11-18',
          status: 'done',
          completedAt: '2026-11-18T10:00:00.000Z',
        }),
        archived: task('archived', { due: '2026-11-18', projectId: 'p-old' }),
      },
      notes: { n: note('n', { createdAt: '2026-11-22T08:00:00.000Z' }) },
    });
    const days = weekDays(s, '2026-11-19');
    expect(days.map((d) => d.day)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(days[1]?.meetings.map((m) => m.id)).toEqual([
      'allDay',
      'early',
      'later',
    ]);
    expect(days[2]).toMatchObject({ due: 1, done: 1, notes: 0 });
    expect(days[6]).toMatchObject({ due: 0, done: 0, notes: 1 });
    expect(weekDayLine(days[2] as (typeof days)[number])).toBe(
      '1 due · 1 done',
    );
    expect(weekDayLine({ due: 0, done: 0, notes: 2 })).toBe('2 notes');
    expect(weekDayLine({ due: 0, done: 0, notes: 0 })).toBe('');
    expect(weekLine(days)).toBe('3 meetings, 1 due, 1 done, 1 note');
  });
});
