import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_FILTERS,
  groupByDay,
  notePreview,
  projectNotes,
  queryWords,
  selectNotes,
  taskTitleFrom,
} from '#shared/notes';
import { emptySnapshot, type Note, type Project } from '#shared/types';

function note(id: string, patch: Partial<Note>): Note {
  return {
    id,
    projectId: null,
    body: id,
    pinned: false,
    meetingId: null,
    phase: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...patch,
  };
}

const state = emptySnapshot();
state.projects.live = { id: 'live', archived: false } as Project;
state.projects.old = { id: 'old', archived: true } as Project;
state.people.leia = { id: 'leia', name: 'Leia Organa', role: '', me: true };
state.notes = {
  a: note('a', {
    projectId: 'live',
    body: 'Shield **review**',
    createdAt: '2026-10-21T09:00:00.000Z',
  }),
  b: note('b', {
    projectId: 'live',
    pinned: true,
    body: 'Ask @{leia}',
    createdAt: '2026-10-20T09:00:00.000Z',
  }),
  c: note('c', {
    body: 'General thoughts',
    createdAt: '2026-10-21T12:00:00.000Z',
  }),
  d: note('d', {
    projectId: 'old',
    body: 'Yavin',
    createdAt: '2026-10-22T12:00:00.000Z',
  }),
};

const ids = (notes: Note[]) => notes.map((n) => n.id);

describe('selectNotes', () => {
  it('newest first, archived projects left out', () => {
    expect(ids(selectNotes(state, DEFAULT_NOTE_FILTERS))).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('filters by project, General, and an archived project by name', () => {
    const f = DEFAULT_NOTE_FILTERS;
    expect(ids(selectNotes(state, { ...f, project: 'live' }))).toEqual([
      'a',
      'b',
    ]);
    expect(ids(selectNotes(state, { ...f, project: 'general' }))).toEqual([
      'c',
    ]);
    expect(ids(selectNotes(state, { ...f, project: 'old' }))).toEqual(['d']);
  });

  it('pinned only, and hidden notes', () => {
    const f = DEFAULT_NOTE_FILTERS;
    expect(ids(selectNotes(state, { ...f, pinned: true }))).toEqual(['b']);
    expect(ids(selectNotes(state, f, new Set(['c'])))).toEqual(['a', 'b']);
  });

  it('matches text with mentions read as names, every word', () => {
    const f = DEFAULT_NOTE_FILTERS;
    expect(ids(selectNotes(state, { ...f, q: 'organa' }))).toEqual(['b']);
    expect(ids(selectNotes(state, { ...f, q: 'ask LEIA' }))).toEqual(['b']);
    expect(ids(selectNotes(state, { ...f, q: 'shield nope' }))).toEqual([]);
    expect(ids(selectNotes(state, { ...f, q: '{leia}' }))).toEqual([]);
  });

  it('splits the query into words', () => {
    expect(queryWords('  Shield   Review ')).toEqual(['shield', 'review']);
  });
});

describe('groupByDay and projectNotes', () => {
  it('groups by local day, keeping order', () => {
    const days = groupByDay(selectNotes(state, DEFAULT_NOTE_FILTERS));
    expect(days.map((d) => ids(d.notes))).toEqual([['c', 'a'], ['b']]);
  });

  it('puts a project’s pinned notes first', () => {
    expect(ids(projectNotes(state.notes, 'live'))).toEqual(['b', 'a']);
    expect(ids(projectNotes(state.notes, null))).toEqual(['c']);
    expect(ids(projectNotes(state.notes, 'live', new Set(['b'])))).toEqual([
      'a',
    ]);
  });
});

describe('taskTitleFrom', () => {
  it('takes the first line, without markup, names for mentions', () => {
    expect(taskTitleFrom('\n- [ ] **Call** @{leia}\nmore', state.people)).toBe(
      'Call @Leia Organa',
    );
    expect(taskTitleFrom('## See [the doc](https://x.y)', state.people)).toBe(
      'See the doc',
    );
    expect(taskTitleFrom('x'.repeat(300), state.people)).toHaveLength(200);
    expect(taskTitleFrom('  \n ', state.people)).toBe('');
  });
});

describe('notePreview', () => {
  const people = state.people;
  it('strips Markdown and reads mentions as names', () => {
    expect(
      notePreview(
        'Ask **@{leia}** about _the_ ~~old~~ `plan`, [doc](https://x.y)',
        people,
      ),
    ).toBe('Ask @Leia Organa about the old plan, doc');
    expect(notePreview('Hi @{gone}', people)).toBe('Hi @unknown');
  });

  it('keeps headings as their text and drops empty lines and dividers', () => {
    expect(notePreview('## Standup\n\n\n---\n\nAll  good', people)).toBe(
      'Standup\nAll good',
    );
    expect(notePreview('  \n\n ', people)).toBe('');
  });

  it('marks list items and checkboxes', () => {
    expect(
      notePreview('- one\n- [ ] two\n- [x] three\n3. four\n> quoted', people),
    ).toBe('• one\n☐ two\n☑ three\n3. four\nquoted');
  });

  it('takes code as it is and stops after six lines', () => {
    expect(notePreview('```ts\nconst a = 1;\n```', people)).toBe(
      'const a = 1;',
    );
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    expect(notePreview(many, people).split('\n')).toHaveLength(6);
  });
});
