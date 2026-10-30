import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { byName, findPeople, planInlineAdd } from '#shared/people';

const people = {
  a: { id: 'a', name: 'Leia Organa' },
  b: { id: 'b', name: 'Han Solo' },
};

describe('byName', () => {
  it('matches ignoring case and outer spaces', () => {
    expect(byName(people, '  leia ORGANA ')?.id).toBe('a');
  });
  it('finds nothing for a blank or unknown name', () => {
    expect(byName(people, '   ')).toBeUndefined();
    expect(byName(people, 'Lando')).toBeUndefined();
  });
});

describe('planInlineAdd', () => {
  it('does nothing for a blank name', () => {
    expect(planInlineAdd(people, '  ')).toEqual({ kind: 'empty' });
  });
  it('picks the existing record rather than making a duplicate', () => {
    expect(planInlineAdd(people, 'han solo')).toEqual({
      kind: 'existing',
      id: 'b',
      name: 'Han Solo',
    });
  });
  it('creates a new, trimmed name', () => {
    expect(planInlineAdd(people, '  Lando Calrissian ')).toEqual({
      kind: 'new',
      name: 'Lando Calrissian',
    });
  });
  it('refuses a name past the limit', () => {
    expect(planInlineAdd(people, 'x'.repeat(LIMITS.nameMax))).toEqual({
      kind: 'new',
      name: 'x'.repeat(LIMITS.nameMax),
    });
    expect(planInlineAdd(people, 'x'.repeat(LIMITS.nameMax + 1))).toEqual({
      kind: 'tooLong',
    });
  });
});

describe('findPeople', () => {
  const list = [
    { id: 'a', name: 'Leia Organa', role: 'Director' },
    { id: 'b', name: 'Han Solo', role: 'Pilot' },
    { id: 'c', name: 'Lando Calrissian', role: '' },
  ];
  const orgs = {
    o1: { name: 'Cloud City', contacts: ['c'] },
    o2: { name: 'Rebel Fleet', contacts: ['a', 'b'] },
  };
  const ids = (q: string) => findPeople(list, q, orgs).map((p) => p.id);

  it('keeps everyone, in order, with no words', () => {
    expect(ids('')).toEqual(['a', 'b', 'c']);
    expect(ids('   ')).toEqual(['a', 'b', 'c']);
  });
  it('matches the name and the role, ignoring case', () => {
    expect(ids('LEIA')).toEqual(['a']);
    expect(ids('pilot')).toEqual(['b']);
  });
  it('matches the orgs that list them as a contact', () => {
    expect(ids('cloud')).toEqual(['c']);
    expect(ids('rebel')).toEqual(['a', 'b']);
  });
  it('needs every word, across fields', () => {
    expect(ids('rebel pilot')).toEqual(['b']);
    expect(ids('han director')).toEqual([]);
  });
});
