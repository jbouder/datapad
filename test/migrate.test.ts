import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { isLegacy, migrate } from '#shared/migrate';
import { ExportSchema } from '#shared/protocol';
import { merge } from '#shared/reducer';
import { emptySnapshot } from '#shared/types';
import fixture from './fixtures/export.json';
import legacy from './fixtures/legacy-export.json';

const at = '2026-10-01T09:00:00.000Z';

/** A legacy event, as schema 2 stored it. */
function event(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    title: id,
    type: 'meeting',
    date: '2026-11-01',
    time: '',
    end: '',
    attendees: [],
    link: '',
    note: '',
    createdAt: at,
    updatedAt: at,
    ...patch,
  };
}

function project(id: string, patch: Record<string, unknown> = {}) {
  return { id, name: id, createdAt: at, updatedAt: at, ...patch };
}

function note(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    body: id,
    pinned: false,
    eventId: null,
    phase: null,
    createdAt: at,
    ...patch,
  };
}

type Out = {
  projects: Record<string, { milestones?: unknown[] }>;
  notes: Record<string, Record<string, unknown>>;
  meetings: Record<string, Record<string, unknown>>;
  activity?: unknown;
};

const run = (input: unknown) => migrate(input) as Out;

describe('migrate', () => {
  it('turns meeting, demo and other (and untyped) events into meetings, ids and fields kept', () => {
    const out = run({
      projects: { p1: project('p1') },
      events: {
        a: event('a'),
        b: event('b', { type: 'demo', attendees: ['u1'], link: 'https://x' }),
        c: event('c', { type: 'other', projectId: null }),
        d: (() => {
          const { type: _, ...rest } = event('d');
          return rest;
        })(),
      },
    });
    expect(out).not.toHaveProperty('events');
    expect(Object.keys(out.meetings)).toEqual(['a', 'b', 'c', 'd']);
    const { type: _, ...b } = event('b', {
      attendees: ['u1'],
      link: 'https://x',
    });
    expect(out.meetings.b).toEqual(b);
    for (const m of Object.values(out.meetings)) {
      expect(m).not.toHaveProperty('type');
    }
    expect(out.meetings.c?.projectId).toBeNull();
    expect(out.projects.p1).not.toHaveProperty('milestones');
  });

  it('moves milestones and deadlines on a project onto it, sorted, and drops the event', () => {
    const out = run({
      projects: {
        p1: project('p1', {
          milestones: [{ id: 'm0', title: 'Kickoff', date: '2026-10-01' }],
        }),
        p2: project('p2'),
      },
      events: {
        late: event('late', { type: 'deadline', date: '2026-12-01' }),
        soon: event('soon', { type: 'milestone', title: 'Beta' }),
        meet: event('meet'),
      },
    });
    expect(Object.keys(out.meetings)).toEqual(['meet']);
    expect(out.projects.p1?.milestones).toEqual([
      { id: 'm0', title: 'Kickoff', date: '2026-10-01' },
      { id: 'soon', title: 'Beta', date: '2026-11-01' },
      { id: 'late', title: 'late', date: '2026-12-01' },
    ]);
    expect(out.projects.p2).toEqual(project('p2'));
  });

  it('unlinks the notes of an event that became a milestone', () => {
    const out = run({
      projects: { p1: project('p1') },
      events: { m: event('m', { type: 'milestone' }), x: event('x') },
      notes: {
        gone: note('gone', { eventId: 'm', phase: 'pre', body: 'Keep me' }),
        kept: note('kept', { eventId: 'x', phase: 'post' }),
        loose: note('loose'),
      },
    });
    expect(out.notes.gone).toEqual({
      ...note('gone', { body: 'Keep me' }),
      eventId: undefined,
      meetingId: null,
      phase: null,
    });
    expect(out.notes.gone).not.toHaveProperty('eventId');
    expect(out.notes.kept).toMatchObject({ meetingId: 'x', phase: 'post' });
    expect(out.notes.kept).not.toHaveProperty('eventId');
    expect(out.notes.loose).toMatchObject({ meetingId: null, phase: null });
  });

  it('keeps milestones and deadlines in General as meetings, titled so', () => {
    const out = run({
      events: {
        m: event('m', { type: 'milestone', projectId: null, title: 'Ship' }),
        d: event('d', { type: 'deadline', projectId: null, title: 'Taxes' }),
      },
    });
    expect(out.meetings.m).toMatchObject({
      title: 'Milestone: Ship',
      projectId: null,
    });
    expect(out.meetings.d).toMatchObject({ title: 'Deadline: Taxes' });
    expect(out.meetings.d).not.toHaveProperty('type');
  });

  it('keeps a marker whose project is not there, or is full, as a meeting', () => {
    const full = Array.from({ length: LIMITS.milestonesMax }, (_, i) => ({
      id: `m${i}`,
      title: `M${i}`,
      date: '2026-10-01',
    }));
    const out = run({
      projects: { p1: project('p1', { milestones: full }) },
      events: {
        over: event('over', { type: 'milestone', title: 'One more' }),
        lost: event('lost', { type: 'deadline', projectId: 'p9' }),
      },
    });
    expect(out.projects.p1?.milestones).toHaveLength(LIMITS.milestonesMax);
    expect(out.meetings.over?.title).toBe('Milestone: One more');
    expect(out.meetings.lost).toMatchObject({
      title: 'Deadline: lost',
      projectId: 'p9',
    });
  });

  it('keeps a prefixed title within the limit', () => {
    const long = 'x'.repeat(LIMITS.titleMax);
    const out = run({
      events: {
        d: event('d', { type: 'deadline', projectId: null, title: long }),
      },
    });
    const title = out.meetings.d?.title as string;
    expect(title.length).toBe(LIMITS.titleMax);
    expect(title.startsWith('Deadline: ')).toBe(true);
  });

  it('reads arrays of documents too, and keeps their shape', () => {
    const out = run({
      projects: [project('p1')],
      events: [event('m', { type: 'milestone' }), event('x')],
      notes: [note('n', { eventId: 'x' })],
    }) as unknown as {
      projects: Array<{ milestones?: unknown[] }>;
      notes: Array<Record<string, unknown>>;
      meetings: Record<string, unknown>;
    };
    expect(out.projects[0]?.milestones).toEqual([
      { id: 'm', title: 'm', date: '2026-11-01' },
    ]);
    expect(Object.keys(out.meetings)).toEqual(['x']);
    expect(out.notes[0]).toMatchObject({ meetingId: 'x' });
  });

  it('leaves activity alone: history is history', () => {
    const activity = {
      p1: { events: [{ t: at, text: 'Added milestone "Ship"' }] },
    };
    const out = run({ projects: { p1: project('p1') }, events: {}, activity });
    expect(out.activity).toBe(activity);
  });

  it('passes a file already in the new shape through untouched', () => {
    expect(isLegacy(fixture)).toBe(false);
    expect(migrate(fixture)).toBe(fixture);
    expect(migrate(null)).toBeNull();
    expect(migrate('nope')).toBe('nope');
    expect(migrate([])).toEqual([]);
    expect(isLegacy(legacy)).toBe(true);
  });

  it('migrating twice is migrating once', () => {
    const once = migrate(legacy);
    expect(migrate(once)).toBe(once);
  });

  it('turns the legacy fixture into the current one', () => {
    const out = run(legacy);
    expect(out.projects['p-echo']?.milestones).toEqual(
      fixture.projects['p-echo'].milestones,
    );
    expect(Object.keys(out.meetings).sort()).toEqual(['e-1', 'e-3', 'e-4']);
    // The fixture renamed the General deadline; the migration prefixes it.
    expect(out.meetings['e-4']?.title).toBe('Deadline: Quarterly planning');
    expect(out.notes).toEqual(fixture.notes);
  });
});

