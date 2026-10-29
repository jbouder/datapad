import { describe, expect, it } from 'vitest';
import { addDays } from '#shared/dates';
import {
  buildRecap,
  RECAP_ACTIVITY_CAP,
  recapCounts,
  recapEmpty,
  recapLine,
  recapMeetingLine,
  recapTitle,
  recapWindow,
} from '#shared/recap';
import {
  type ActivityEntry,
  emptySnapshot,
  type Meeting,
  type Note,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from '#shared/types';

/**
 * Focus's Since yesterday (#258). The Workers runtime is on UTC, so a
 * timestamp's local day is its UTC day here.
 */

// Monday 26 October 2026 … Sunday 1 November 2026.
const MON = '2026-10-26';
const TUE = '2026-10-27';
const at = (day: string, time = '12:00') => `${day}T${time}:00.000Z`;
const ids = (list: { id: string }[]) => list.map((x) => x.id);

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

const done = (id: string, day: string, patch: Partial<Task> = {}) =>
  task(id, {
    status: 'done',
    completedAt: at(day),
    updatedAt: at(day),
    ...patch,
  });

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
    updatedAt: at('2026-10-01'),
    ...patch,
  };
}

function meeting(id: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    projectId: null,
    title: id,
    date: MON,
    time: '10:00',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-01'),
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
    createdAt: at('2026-10-01'),
    ...patch,
  };
}

const person = (id: string, me = false): Person => ({
  id,
  name: id,
  role: '',
  me,
});

const byId = <T extends { id: string }>(...docs: T[]) =>
  Object.fromEntries(docs.map((d) => [d.id, d]));

const log = (...events: [string, string][]): { events: ActivityEntry[] } => ({
  events: events.map(([t, text]) => ({ t, text })),
});

function snapshot(patch: Partial<Snapshot>): Snapshot {
  return { ...emptySnapshot(), ...patch };
}

describe('recapWindow', () => {
  it('is yesterday on Tuesday to Friday', () => {
    for (const today of [TUE, '2026-10-28', '2026-10-29', '2026-10-30']) {
      const yesterday = addDays(today, -1);
      expect(recapWindow(today)).toEqual({
        from: yesterday,
        to: yesterday,
        label: 'Yesterday',
      });
    }
  });

  it('goes back to Friday on Monday and over the weekend', () => {
    // Monday: Friday through Sunday.
    expect(recapWindow('2026-11-02')).toEqual({
      from: '2026-10-30',
      to: '2026-11-01',
      label: 'Since Friday',
    });
    expect(recapWindow(MON)).toEqual({
      from: '2026-10-23',
      to: '2026-10-25',
      label: 'Since Friday',
    });
    // Saturday: Friday, which is yesterday.
    expect(recapWindow('2026-10-31')).toEqual({
      from: '2026-10-30',
      to: '2026-10-30',
      label: 'Yesterday',
    });
    // Sunday: Friday through Saturday.
    expect(recapWindow('2026-11-01')).toEqual({
      from: '2026-10-30',
      to: '2026-10-31',
      label: 'Since Friday',
    });
  });

  it('crosses a month and a year', () => {
    expect(recapWindow('2027-01-01').from).toBe('2026-12-31');
    // Monday 1 March 2027.
    expect(recapWindow('2027-03-01')).toMatchObject({
      from: '2027-02-26',
      to: '2027-02-28',
    });
  });

  it('titles the section', () => {
    expect(recapTitle(recapWindow(TUE))).toBe('Since yesterday');
    expect(recapTitle(recapWindow(MON))).toBe('Since Friday');
  });
});

