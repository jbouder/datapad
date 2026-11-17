import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { isLegacy, migrate, migrateFormat3 } from '#shared/migrate';
import { ExportSchema } from '#shared/protocol';
import { merge } from '#shared/reducer';
import { EXPORT_FORMAT, emptySnapshot } from '#shared/types';
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

describe('migrateFormat3 (#328)', () => {
  const later = '2026-10-05T09:00:00.000Z';

  function task(id: string, patch: Record<string, unknown> = {}) {
    return {
      id,
      title: id,
      projectId: 'p1',
      status: 'open',
      tags: ['decide'],
      createdAt: at,
      updatedAt: at,
      ...patch,
    };
  }

  function item(id: string, text: string, done: boolean) {
    return { id, text, done, createdAt: at, doneAt: done ? later : null };
  }

  function list(id: string, patch: Record<string, unknown> = {}) {
    return {
      id,
      projectId: 'p1',
      title: 'Offsite',
      items: [
        item('i1', 'Venue', true),
        item('i2', 'Agenda', false),
        item('i3', 'Dinner', true),
      ],
      createdAt: at,
      updatedAt: later,
      ...patch,
    };
  }

  type Out3 = {
    tasks: Record<string, Record<string, unknown>>;
    notes: Record<string, Record<string, unknown>>;
    lists: Record<string, unknown>;
  };
  const run3 = (input: unknown) => migrateFormat3(input) as Out3;

  it('marks open decide-tagged tasks to decide, keeping the tag', () => {
    const out = run3({
      tasks: {
        a: task('a'),
        b: task('b', { tags: ['Decide', 'ops'] }),
        c: task('c', { status: 'done' }),
        d: task('d', { tags: ['ops'] }),
      },
    });
    expect(out.tasks.a).toEqual({ ...task('a'), decide: true });
    expect(out.tasks.b).toMatchObject({
      decide: true,
      tags: ['Decide', 'ops'],
    });
    expect(out.tasks.c).not.toHaveProperty('decide');
    expect(out.tasks.d).not.toHaveProperty('decide');
  });

  it('turns each list into a checklist note: order, done state, project and times', () => {
    const out = run3({
      lists: { l1: list('l1'), l2: list('l2', { projectId: null, items: [] }) },
    });
    expect(out.notes.l1).toEqual({
      id: 'l1',
      projectId: 'p1',
      body: '## Offsite\n- [x] Venue\n- [ ] Agenda\n- [x] Dinner',
      pinned: false,
      meetingId: null,
      phase: null,
      createdAt: at,
      editedAt: later,
    });
    expect(out.notes.l2).toMatchObject({ projectId: null, body: '## Offsite' });
    // The lists are kept.
    expect(Object.keys(out.lists)).toEqual(['l1', 'l2']);
  });

  it('follows the order of the items as stored, and folds stray newlines', () => {
    const out = run3({
      lists: [
        list('l1', {
          title: 'Two\nlines',
          items: [item('b', 'Second', false), item('a', 'First\nhalf', true)],
        }),
      ],
      notes: [],
    }) as unknown as { notes: Array<{ id: string; body: string }> };
    expect(out.notes).toEqual([
      expect.objectContaining({
        id: 'l1',
        body: '## Two lines\n- [ ] Second\n- [x] First half',
      }),
    ]);
  });

  it('splits a list too long for one note, under the same heading', () => {
    const long = 'x'.repeat(LIMITS.titleMax);
    const items = Array.from({ length: LIMITS.listItemsMax }, (_, i) =>
      item(`i${i}`, long, false),
    );
    const out = run3({ lists: { l1: list('l1', { items }) } });
    const parts = Object.values(out.notes);
    expect(parts.map((n) => n.id)).toEqual(['l1', 'l1-2', 'l1-3']);
    const bodies = parts.map((n) => String(n.body));
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(LIMITS.bodyMax);
      expect(body.startsWith('## Offsite\n')).toBe(true);
    }
    const lines = bodies.flatMap((b) => b.split('\n').slice(1));
    expect(lines).toHaveLength(LIMITS.listItemsMax);
    // And every part imports.
    expect(() =>
      ExportSchema.parse({ format: EXPORT_FORMAT, notes: out.notes }),
    ).not.toThrow();
  });

  it('makes the Notepad an ordinary General note', () => {
    const pad = {
      id: 'pad',
      projectId: null,
      body: 'Scratch',
      pinned: false,
      meetingId: null,
      phase: null,
      scratch: true,
      createdAt: at,
    };
    const out = run3({ notes: { pad } });
    const { scratch: _, ...ordinary } = pad;
    expect(out.notes.pad).toEqual(ordinary);
  });

  it('changes nothing the second time, or on a file already in shape', () => {
    const input = {
      tasks: { a: task('a') },
      notes: {
        pad: {
          id: 'pad',
          projectId: null,
          body: 'x',
          meetingId: null,
          scratch: true,
          createdAt: at,
        },
      },
      lists: { l1: list('l1') },
    };
    const once = migrateFormat3(input);
    expect(once).not.toBe(input);
    expect(migrateFormat3(once)).toBe(once);
    const plain = { tasks: { d: task('d', { tags: [] }) } };
    expect(migrateFormat3(plain)).toBe(plain);
  });

  it('leaves a note already under a list’s id alone', () => {
    const mine = {
      id: 'l1',
      projectId: null,
      body: 'Already here',
      createdAt: at,
    };
    const out = run3({ notes: { l1: mine }, lists: { l1: list('l1') } });
    expect(out.notes.l1).toEqual(mine);
  });

  it('runs on imports of format 1, 2 and none, not 3', () => {
    const file = { tasks: { a: task('a') }, lists: { l1: list('l1') } };
    for (const format of [undefined, 1, 2]) {
      const parsed = ExportSchema.parse({ ...file, format });
      expect(parsed.tasks.a?.decide, String(format)).toBe(true);
      expect(parsed.notes.l1, String(format)).toBeDefined();
    }
    const current = ExportSchema.parse({ ...file, format: EXPORT_FORMAT });
    expect(current.tasks.a).not.toHaveProperty('decide');
    expect(current.notes).toEqual({});
  });
});
