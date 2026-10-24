import { describe, expect, it } from 'vitest';
import {
  mentionedIds,
  mentionMatches,
  mentionQuery,
  mentionSnippet,
  namesToTokens,
  tokensToNames,
} from '#shared/mentions';
import type { Person } from '#shared/types';

const people: Record<string, Person> = {
  han: { id: 'han', name: 'Han', role: '', me: false },
  hans: { id: 'hans', name: 'Han Solo', role: 'Captain', me: false },
  leia: { id: 'leia', name: 'Leia Organa', role: 'General', me: true },
  chewie: { id: 'chewie', name: 'Chewbacca', role: '', me: false },
};

describe('mention tokens', () => {
  it('shows tokens as names, and gone people as @unknown', () => {
    expect(tokensToNames('Ask @{hans} and @{gone}.', people)).toBe(
      'Ask @Han Solo and @unknown.',
    );
  });

  it('stores names as tokens, longest first, at word ends only', () => {
    expect(namesToTokens('@Han Solo, then @Han, not @Hannah', people)).toBe(
      '@{hans}, then @{han}, not @Hannah',
    );
    expect(namesToTokens('cc @Leia Organa.', people)).toBe('cc @{leia}.');
    expect(namesToTokens('email@Chewbacca', people)).toBe('email@{chewie}');
  });

  it('round-trips, and renaming a person renames the mention', () => {
    const stored = namesToTokens('Hi @Leia Organa', people);
    expect(tokensToNames(stored, people)).toBe('Hi @Leia Organa');
    const renamed = {
      ...people,
      leia: { ...people.leia, name: 'Leia' },
    } as Record<string, Person>;
    expect(tokensToNames(stored, renamed)).toBe('Hi @Leia');
  });

  it('lists the ids mentioned, once each', () => {
    expect(mentionedIds('@{a} @{b} @{a}')).toEqual(['a', 'b']);
  });
});

describe('typing a mention', () => {
  it('finds the query at the caret', () => {
    expect(mentionQuery('Ask @Le', 7)).toEqual({ start: 4, query: 'Le' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('Ask @Han So', 11)).toEqual({
      start: 4,
      query: 'Han So',
    });
    expect(mentionQuery('email@x', 7)).toBeNull();
    expect(mentionQuery('no mention', 10)).toBeNull();
    expect(mentionQuery(`@${'a'.repeat(31)}`, 32)).toBeNull();
  });

  it('matches people whose names start with it, eight at most', () => {
    expect(mentionMatches(people, 'han').map((p) => p.id)).toEqual([
      'han',
      'hans',
    ]);
    expect(mentionMatches(people, '').length).toBe(4);
    expect(mentionMatches(people, 'zz')).toEqual([]);
  });
});

describe('mentionSnippet', () => {
  const people = {
    u1: { id: 'u1', name: 'Leia Organa', role: '', me: false },
    u2: { id: 'u2', name: 'Han Solo', role: '', me: false },
  };

  it('expands mentions and drops Markdown marks', () => {
    expect(
      mentionSnippet('## Sync\n- ask **@{u1}** about @{u2}', 'u1', people),
    ).toBe('Sync ask @Leia Organa about @Han Solo');
  });

  it('cuts long text around the first mention', () => {
    const text = `${'a'.repeat(80)} @{u1} ${'b'.repeat(200)}`;
    const snippet = mentionSnippet(text, 'u1', people, 10, 30);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet).toContain('@Leia Organa');
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(1 + 10 + 30 + 1);
  });

  it('reads @unknown for people who are gone', () => {
    expect(mentionSnippet('cc @{u9} and @{u1}', 'u1', people)).toBe(
      'cc @unknown and @Leia Organa',
    );
  });
});