describe('buildRecap', () => {
  it('takes whole days in the owner’s day, both edges included', () => {
    const s = snapshot({
      tasks: byId(
        done('first', MON, { completedAt: at(MON, '00:00') }),
        done('last', MON, { completedAt: at(MON, '23:59') }),
        done('before', MON, { completedAt: at('2026-10-25', '23:59') }),
        done('today', MON, { completedAt: at(TUE, '00:00') }),
        task('added-first', { createdAt: at(MON, '00:00') }),
        task('added-today', { createdAt: at(TUE, '00:01') }),
      ),
    });
    const recap = buildRecap(s, TUE);
    expect(recap.closed).toHaveLength(1);
    expect(ids(recap.closed[0]?.items ?? [])).toEqual(['last', 'first']);
    expect(ids(recap.added)).toEqual(['added-first']);
  });

  it('on a Monday, takes Friday through Sunday', () => {
    const s = snapshot({
      tasks: byId(
        done('thu', MON, { completedAt: at('2026-10-22') }),
        done('fri', MON, { completedAt: at('2026-10-23', '00:00') }),
        done('sat', MON, { completedAt: at('2026-10-24') }),
        done('sun', MON, { completedAt: at('2026-10-25', '23:59') }),
        done('mon', MON, { completedAt: at(MON, '08:00') }),
      ),
    });
    const recap = buildRecap(s, MON);
    expect(recap.window.label).toBe('Since Friday');
    expect(ids(recap.closed[0]?.items ?? [])).toEqual(['sun', 'sat', 'fri']);
  });

  it('groups Closed and Notes by project, General last, and leaves the archive out', () => {
    const s = snapshot({
      projects: byId(
        project('p-b', { name: 'Bravo' }),
        project('p-a', { name: 'Alpha' }),
        project('p-old', { name: 'Old', archived: true }),
      ),
      tasks: byId(
        done('t-gen', MON),
        done('t-b', MON, { projectId: 'p-b' }),
        done('t-a', MON, { projectId: 'p-a' }),
        done('t-old', MON, { projectId: 'p-old' }),
        task('t-old-added', { projectId: 'p-old', createdAt: at(MON) }),
      ),
      notes: byId(
        note('n-a', { projectId: 'p-a', createdAt: at(MON, '09:00') }),
        note('n-a2', { projectId: 'p-a', createdAt: at(MON, '15:00') }),
        note('n-gen', { createdAt: at(MON) }),
        note('n-old', { projectId: 'p-old', createdAt: at(MON) }),
        note('n-pad', { scratch: true, createdAt: at(MON) }),
        note('n-before', { createdAt: at('2026-10-25') }),
      ),
      meetings: byId(meeting('m-old', { projectId: 'p-old' })),
      activity: {
        'p-old': log([at(MON), 'Status changed to done']),
      },
    });
    const recap = buildRecap(s, TUE);
    expect(recap.closed.map((g) => g.project?.id ?? null)).toEqual([
      'p-a',
      'p-b',
      null,
    ]);
    expect(recap.added).toEqual([]);
    expect(recap.meetings).toEqual([]);
    expect(recap.activity).toEqual([]);
    expect(recap.notes.map((g) => g.project?.id ?? null)).toEqual([
      'p-a',
      null,
    ]);
    expect(ids(recap.notes[0]?.items ?? [])).toEqual(['n-a2', 'n-a']);
  });

  it('holds each meeting with its topics, action items and notes', () => {
    const s = snapshot({
      meetings: byId(
        meeting('m-late', {
          time: '15:00',
          topics: [
            { id: 'a', title: 'A', done: true, outcome: '' },
            { id: 'b', title: 'B', done: true, outcome: '' },
            { id: 'c', title: 'C', done: true, outcome: '' },
            { id: 'd', title: 'D', done: false, outcome: '' },
          ],
        }),
        meeting('m-early', { time: '09:00' }),
        meeting('m-today', { date: TUE }),
        meeting('m-before', { date: '2026-10-25' }),
      ),
      tasks: byId(
        task('ai-open', { meetingId: 'm-late', createdAt: at(MON) }),
        done('ai-done', MON, { meetingId: 'm-late' }),
      ),
      notes: byId(note('n-late', { meetingId: 'm-late' })),
    });
    const recap = buildRecap(s, TUE);
    expect(recap.meetings.map((m) => m.meeting.id)).toEqual([
      'm-early',
      'm-late',
    ]);
    const late = recap.meetings[1];
    expect(late && ids(late.actionItems)).toEqual(['ai-open', 'ai-done']);
    expect(late && recapMeetingLine(late)).toBe(
      '3 of 4 topics covered · 2 action items · 1 note',
    );
    const early = recap.meetings[0];
    expect(early && recapMeetingLine(early)).toBe('');
  });

  it('narrows Closed and Added to the assignee, and nothing else', () => {
    const s = snapshot({
      people: byId(person('u-me', true), person('u-leia')),
      tasks: byId(
        done('mine', MON, { assignee: 'u-me' }),
        done('leias', MON, { assignee: 'u-leia' }),
        task('nobodys', { createdAt: at(MON) }),
        task('mine-added', { assignee: 'u-me', createdAt: at(MON) }),
      ),
      meetings: byId(meeting('m')),
      notes: byId(note('n', { createdAt: at(MON) })),
    });
    const mine = buildRecap(s, TUE, { kind: 'mine' });
    expect(ids(mine.closed.flatMap((g) => g.items))).toEqual(['mine']);
    expect(ids(mine.added)).toEqual(['mine-added']);
    expect(mine.meetings).toHaveLength(1);
    expect(mine.notes).toHaveLength(1);
    const leia = buildRecap(s, TUE, { kind: 'person', id: 'u-leia' });
    expect(ids(leia.closed.flatMap((g) => g.items))).toEqual(['leias']);
    expect(leia.added).toEqual([]);
    const unassigned = buildRecap(s, TUE, { kind: 'unassigned' });
    expect(ids(unassigned.added)).toEqual(['nobodys']);
    const anyone = buildRecap(s, TUE);
    expect(recapCounts(anyone)).toMatchObject({ closed: 2, added: 2 });
  });

  it('keeps the activity the rest does not say, capped per project', () => {
    const s = snapshot({
      projects: byId(project('p', { name: 'Echo' })),
      activity: {
        p: log(
          [at(TUE, '08:00'), 'Health set to red'],
          [at(MON, '17:00'), 'Added task "Survey"'],
          [at(MON, '16:00'), 'Closed "Survey"'],
          [at(MON, '15:00'), 'Added action item "Draft" to "Sync"'],
          [at(MON, '14:00'), 'Added a note'],
          [at(MON, '13:30'), 'Added a note to "Survey"'],
          [at(MON, '13:00'), 'Saved a summary as a note'],
          [at(MON, '12:00'), 'Health set to yellow'],
          [at(MON, '11:00'), 'Status changed to paused'],
          [at(MON, '10:00'), 'Blocked "Motivator" on Leia'],
          [at(MON, '09:00'), 'Added milestone "Ridge" (Fri 30 Oct)'],
          [at(MON, '08:00'), 'Edited project details'],
          [at(MON, '07:00'), 'Updated current state'],
          [at(MON, '06:00'), 'Drew on the whiteboard'],
          [at('2026-10-25', '23:00'), 'Health set to green'],
        ),
        general: log([at(MON), 'Added meeting "Planning"']),
        'p-gone': log([at(MON), 'Created project']),
      },
    });
    const recap = buildRecap(s, TUE);
    expect(recap.activity.map((g) => g.project?.id ?? null)).toEqual([
      'p',
      null,
    ]);
    const echo = recap.activity[0];
    expect(echo?.items.map((e) => e.text)).toEqual([
      'Health set to yellow',
      'Status changed to paused',
      'Blocked "Motivator" on Leia',
      'Added milestone "Ridge" (Fri 30 Oct)',
      'Edited project details',
    ]);
    expect(echo?.items).toHaveLength(RECAP_ACTIVITY_CAP);
    expect(echo?.more).toBe(2);
    expect(recap.activity[1]?.items.map((e) => e.text)).toEqual([
      'Added meeting "Planning"',
    ]);
    expect(recapCounts(recap).activity).toBe(8);
  });
});

describe('recapLine', () => {
  it('counts what happened, each part only when there is some', () => {
    const s = snapshot({
      tasks: byId(
        done('a', MON),
        done('b', MON),
        task('c', { createdAt: at(MON) }),
      ),
      meetings: byId(meeting('m')),
      notes: byId(
        note('n1', { createdAt: at(MON) }),
        note('n2', { createdAt: at(MON) }),
      ),
    });
    expect(recapLine(buildRecap(s, TUE))).toBe(
      'Yesterday: 2 closed · 1 added · 1 meeting · 2 notes',
    );
  });

  it('falls back to the activity, and is empty when nothing happened', () => {
    const quiet = buildRecap(snapshot({}), MON);
    expect(recapEmpty(quiet)).toBe(true);
    expect(recapLine(quiet)).toBe('');
    const busy = buildRecap(
      snapshot({
        projects: byId(project('p')),
        activity: {
          p: log(
            [at('2026-10-24'), 'Health set to red'],
            [at('2026-10-23'), 'Status changed to paused'],
          ),
        },
      }),
      MON,
    );
    expect(recapEmpty(busy)).toBe(false);
    expect(recapLine(busy)).toBe('Since Friday: 2 updates');
  });
});
