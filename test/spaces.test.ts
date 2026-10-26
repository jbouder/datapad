import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { ExportSchema, type ParsedExport } from '#shared/protocol';
import { merge } from '#shared/reducer';
import {
  nextPosition,
  orderedSpaces,
  projectSubtree,
  removeSubtree,
  validSpaceName,
} from '#shared/spaces';
import {
  type Decision,
  emptySnapshot,
  MAIN_SPACE,
  type Person,
  type Snapshot,
  type SpaceInfo,
  type Task,
} from '#shared/types';
import { documentTitle, keyFor, routeAfterSwitch } from '../src/lib/spaces';
import fixture from './fixtures/export.json';

const at = '2026-10-01T09:00:00.000Z';
const later = '2026-10-02T09:00:00.000Z';

function space(id: string, name: string, position: number, createdAt = at) {
  return { id, name, position, createdAt } satisfies SpaceInfo;
}

const spaces = [
  space(MAIN_SPACE, 'Main', 0),
  space('s-hoth', 'Hoth', 1),
  space('s-dagobah', 'Dagobah', 2),
];

describe('validSpaceName', () => {
  it('trims a good name', () => {
    expect(validSpaceName('  Endor  ', spaces)).toEqual({
      ok: true,
      name: 'Endor',
    });
  });

  it('refuses an empty or blank name', () => {
    for (const name of ['', '   ']) {
      expect(validSpaceName(name, spaces)).toEqual({
        ok: false,
        reason: 'Give the space a name',
      });
    }
  });

  it('refuses a name over the limit, after trimming', () => {
    const max = 'x'.repeat(LIMITS.spaceNameMax);
    expect(validSpaceName(` ${max} `, spaces).ok).toBe(true);
    const result = validSpaceName(`${max}x`, spaces);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(
      `Space names are ${LIMITS.spaceNameMax} characters at most`,
    );
  });

  it('refuses another space’s name, ignoring case and spaces', () => {
    expect(validSpaceName(' hoth ', spaces)).toEqual({
      ok: false,
      reason: 'There is already a space called hoth',
    });
    expect(validSpaceName('MAIN', spaces).ok).toBe(false);
  });

  it('lets a space keep or recase its own name', () => {
    expect(validSpaceName('HOTH', spaces, 's-hoth')).toEqual({
      ok: true,
      name: 'HOTH',
    });
    expect(validSpaceName('Dagobah', spaces, 's-hoth').ok).toBe(false);
  });

  it('takes any name when there are no spaces', () => {
    expect(validSpaceName('Main', []).ok).toBe(true);
  });
});

describe('orderedSpaces', () => {
  it('orders by position, then created, then id', () => {
    const list = [
      space('s-c', 'C', 2),
      space('s-b', 'B', 1, later),
      space('s-a', 'A', 1, later),
      space('s-d', 'D', 1, at),
      space(MAIN_SPACE, 'Main', 0),
    ];
    expect(orderedSpaces(list).map((s) => s.id)).toEqual([
      MAIN_SPACE,
      's-d',
      's-a',
      's-b',
      's-c',
    ]);
  });

  it('returns a new array and leaves the input alone', () => {
    const list = [space('s-b', 'B', 1), space('s-a', 'A', 0)];
    const ordered = orderedSpaces(list);
    expect(ordered).not.toBe(list);
    expect(list.map((s) => s.id)).toEqual(['s-b', 's-a']);
  });
});

