import { describe, expect, it } from 'vitest';
import type { BackupList } from '#shared/protocol';
import {
  backupStatus,
  lastDailyAt,
  nextDailyAt as nextResetAt,
  zonedDay,
  zonedParts,
} from '#shared/schedule';

const TZ = 'America/New_York';

function at(iso: string): number {
  return Date.parse(iso);
}

function etParts(ts: number) {
  const p = zonedParts(ts, TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

describe('nextDailyAt (holocron’s nextResetAt)', () => {
  it('is 6 AM ET later today when created before 6 AM ET', () => {
    // 05:59 EDT = 09:59 UTC
    const now = at('2026-07-15T09:59:00Z');
    const next = nextResetAt(now, TZ, 6);
    expect(etParts(next)).toBe('2026-07-15 06:00');
    expect(next).toBe(at('2026-07-15T10:00:00Z'));
    expect(next - now).toBe(60_000);
  });

  it('is 6 AM ET tomorrow when created at or after 6 AM ET', () => {
    const exactly = at('2026-07-15T10:00:00Z');
    expect(etParts(nextResetAt(exactly, TZ, 6))).toBe('2026-07-16 06:00');

    const evening = at('2026-07-15T23:30:00Z'); // 19:30 EDT
    expect(etParts(nextResetAt(evening, TZ, 6))).toBe('2026-07-16 06:00');
  });

  it('handles the evening in ET being the next day in UTC', () => {
    // 22:00 EST on Jan 10 is 03:00 UTC on Jan 11.
    const now = at('2026-01-11T03:00:00Z');
    expect(etParts(nextResetAt(now, TZ, 6))).toBe('2026-01-11 06:00');
    expect(nextResetAt(now, TZ, 6)).toBe(at('2026-01-11T11:00:00Z'));
  });

  it('is 23 hours apart across the spring-forward night', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 in New York.
    const before = at('2026-03-07T12:00:00Z'); // noon UTC, 07:00 EST
    const first = nextResetAt(before, TZ, 6); // Mar 8 06:00 EDT = 10:00 UTC
    const second = nextResetAt(first, TZ, 6); // Mar 9 06:00 EDT = 10:00 UTC
    expect(first).toBe(at('2026-03-08T10:00:00Z'));
    expect(second - first).toBe(24 * 3_600_000);
    const prev = nextResetAt(at('2026-03-06T12:00:00Z'), TZ, 6); // Mar 7 06:00 EST = 11:00 UTC
    expect(first - prev).toBe(23 * 3_600_000);
  });

  it('is 25 hours apart across the fall-back night', () => {
    // 2026-11-01: clocks fall back 02:00 → 01:00 in New York.
    const oct31 = nextResetAt(at('2026-10-30T12:00:00Z'), TZ, 6); // Oct 31 06:00 EDT = 10:00 UTC
    const nov1 = nextResetAt(oct31, TZ, 6); // Nov 1 06:00 EST = 11:00 UTC
    expect(oct31).toBe(at('2026-10-31T10:00:00Z'));
    expect(nov1).toBe(at('2026-11-01T11:00:00Z'));
    expect(nov1 - oct31).toBe(25 * 3_600_000);
  });

  it('respects other zones and hours', () => {
    const now = at('2026-07-15T12:00:00Z');
    const london = nextResetAt(now, 'Europe/London', 9); // 09:00 BST = 08:00 UTC next day
    expect(london).toBe(at('2026-07-16T08:00:00Z'));
    const tokyo = nextResetAt(now, 'Asia/Tokyo', 0); // midnight JST = 15:00 UTC today
    expect(tokyo).toBe(at('2026-07-15T15:00:00Z'));
  });

  it('is always strictly in the future', () => {
    let now = at('2026-01-01T00:00:00Z');
    for (let i = 0; i < 400; i++) {
      const next = nextResetAt(now, TZ, 6);
      expect(next).toBeGreaterThan(now);
      expect(etParts(next).endsWith('06:00')).toBe(true);
      now = next;
    }
  });
});

describe('lastDailyAt and zonedDay', () => {
  it('is the latest 3 AM at or before now, in the zone’s calendar', () => {
    // 02:59 EDT on Jul 15 → 03:00 EDT Jul 14.
    expect(lastDailyAt(at('2026-07-15T06:59:00Z'), TZ, 3)).toBe(
      at('2026-07-14T07:00:00Z'),
    );
    // Exactly 03:00 counts.
    expect(lastDailyAt(at('2026-07-15T07:00:00Z'), TZ, 3)).toBe(
      at('2026-07-15T07:00:00Z'),
    );
    // Across fall-back: Nov 1 03:00 EST = 08:00 UTC.
    expect(lastDailyAt(at('2026-11-01T12:00:00Z'), TZ, 3)).toBe(
      at('2026-11-01T08:00:00Z'),
    );
  });

  it('names the day in the zone, not in UTC', () => {
    expect(zonedDay(at('2026-01-11T03:00:00Z'), TZ)).toBe('2026-01-10');
  });
});

describe('backupStatus', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 60 * 60_000).toISOString();
  const list = (ats: string[], failedAt?: string): BackupList => ({
    backups: ats.map((at) => ({ day: at.slice(0, 10), bytes: 1, at })),
    hour: 3,
    timeZone: TZ,
    ...(failedAt ? { failedAt } : {}),
  });

  it('is null before the first backup', () => {
    expect(backupStatus(list([]), now, true)).toBeNull();
  });

  it('says when, quietly, while backups are current', () => {
    expect(backupStatus(list([hoursAgo(9)]), now, true)).toEqual({
      text: 'Last backup: 9 h ago.',
      warn: false,
    });
  });

  it('warns once a space with data has gone two days without one', () => {
    const old = list([hoursAgo(72)]);
    expect(backupStatus(old, now, true)?.warn).toBe(true);
    expect(backupStatus(old, now, true)?.text).toMatch(/^Last backup: \w{3} /);
    // An empty space writes nothing, so an old backup is expected.
    expect(backupStatus(old, now, false)?.warn).toBe(false);
  });

  it('warns about a failure newer than the last backup', () => {
    expect(backupStatus(list([hoursAgo(33)], hoursAgo(9)), now, true)).toEqual({
      text: 'Last backup: yesterday. The latest attempt failed 9 h ago and is retried on its own.',
      warn: true,
    });
    expect(backupStatus(list([], hoursAgo(1)), now, true)).toEqual({
      text: 'The first backup failed 1 h ago. It is retried on its own.',
      warn: true,
    });
  });

  it('ignores a failure older than the last backup', () => {
    expect(
      backupStatus(list([hoursAgo(1)], hoursAgo(5)), now, true)?.warn,
    ).toBe(false);
  });
});
