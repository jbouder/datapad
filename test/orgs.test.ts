import { describe, expect, it } from 'vitest';
import {
  findOrgs,
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
      'Alderaan Internal',
      () => `new-${++n}`,
    );
    expect(plan.map((o) => [o.name, o.kind])).toEqual([
      ['Alderaan Internal', 'internal'],
      ['Rebel Alliance', 'client'],
    ]);
  });

  it('plans nothing for an empty default org', () => {
    const plan = organizePlan(
      { projects: { d: project('d', '') }, orgs: {}, settings: {} },
      '',
      () => 'never',
    );
    expect(plan).toEqual([]);
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
    expect(guessKind('Alderaan Internal')).toBe('internal');
    expect(guessKind('Internals Ltd')).toBe('client');
  });
});

describe('findOrgs', () => {
  const people = {
    p1: { id: 'p1', name: 'Mon Mothma', role: '', me: false },
  };
  const list = [
    { ...org('o1', 'Corellia'), notes: 'Shipyards, ask @{p1}' },
    { ...org('o2', 'Alderaan'), kind: 'internal' as const },
    { ...org('o3', 'Bespin'), kind: 'vendor' as const, notes: 'Gas' },
  ];
  const ids = (q: string) => findOrgs(list, q, people).map((o) => o.id);

  it('keeps every org, in order, with no words', () => {
    expect(ids('')).toEqual(['o1', 'o2', 'o3']);
  });
  it('matches the name, kind and notes, ignoring case', () => {
    expect(ids('alder')).toEqual(['o2']);
    expect(ids('VENDOR')).toEqual(['o3']);
    expect(ids('shipyards')).toEqual(['o1']);
  });
  it('reads mentions in the notes as names', () => {
    expect(ids('mothma')).toEqual(['o1']);
    expect(ids('p1')).toEqual([]);
  });
  it('needs every word', () => {
    expect(ids('bespin gas')).toEqual(['o3']);
    expect(ids('bespin shipyards')).toEqual([]);
  });
});