describe('importing a legacy export', () => {
  it('parses it into the current shape', () => {
    const parsed = ExportSchema.parse(legacy);
    expect(parsed).not.toHaveProperty('events');
    expect(Object.keys(parsed.meetings).sort()).toEqual(['e-1', 'e-3', 'e-4']);
    expect(parsed.projects['p-echo']?.milestones).toEqual([
      { id: 'e-2', title: 'Base operational', date: '2026-11-14' },
    ]);
    expect(parsed.notes['n-2']).toMatchObject({
      meetingId: 'e-1',
      phase: 'pre',
    });
  });

  it('accepts a file with either events or meetings', () => {
    const parsed = ExportSchema.parse({ meetings: { a: event('a') } });
    expect(parsed.meetings.a).not.toHaveProperty('type');
    const old = ExportSchema.parse({ events: { a: event('a') } });
    expect(old.meetings).toEqual(parsed.meetings);
  });

  it('round trips: legacy import, export, import again changes nothing', () => {
    const first = merge(emptySnapshot(), ExportSchema.parse(legacy)).state;
    const exported = JSON.parse(
      JSON.stringify({ exportedAt: at, ...first }),
    ) as unknown;
    expect(exported).not.toHaveProperty('events');
    const again = ExportSchema.parse(exported);
    const second = merge(first, again);
    expect(second.state).toEqual(first);
    expect(first.meetings['e-1']).toMatchObject({ title: 'Shield review' });
    expect(first.projects['p-echo']?.milestones).toHaveLength(1);
  });
});
