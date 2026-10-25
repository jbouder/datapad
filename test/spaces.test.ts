import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { nextPosition, orderedSpaces, validSpaceName } from '#shared/spaces';
import { MAIN_SPACE, type SpaceInfo } from '#shared/types';
import { documentTitle, keyFor, routeAfterSwitch } from '../src/lib/spaces';

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
