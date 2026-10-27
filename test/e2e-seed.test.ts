import { describe, expect, it } from 'vitest';
import { daysBetween, SEED_ANCHOR, shiftDates } from '../e2e/seed';
import { addDays } from '../shared/dates';
import fixture from './fixtures/export.json';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/** Every leaf of `value` with its path, `a.b[0].c`. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      leaves(v, path ? `${path}.${k}` : k),
    );
  }
  return [[path, value]];
}

describe('the e2e seed, shifted to today', () => {
  it('counts whole days between two dates', () => {
    expect(daysBetween(SEED_ANCHOR, SEED_ANCHOR)).toBe(0);
    expect(daysBetween('2026-10-27', '2026-10-28')).toBe(1);
    expect(daysBetween('2026-10-27', '2026-10-20')).toBe(-7);
    expect(daysBetween('2026-10-27', '2027-10-27')).toBe(365);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is the export itself on the anchor day', () => {
    expect(shiftDates(fixture, 0)).toEqual(fixture);
  });

  it('moves every date and timestamp, and nothing else', () => {
    for (const days of [1, -1, 3, 400]) {
      const shifted = new Map(leaves(shiftDates(fixture, days)));
      const moved = new Set<string>();
      for (const [path, before] of leaves(fixture)) {
        const after = shifted.get(path);
        const key = path.replace(/.*\./, '').replace(/\[\d+\]$/, '');
        if (typeof before === 'string' && DAY.test(before)) {
          expect(after, path).toBe(addDays(before, days));
          moved.add(key);
        } else if (typeof before === 'string' && TIMESTAMP.test(before)) {
          // The Workers runtime is on UTC, so a day is 24 hours here.
          expect(Date.parse(after as string) - Date.parse(before), path).toBe(
            days * 86_400_000,
          );
          moved.add(key);
        } else {
          expect(after, path).toEqual(before);
        }
      }
      expect([...moved].sort()).toEqual([
        'completedAt',
        'createdAt',
        'date',
        'due',
        'editedAt',
        'exportedAt',
        'startDate',
        't',
        'targetDate',
        'updatedAt',
      ]);
    }
  });

  it('leaves text that mentions a date alone', () => {
    const shifted = shiftDates(fixture, 5);
    expect(shifted.notes['n-2'].body).toBe(fixture.notes['n-2'].body);
    expect(shifted.notes['n-2'].body).toContain('2026-10-27');
    expect(shifted.meetings['e-1'].time).toBe('14:00');
    expect(shifted.tasks['t-2'].due).toBe('');
    expect(shifted.tasks['t-1'].completedAt).toBeNull();
  });
});