describe('nextPosition', () => {
  it('is 0 with no spaces', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('goes after the last one, even with gaps', () => {
    expect(nextPosition(spaces)).toBe(3);
    expect(nextPosition([space('s-a', 'A', 0), space('s-b', 'B', 7)])).toBe(8);
  });
});

describe('keyFor', () => {
  it('keeps the keys from before spaces for main', () => {
    expect(keyFor('datapad:snapshot', MAIN_SPACE)).toBe('datapad:snapshot');
    expect(keyFor('datapad:pending', MAIN_SPACE)).toBe('datapad:pending');
    expect(keyFor('datapad:pending-now', MAIN_SPACE)).toBe(
      'datapad:pending-now',
    );
  });

  it('appends any other space', () => {
    expect(keyFor('datapad:snapshot', 's-hoth')).toBe(
      'datapad:snapshot:s-hoth',
    );
    expect(keyFor('datapad:pending-now', 's-hoth')).toBe(
      'datapad:pending-now:s-hoth',
    );
  });
});

describe('routeAfterSwitch', () => {
  it('leaves a project, person or org for Focus', () => {
    const focus = { name: 'focus' };
    expect(routeAfterSwitch({ name: 'project', id: 'p-echo' })).toEqual(focus);
    expect(routeAfterSwitch({ name: 'people', person: 'pe-leia' })).toEqual(
      focus,
    );
    expect(routeAfterSwitch({ name: 'orgs', org: 'o-rebels' })).toEqual(focus);
  });

  it('keeps section pages', () => {
    expect(routeAfterSwitch({ name: 'tasks' })).toBeNull();
    expect(routeAfterSwitch({ name: 'people' })).toBeNull();
    expect(routeAfterSwitch({ name: 'orgs' })).toBeNull();
    expect(routeAfterSwitch({ name: 'settings', section: 'data' })).toBeNull();
    expect(routeAfterSwitch({ name: 'focus' })).toBeNull();
  });
});

describe('documentTitle', () => {
  it('names the space only when given one', () => {
    expect(documentTitle('Tasks')).toBe('Tasks · Datapad');
    expect(documentTitle('Tasks', null)).toBe('Tasks · Datapad');
    expect(documentTitle('Tasks', 'Personal')).toBe(
      'Tasks · Personal · Datapad',
    );
    expect(documentTitle()).toBe('Datapad');
    expect(documentTitle(undefined, 'Personal')).toBe('Personal · Datapad');
  });
});

/* ---------- moving a project ---------- */

const person = (id: string, name: string, me = false): Person => ({
  id,
  name,
  role: '',
  me,
});

function decision(
  id: string,
  projectId: string,
  deciders: string[],
  rationale: string,
): Decision {
  return {
    id,
    projectId,
    title: `Decision ${id}`,
    rationale,
    status: 'decided',
    decidedAt: '2026-10-01',
    deciders,
    links: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * The fixture plus what it lacks: an org with a contact, decisions, and
 * people reached only by a blocked flag, a mention or the org.
 */
function source(): Snapshot {
  const { exportedAt: _, ...docs } = ExportSchema.parse(fixture);
  const state: Snapshot = { ...emptySnapshot(), ...docs };
  return {
    ...state,
    people: {
      ...state.people,
      'u-wedge': person('u-wedge', 'Wedge Antilles'),
      'u-ackbar': person('u-ackbar', 'Gial Ackbar'),
      'u-biggs': person('u-biggs', 'Biggs Darklighter'),
      'u-lando': person('u-lando', 'Lando Calrissian'),
    },
    tasks: {
      ...state.tasks,
      't-1': {
        ...(state.tasks['t-1'] as Task),
        blocked: { on: 'u-biggs', note: 'Flight plan' },
      },
    },
    orgs: {
      'o-rebels': {
        id: 'o-rebels',
        name: 'Rebel Alliance',
        kind: 'client',
        links: [],
        notes: '',
        contacts: ['u-ackbar'],
        archived: false,
        createdAt: at,
        updatedAt: at,
      },
    },
    decisions: {
      'd-1': decision('d-1', 'p-echo', ['u-mon'], 'As @{u-wedge} argued.'),
      'd-2': decision('d-2', 'p-falcon', ['u-lando'], ''),
    },
  };
}

const arrival = { from: 'Main', at: later };

describe('projectSubtree', () => {
  it('picks the project, everything in it, and whom it refers to', () => {
    const state = source();
    const subtree = projectSubtree(state, 'p-echo', emptySnapshot(), arrival);
    if (!subtree) throw new Error('No subtree');
    expect(Object.keys(subtree.projects)).toEqual(['p-echo']);
    expect(Object.keys(subtree.tasks).sort()).toEqual([
      't-1',
      't-2',
      't-3',
      't-4',
    ]);
    expect(Object.keys(subtree.notes).sort()).toEqual(['n-1', 'n-2']);
    expect(Object.keys(subtree.meetings)).toEqual(['e-1']);
    expect(subtree.projects['p-echo']?.milestones).toEqual([
      { id: 'e-2', title: 'Base operational', date: '2026-11-14' },
    ]);
    expect(Object.keys(subtree.decisions)).toEqual(['d-1']);
    expect(Object.keys(subtree.activity)).toEqual(['p-echo']);
    expect(Object.keys(subtree.orgs)).toEqual(['o-rebels']);
    // Members (Leia, Han, Chewie), a decider (Mon), a mention only
    // (Wedge), the org's contact (Ackbar), who a task waits on (Biggs);
    // not Lando, who is only on another project.
    expect(Object.keys(subtree.people).sort()).toEqual([
      'u-ackbar',
      'u-biggs',
      'u-chewie',
      'u-han',
      'u-leia',
      'u-mon',
      'u-wedge',
    ]);
    expect(subtree.templates).toEqual({});
    expect(subtree.settings).toEqual({});
    expect(subtree.exportedAt).toBe(later);
    // Documents travel unchanged, but for the project's org link.
    expect(subtree.tasks['t-1']).toBe(state.tasks['t-1']);
    expect(subtree.projects['p-echo']).toEqual({
      ...state.projects['p-echo'],
      orgId: 'o-rebels',
      updatedAt: later,
    });
  });

  it('takes people mentioned in the description and the org’s notes', () => {
    const state = source();
    const echo = state.projects['p-echo'] as Snapshot['projects'][string];
    const rebels = state.orgs['o-rebels'] as Snapshot['orgs'][string];
    const mentioned: Snapshot = {
      ...state,
      projects: {
        ...state.projects,
        'p-echo': { ...echo, desc: '@{u-lando}' },
      },
      orgs: { 'o-rebels': { ...rebels, notes: 'Ask @{u-biggs}' } },
      tasks: {
        ...state.tasks,
        't-1': { ...(state.tasks['t-1'] as Task), blocked: null },
      },
    };
    const subtree = projectSubtree(
      mentioned,
      'p-echo',
      emptySnapshot(),
      arrival,
    );
    expect(subtree?.people['u-lando']).toBeDefined();
    expect(subtree?.people['u-biggs']).toBeDefined();
  });

  it('logs where it came from on top of its log, capped', () => {
    const state = source();
    const subtree = projectSubtree(state, 'p-echo', emptySnapshot(), arrival);
    const log = subtree?.activity['p-echo']?.events ?? [];
    expect(log[0]).toEqual({ t: later, text: 'Moved from Main' });
    expect(log.slice(1)).toEqual(state.activity['p-echo']?.events);

    const full = {
      ...state,
      activity: {
        'p-echo': {
          events: Array.from({ length: LIMITS.activityMax }, (_, i) => ({
            t: at,
            text: `Entry ${i}`,
          })),
        },
      },
    };
    const capped = projectSubtree(full, 'p-echo', emptySnapshot(), arrival);
    expect(capped?.activity['p-echo']?.events).toHaveLength(LIMITS.activityMax);
  });

  it('keeps me when the target has none, and not when it has one', () => {
    const state = source();
    const none = projectSubtree(state, 'p-echo', emptySnapshot(), arrival);
    expect(none?.people['u-leia']?.me).toBe(true);

    const target: Snapshot = {
      ...emptySnapshot(),
      people: { 'u-luke': person('u-luke', 'Luke Skywalker', true) },
    };
    const some = projectSubtree(state, 'p-echo', target, arrival);
    expect(some?.people['u-leia']).toEqual({
      ...state.people['u-leia'],
      me: false,
    });
    // The import that lands it keeps the target's me.
    const landed = merge(target, some as ParsedExport).state;
    expect(Object.values(landed.people).filter((p) => p.me)).toEqual([
      target.people['u-luke'],
    ]);

    // Moving back where the same person is already me keeps them so.
    const back: Snapshot = {
      ...emptySnapshot(),
      people: { 'u-leia': person('u-leia', 'Leia Organa', true) },
    };
    expect(
      projectSubtree(state, 'p-echo', back, arrival)?.people['u-leia']?.me,
    ).toBe(true);
  });

  it('joins an org the target has by name instead of copying it', () => {
    const state = source();
    const rebels = state.orgs['o-rebels'] as Snapshot['orgs'][string];
    const target: Snapshot = {
      ...emptySnapshot(),
      orgs: {
        'o-other': {
          ...rebels,
          id: 'o-other',
          name: 'rebel alliance',
          contacts: [],
        },
      },
    };
    const subtree = projectSubtree(state, 'p-echo', target, arrival);
    expect(subtree?.orgs).toEqual({});
    expect(subtree?.projects['p-echo']?.orgId).toBe('o-other');
    // Its contacts belong to the org left behind.
    expect(subtree?.people['u-ackbar']).toBeUndefined();
  });

  it('prefers orgId, and is null for a missing project', () => {
    const state = source();
    const falcon = state.projects['p-falcon'] as Snapshot['projects'][string];
    const linked: Snapshot = {
      ...state,
      projects: {
        ...state.projects,
        'p-falcon': { ...falcon, orgId: 'o-rebels' },
      },
    };
    const subtree = projectSubtree(
      linked,
      'p-falcon',
      emptySnapshot(),
      arrival,
    );
    expect(Object.keys(subtree?.orgs ?? {})).toEqual(['o-rebels']);
    expect(Object.keys(subtree?.decisions ?? {})).toEqual(['d-2']);
    expect(
      projectSubtree(state, 'p-gone', emptySnapshot(), arrival),
    ).toBeNull();
  });
});

describe('removeSubtree', () => {
  it('deletes only what the project took, and reports every row', () => {
    const state = source();
    const subtree = projectSubtree(
      state,
      'p-echo',
      emptySnapshot(),
      arrival,
    ) as ParsedExport;
    const { state: next, changed } = removeSubtree(state, subtree);
    expect(changed.every((c) => 'deleted' in c)).toBe(true);
    expect(changed.map((c) => `${c.col}/${c.id}`).sort()).toEqual(
      [
        'projects/p-echo',
        'tasks/t-1',
        'tasks/t-2',
        'tasks/t-3',
        'tasks/t-4',
        'notes/n-1',
        'notes/n-2',
        'meetings/e-1',
        'decisions/d-1',
        'activity/p-echo',
      ].sort(),
    );
    expect(Object.keys(next.projects).sort()).toEqual(['p-falcon', 'p-yavin']);
    expect(Object.keys(next.tasks).sort()).toEqual(['t-5', 't-6', 't-7']);
    expect(Object.keys(next.decisions)).toEqual(['d-2']);
    // People and orgs stay, untouched.
    expect(next.people).toBe(state.people);
    expect(next.orgs).toBe(state.orgs);
    // The input is left alone.
    expect(state.projects['p-echo']).toBeDefined();
    expect(Object.keys(state.tasks)).toHaveLength(7);
  });
});
