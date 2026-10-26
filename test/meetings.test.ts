import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import {
  checkTopicLines,
  describeWhen,
  monthLabel,
  parseTime,
  projectMeetings,
  restoredOrder,
  selectMeetings,
  splitByMonth,
  timeRange,
  topicCount,
  topicLines,
  topicOps,
  uncoveredTopicList,
} from '#shared/meetings';
import { byDate, nextMilestone } from '#shared/milestones';
import { OpSchema } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import { emptySnapshot, type Meeting, topicsOf } from '#shared/types';

function meeting(id: string, patch: Partial<Meeting>): Meeting {
  return {
    id,
    projectId: null,
    title: id,
    date: '2026-10-27',
    time: '',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...patch,
  };
}

describe('parseTime', () => {
  it.each([
    ['9', '09:00'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['930', '09:30'],
    ['0930', '09:30'],
    ['14', '14:00'],
    ['1430', '14:30'],
    ['2pm', '14:00'],
    ['2:30 pm', '14:30'],
    ['2:30PM', '14:30'],
    ['11a', '11:00'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
    ['  ', ''],
  ])('reads %j as %j', (input, out) => {
    expect(parseTime(input)).toBe(out);
  });

  it.each(['24', '9:60', '13pm', '0am', 'soon', '12345', '9:3'])(
    'refuses %j',
    (input) => {
      expect(parseTime(input)).toBeNull();
    },
  );
});

describe('selecting meetings', () => {
  const meetings = {
    b: meeting('b', { date: '2026-10-27', time: '14:00', projectId: 'p1' }),
    a: meeting('a', { date: '2026-10-27', projectId: 'p1' }),
    c: meeting('c', { date: '2026-09-02' }),
    d: meeting('d', { date: '2026-11-03', projectId: 'p2' }),
  };

  it('orders by day, then all-day before timed', () => {
    expect(selectMeetings(meetings, { project: '' }).map((m) => m.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('filters by project and General', () => {
    const ids = (project: string) =>
      selectMeetings(meetings, { project }).map((m) => m.id);
    expect(ids('p1')).toEqual(['a', 'b']);
    expect(ids('general')).toEqual(['c']);
    expect(ids('p2')).toEqual(['d']);
    expect(ids('p9')).toEqual([]);
  });

  it("lists one project's meetings", () => {
    expect(projectMeetings(meetings, 'p1').map((m) => m.id)).toEqual([
      'a',
      'b',
    ]);
    expect(projectMeetings(meetings, null).map((m) => m.id)).toEqual(['c']);
  });

  it('groups upcoming by month and puts the past newest first', () => {
    const all = selectMeetings(
      { ...meetings, e: meeting('e', { date: '2026-08-01' }) },
      { project: '' },
    );
    const { upcoming, past } = splitByMonth(all, '2026-10-27');
    expect(upcoming.map((m) => [m.month, m.meetings.map((e) => e.id)])).toEqual(
      [
        ['2026-10', ['a', 'b']],
        ['2026-11', ['d']],
      ],
    );
    expect(past.map((e) => e.id)).toEqual(['c', 'e']);
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('describing when', () => {
  it('shows the range, the start, or the day alone', () => {
    expect(timeRange({ time: '14:00', end: '15:00' })).toBe('14:00–15:00');
    expect(timeRange({ time: '14:00', end: '' })).toBe('14:00');
    expect(timeRange({ time: '', end: '' })).toBe('');
    expect(describeWhen(meeting('x', { time: '09:30' }), '2026-10-24')).toBe(
      'Tue 27 Oct, 09:30',
    );
    expect(describeWhen(meeting('x', {}), '2025-01-01')).toBe(
      'Tue 27 Oct 2026',
    );
  });
});

describe('milestones', () => {
  const project = {
    milestones: [
      { id: 'old', title: 'Kickoff', date: '2026-10-01' },
      { id: 'b', title: 'Beta', date: '2026-11-14' },
      { id: 'a', title: 'Alpha', date: '2026-11-14' },
      { id: 'late', title: 'Launch', date: '2026-12-01' },
    ],
  };

  it('sorts by date, then title', () => {
    expect([...project.milestones].sort(byDate).map((m) => m.id)).toEqual([
      'old',
      'a',
      'b',
      'late',
    ]);
  });

  it('finds the next one on or after today', () => {
    expect(nextMilestone(project, '2026-10-23')?.id).toBe('a');
    expect(nextMilestone(project, '2026-11-15')?.id).toBe('late');
    expect(nextMilestone(project, '2026-12-01')?.id).toBe('late');
    expect(nextMilestone(project, '2026-12-02')).toBeNull();
    expect(nextMilestone({}, '2026-10-23')).toBeNull();
  });
});

describe('the meeting form’s Topics field', () => {
  it('reads one topic per line, trimmed, blanks dropped', () => {
    expect(topicLines('')).toEqual([]);
    expect(topicLines('  \n\n ')).toEqual([]);
    expect(
      topicLines(' Power budget \r\n\nNorth ridge\n  Hoth weather  '),
    ).toEqual(['Power budget', 'North ridge', 'Hoth weather']);
  });

  it('says what is wrong: a long line, or too many', () => {
    expect(checkTopicLines(['a', 'b'])).toBeNull();
    expect(checkTopicLines(['a', 'x'.repeat(LIMITS.titleMax + 1)])).toBe(
      `Line 2 is too long (${LIMITS.titleMax} characters at most)`,
    );
    const many = Array.from({ length: LIMITS.topicsMax }, (_, i) => `t${i}`);
    expect(checkTopicLines(many)).toBeNull();
    expect(checkTopicLines([...many, 'one more'])).toBe(
      `A meeting has ${LIMITS.topicsMax} topics at most`,
    );
    expect(checkTopicLines(['a', 'b'], LIMITS.topicsMax - 1)).toBe(
      `A meeting has ${LIMITS.topicsMax} topics at most; it has ${LIMITS.topicsMax - 1}`,
    );
  });

  it('maps the lines to addTopic ops, in order, with fresh ids', () => {
    let n = 0;
    const ops = topicOps(
      'm1',
      ['Power budget', 'North ridge'],
      () => `t${++n}`,
    );
    expect(ops).toEqual([
      { type: 'addTopic', meetingId: 'm1', id: 't1', title: 'Power budget' },
      { type: 'addTopic', meetingId: 'm1', id: 't2', title: 'North ridge' },
    ]);
    expect(topicOps('m1', [], () => 'x')).toEqual([]);
  });

  it('goes in one batch with the meeting, which the reducer takes', () => {
    let n = 0;
    const op = OpSchema.parse({
      type: 'batch',
      ops: [
        {
          type: 'addMeeting',
          id: 'm1',
          projectId: null,
          title: 'Shield review',
          date: '2026-10-27',
        },
        ...topicOps(
          'm1',
          topicLines('Power budget\nNorth ridge'),
          () => `t${++n}`,
        ),
      ],
    });
    const { state } = reduce(emptySnapshot(), op, '2026-10-20T10:00:00.000Z');
    const m = state.meetings.m1;
    expect(m && topicsOf(m)).toEqual([
      { id: 't1', title: 'Power budget', done: false, outcome: '' },
      { id: 't2', title: 'North ridge', done: false, outcome: '' },
    ]);
  });
});

describe('topics on the row and in notes', () => {
  const topics = [
    { id: 'a', title: 'Power budget', done: true, outcome: 'Approved' },
    { id: 'b', title: 'North ridge', done: false, outcome: '' },
    { id: 'c', title: 'Hoth weather', done: false, outcome: '' },
  ];

  it('counts covered of all', () => {
    expect(topicCount([])).toBe('');
    expect(topicCount(topics)).toBe('1 of 3 topics');
    expect(topicCount(topics.slice(0, 1))).toBe('1 of 1 topic');
  });

  it('lists the uncovered ones for a Prep note', () => {
    expect(uncoveredTopicList(meeting('m', { topics }))).toBe(
      '- North ridge\n- Hoth weather',
    );
    expect(uncoveredTopicList(meeting('m', {}))).toBe('');
  });

  it('puts a deleted topic back where it was', () => {
    expect(restoredOrder(['a', 'b', 'c'], ['b', 'c', 'a'], 'a')).toEqual([
      'a',
      'b',
      'c',
    ]);
    // Since deleted: gone. Since added: at the end.
    expect(restoredOrder(['a', 'b', 'c'], ['b', 'd', 'a'], 'a')).toEqual([
      'a',
      'b',
      'd',
    ]);
  });
});
