import { describe, expect, it } from 'vitest';
import { ExportSchema } from '#shared/protocol';
import {
  DEFAULT_TASK_FILTERS,
  defaultAssignee,
  dueBucket,
  dueForBucket,
  selectTasks,
} from '#shared/tasks';
import type { Snapshot, Task } from '#shared/types';
import fixture from './fixtures/export.json';

const today = '2026-10-23';
function seeded(): Snapshot {
  const { exportedAt: _, ...state } = ExportSchema.parse(fixture);
  return state;
}
const ids = (rows: Task[]) => rows.map((t) => t.id);

describe('defaultAssignee', () => {
  const s = seeded();
  const meIn = Object.values(s.people).find((p) => p.me)?.id;
  const withSetting = (assignToMe: boolean | undefined) => ({
    ...s,
    settings: { user: { defaultOrg: '', assignToMe } },
  });

  it('is nobody until the setting is on', () => {
    expect(meIn).toBeTruthy();
    expect(defaultAssignee(s)).toBe('');
    expect(defaultAssignee(withSetting(undefined))).toBe('');
    expect(defaultAssignee(withSetting(false))).toBe('');
  });

  it('is the person marked as you when it is on', () => {
    expect(defaultAssignee(withSetting(true))).toBe(meIn);
  });

  it('is nobody when on but nobody is marked as you', () => {
    const people = Object.fromEntries(
      Object.entries(s.people).map(([id, p]) => [id, { ...p, me: false }]),
    );
    expect(defaultAssignee({ ...withSetting(true), people })).toBe('');
  });
});

describe('selectTasks', () => {
  const s = seeded();

  it('Blocked shows only tasks waiting on someone', () => {
    const state = {
      ...s,
      tasks: {
        ...s.tasks,
        't-4': { ...s.tasks['t-4'], blocked: { on: null, note: 'vet' } },
      } as typeof s.tasks,
    };
    const groups = selectTasks(
      state,
      { ...DEFAULT_TASK_FILTERS, blocked: true },
      today,
      null,
    );
    expect(groups.flatMap((g) => ids(g.rows))).toEqual(['t-4']);
  });

  it('groups open tasks by project, General last', () => {
    const groups = selectTasks(s, DEFAULT_TASK_FILTERS, today, 'u-leia');
    expect(groups.map((g) => g.label)).toEqual([
      'Echo Base relocation',
      'Falcon hyperdrive refit',
      'General',
    ]);
    // Sorted by due, undated last.
    expect(ids(groups[0]?.rows ?? [])).toEqual(['t-1', 't-4', 't-2']);
  });

  it('shows done or all, and filters by assignee and text', () => {
    const done = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, status: 'done', group: 'none' },
      today,
      null,
    );
    expect(ids(done[0]?.rows ?? []).sort()).toEqual(['t-3', 't-7']);
    const mine = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, who: { kind: 'mine' }, group: 'none' },
      today,
      'u-leia',
    );
    expect(ids(mine[0]?.rows ?? [])).toEqual(['t-1']);
    const text = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, q: 'MOTIVATOR', group: 'none' },
      today,
      null,
    );
    expect(ids(text[0]?.rows ?? [])).toEqual(['t-5']);
    const tag = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, q: 'logistics', group: 'none' },
      today,
      null,
    );
    expect(ids(tag[0]?.rows ?? [])).toEqual(['t-1']);
  });

  it('groups by due bucket in time order, and by assignee with Unassigned last', () => {
    const due = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'due' },
      today,
      null,
    );
    expect(due.map((g) => g.label)).toEqual(['This week', 'Later', 'No date']);
    const who = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'assignee' },
      today,
      null,
    );
    expect(who.map((g) => g.label)).toEqual([
      'Chewbacca',
      'Han Solo',
      'Leia Organa',
      'Unassigned',
    ]);
  });

  it('sorts both ways, ties by title', () => {
    const asc = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'none', sort: 'title' },
      today,
      null,
    );
    const desc = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'none', sort: 'title', dir: 'desc' },
      today,
      null,
    );
    expect(ids(desc[0]?.rows ?? [])).toEqual(ids(asc[0]?.rows ?? []).reverse());
    const prio = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'none', sort: 'priority' },
      today,
      null,
    );
    expect(prio[0]?.rows[0]?.priority).toBe('high');
  });

  it('buckets due dates', () => {
    const t = (due: string) => ({ ...s.tasks['t-1'], due }) as Task;
    expect(dueBucket(t('2026-10-22'), today)).toBe('overdue');
    expect(dueBucket(t('2026-10-23'), today)).toBe('today');
    expect(dueBucket(t('2026-10-25'), today)).toBe('week');
    expect(dueBucket(t('2026-10-26'), today)).toBe('later');
    expect(dueBucket(t(''), today)).toBe('none');
  });
});

describe('dropping on a due column', () => {
  it('sets a concrete date per bucket', () => {
    // Friday 23 October 2026.
    expect(dueForBucket('today', today)).toBe('2026-10-23');
    expect(dueForBucket('week', today)).toBe('2026-10-23');
    expect(dueForBucket('week', '2026-10-21')).toBe('2026-10-23');
    // Saturday: Friday has gone, so Sunday.
    expect(dueForBucket('week', '2026-10-24')).toBe('2026-10-25');
    expect(dueForBucket('later', today)).toBe('2026-11-06');
    expect(dueForBucket('none', today)).toBe('');
    expect(dueForBucket('overdue', today)).toBeNull();
  });

  it('groups by priority, highest first', () => {
    const s = seeded();
    const groups = selectTasks(
      s,
      { ...DEFAULT_TASK_FILTERS, group: 'priority' },
      today,
      null,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'High',
      'Medium',
      'Low',
      'No priority',
    ]);
  });
});
