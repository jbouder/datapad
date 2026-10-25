import { describe, expect, it } from 'vitest';
import {
  guessKind,
  organizePlan,
  orgByName,
  orgName,
  orgProjects,
  unorganized,
} from '#shared/orgs';
import type { Org, Project } from '#shared/types';

const at = '2026-10-01T09:00:00.000Z';

function project(id: string, org: string, orgId?: string): Project {
  return {
    id,
    name: id,
    org,
    ...(orgId ? { orgId } : {}),
    status: 'active',
    priority: 'none',
    targetDate: '',
    tags: [],
    desc: '',
    state: '',
    members: [],
    links: [],
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
}

function org(id: string, name: string): Org {
  return {
    id,
    name,
    kind: 'client',
    links: [],
    notes: '',
    contacts: [],
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
}

describe('orgs', () => {
  const projects = {
    a: project('a', 'Rebel Alliance'),
    b: project('b', 'rebel alliance '),
    c: project('c', 'Corellia', 'o-cor'),
    d: project('d', ''),
  };
  const orgs = { 'o-cor': org('o-cor', 'Corellia') };

  it('plans one org per distinct name with none yet, the default org too', () => {
    let n = 0;
    const plan = organizePlan(
      { projects, orgs, settings: {} },
      'OpenTeams Internal',
      () => `new-${++n}`,
    );
    expect(plan.map((o) => [o.name, o.kind])).toEqual([
      ['OpenTeams Internal', 'internal'],
      ['Rebel Alliance', 'client'],
    ]);
  });

  it('counts projects whose org is text only', () => {
    expect(unorganized({ projects, orgs })).toBe(2);
    expect(unorganized({ projects, orgs: {} })).toBe(3);
  });

  it('finds orgs by name in any case, and names a project’s org', () => {
    expect(orgByName(orgs, ' corellia')?.id).toBe('o-cor');
    expect(orgByName(orgs, '')).toBeUndefined();
    expect(orgName(project('x', 'Old', 'o-cor'), orgs)).toBe('Corellia');
    expect(orgName(project('x', 'Old', 'gone'), orgs)).toBe('Old');
  });

  it('groups projects by org: linked, or matching by name', () => {
    const map = orgProjects({ ...projects, e: project('e', 'CORELLIA') }, orgs);
    expect(map.get('o-cor')?.map((p) => p.id)).toEqual(['c', 'e']);
  });

  it('guesses internal teams from the name', () => {
    expect(guessKind('OpenTeams Internal')).toBe('internal');
    expect(guessKind('Internals Ltd')).toBe('client');
  });
});
