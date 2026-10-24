import { describe, expect, it } from 'vitest';
import {
  addDays,
  describeDay,
  endOfWeek,
  formatDay,
  formatTimestamp,
  localDate,
  parseDate,
  relativeTime,
  weekday,
} from '#shared/dates';

describe('dates', () => {
  it('reads the local calendar day, changing at local midnight', () => {
    expect(localDate(new Date(2026, 9, 23, 23, 59, 59, 999))).toBe(
      '2026-10-23',
    );
    expect(localDate(new Date(2026, 9, 24, 0, 0, 0, 0))).toBe('2026-10-24');
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weeks run Monday to Sunday', () => {
    expect(weekday('2026-10-19')).toBe(0); // Monday
    expect(weekday('2026-10-25')).toBe(6); // Sunday
    expect(endOfWeek('2026-10-19')).toBe('2026-10-25');
    expect(endOfWeek('2026-10-23')).toBe('2026-10-25');
    expect(endOfWeek('2026-10-25')).toBe('2026-10-25');
  });
});

describe('parseDate', () => {
  // Friday 23 October 2026.
  const today = '2026-10-23';
  const cases: Array<[string, string | null]> = [
    ['', ''],
    ['   ', ''],
    ['today', '2026-10-23'],
    ['Tod', '2026-10-23'],
    ['tomorrow', '2026-10-24'],
    ['tmr', '2026-10-24'],
    ['yesterday', '2026-10-22'],
    // A weekday is the next one, today included.
    ['fri', '2026-10-23'],
    ['sat', '2026-10-24'],
    ['sunday', '2026-10-25'],
    ['mon', '2026-10-26'],
    ['thu', '2026-10-29'],
    // "next" is that day in next week (Monday 26 to Sunday 1 November).
    ['next mon', '2026-10-26'],
    ['next tue', '2026-10-27'],
    ['next fri', '2026-10-30'],
    ['next sun', '2026-11-01'],
    ['next week', '2026-10-26'],
    ['next month', '2026-11-01'],
    // Relative, across the month end.
    ['+3d', '2026-10-26'],
    ['+9d', '2026-11-01'],
    ['3d', '2026-10-26'],
    ['in 3 days', '2026-10-26'],
    ['-1d', '2026-10-22'],
    ['+2w', '2026-11-06'],
    ['in 2 weeks', '2026-11-06'],
    ['+1m', '2026-11-23'],
    // Month and day: this year, or next once it has passed.
    ['10/31', '2026-10-31'],
    ['10/23', '2026-10-23'],
    ['1/5', '2027-01-05'],
    ['10/22', '2027-10-22'],
    ['2/29', '2028-02-29'],
    ['10/31/2027', '2027-10-31'],
    ['10/31/27', '2027-10-31'],
    ['2026-10-31', '2026-10-31'],
    ['2026-1-5', '2026-01-05'],
    // Unreadable or impossible.
    ['soon', null],
    ['2026-02-30', null],
    ['13/1', null],
    ['next', null],
    ['+3x', null],
  ];
  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)}`, () => {
      expect(parseDate(input, today)).toBe(expected);
    });
  }

  it('wraps the week from a Sunday', () => {
    expect(parseDate('mon', '2026-10-25')).toBe('2026-10-26');
    expect(parseDate('next mon', '2026-10-25')).toBe('2026-10-26');
    expect(parseDate('sun', '2026-10-25')).toBe('2026-10-25');
    expect(parseDate('next sun', '2026-10-25')).toBe('2026-11-01');
  });

  it('keeps month arithmetic inside short months and across years', () => {
    expect(parseDate('+1m', '2026-01-31')).toBe('2026-02-28');
    expect(parseDate('+1m', '2028-01-31')).toBe('2028-02-29');
    expect(parseDate('+3d', '2026-12-30')).toBe('2027-01-02');
    expect(parseDate('next month', '2026-12-15')).toBe('2027-01-01');
    expect(parseDate('fri', '2026-12-31')).toBe('2027-01-01');
  });
});

describe('formatting days', () => {
  const today = '2026-10-23';
  it('names the day', () => {
    expect(formatDay('2026-10-31', today)).toBe('Sat 31 Oct');
    expect(formatDay('2027-01-05', today)).toBe('Tue 5 Jan 2027');
  });
  it('says today, tomorrow and yesterday in words', () => {
    expect(describeDay('2026-10-23', today)).toBe('Today');
    expect(describeDay('2026-10-24', today)).toBe('Tomorrow');
    expect(describeDay('2026-10-22', today)).toBe('Yesterday');
    expect(describeDay('2026-10-27', today)).toBe('Tue 27 Oct');
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 9, 23, 15, 0, 0);
  const at = (d: Date) => d.toISOString();
  it('counts recent minutes and hours', () => {
    expect(relativeTime(at(new Date(2026, 9, 23, 14, 59, 40)), now)).toBe(
      'just now',
    );
    expect(relativeTime(at(new Date(2026, 9, 23, 14, 55)), now)).toBe(
      '5 min ago',
    );
    expect(relativeTime(at(new Date(2026, 9, 23, 12, 0)), now)).toBe('3 h ago');
  });
  it('names yesterday and earlier days', () => {
    expect(relativeTime(at(new Date(2026, 9, 22, 23, 0)), now)).toBe(
      'yesterday',
    );
    expect(relativeTime(at(new Date(2026, 9, 20, 9, 0)), now)).toBe(
      'Tue 20 Oct',
    );
    expect(relativeTime(at(new Date(2025, 9, 20, 9, 0)), now)).toBe(
      'Mon 20 Oct 2025',
    );
  });
  it('formats an absolute time with the year', () => {
    expect(formatTimestamp(at(new Date(2026, 9, 23, 14, 5)))).toBe(
      'Fri 23 Oct 2026, 14:05',
    );
  });
});
