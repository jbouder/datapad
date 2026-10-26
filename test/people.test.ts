import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { byName, planInlineAdd } from '#shared/people';

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
