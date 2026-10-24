import { describe, expect, it } from 'vitest';
import {
  describeWhen,
  monthLabel,
  parseTime,
  projectEvents,
  selectEvents,
  splitByMonth,
  timeRange,
} from '#shared/events';
import type { Event } from '#shared/types';

function event(id: string, patch: Partial<Event>): Event {
  return {
    id,
    projectId: null,
    title: id,
    type: 'meeting',
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

describe('selecting events', () => {
  const events = {
    b: event('b', { date: '2026-10-27', time: '14:00', projectId: 'p1' }),
    a: event('a', { date: '2026-10-27', projectId: 'p1', type: 'milestone' }),
    c: event('c', { date: '2026-09-02' }),
    d: event('d', { date: '2026-11-03', projectId: 'p2', type: 'deadline' }),
  };

  it('orders by day, then all-day before timed', () => {
    expect(
      selectEvents(events, { project: '', type: '' }).map((e) => e.id),
    ).toEqual(['c', 'a', 'b', 'd']);
  });

  it('filters by project, General and type', () => {
    const ids = (project: string, type: Event['type'] | '') =>
      selectEvents(events, { project, type }).map((e) => e.id);
    expect(ids('p1', '')).toEqual(['a', 'b']);
    expect(ids('general', '')).toEqual(['c']);
    expect(ids('', 'deadline')).toEqual(['d']);
    expect(ids('p1', 'deadline')).toEqual([]);
  });

  it("lists one project's events", () => {
    expect(projectEvents(events, 'p1').map((e) => e.id)).toEqual(['a', 'b']);
    expect(projectEvents(events, null).map((e) => e.id)).toEqual(['c']);
  });

  it('groups upcoming by month and puts the past newest first', () => {
    const all = selectEvents(
      { ...events, e: event('e', { date: '2026-08-01' }) },
      { project: '', type: '' },
    );
    const { upcoming, past } = splitByMonth(all, '2026-10-27');
    expect(upcoming.map((m) => [m.month, m.events.map((e) => e.id)])).toEqual([
      ['2026-10', ['a', 'b']],
      ['2026-11', ['d']],
    ]);
    expect(past.map((e) => e.id)).toEqual(['c', 'e']);
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('describing when', () => {
  it('shows the range, the start, or the day alone', () => {
    expect(timeRange({ time: '14:00', end: '15:00' })).toBe('14:00–15:00');
    expect(timeRange({ time: '14:00', end: '' })).toBe('14:00');
    expect(timeRange({ time: '', end: '' })).toBe('');
    expect(describeWhen(event('x', { time: '09:30' }), '2026-10-24')).toBe(
      'Tue 27 Oct, 09:30',
    );
    expect(describeWhen(event('x', {}), '2025-01-01')).toBe('Tue 27 Oct 2026');
  });
});
