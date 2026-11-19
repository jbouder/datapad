import { describe, expect, it } from 'vitest';
import {
  addNotepads,
  NOTEPAD_BODY,
  notepadId,
  notepadNote,
} from '#shared/notepad';
import { reduce } from '#shared/reducer';
import { emptySnapshot, type Note, type Project } from '#shared/types';

const NOW = '2026-11-19T12:00:00.000Z';

describe('the project Notepad', () => {
  it('comes with every new project, pinned and silent', () => {
    const { state } = reduce(
      emptySnapshot(),
      { type: 'createProject', id: 'p1', name: 'Echo Base' },
      NOW,
    );
    expect(state.notes[notepadId('p1')]).toEqual({
      id: 'p1-notepad',
      projectId: 'p1',
      body: NOTEPAD_BODY,
      pinned: true,
      meetingId: null,
      phase: null,
      taskId: null,
      createdAt: NOW,
    });
    // Activity says the project was created, nothing about a note.
    expect(state.activity.p1?.events.map((e) => e.text)).toEqual([
      'Created project',
    ]);
  });

  it('is an ordinary note once made: deleted, it stays deleted', () => {
    let { state } = reduce(
      emptySnapshot(),
      { type: 'createProject', id: 'p1', name: 'Echo Base' },
      NOW,
    );
    ({ state } = reduce(state, { type: 'deleteNote', id: 'p1-notepad' }, NOW));
    expect(state.notes['p1-notepad']).toBeUndefined();
    // Later changes to the project do not bring it back.
    ({ state } = reduce(
      state,
      { type: 'editProject', id: 'p1', patch: { name: 'Hoth' } },
      NOW,
    ));
    expect(state.notes['p1-notepad']).toBeUndefined();
  });

  it('keeps its id within the limit for a long project id', () => {
    const id = notepadId('x'.repeat(64));
    expect(id.length).toBe(64);
    expect(id.endsWith('-notepad')).toBe(true);
  });

  it('is added once, at schema 6, to every project without one', () => {
    const project = (id: string, archived = false) =>
      ({
        id,
        name: id,
        archived,
        createdAt: '2026-01-02T00:00:00.000Z',
      }) as Project;
    const edited: Note = {
      ...notepadNote('p2', '2026-01-03T00:00:00.000Z'),
      body: '# Notepad\nKeep this',
    };
    const out = addNotepads({
      projects: {
        p1: project('p1'),
        p2: project('p2'),
        p3: project('p3', true),
      },
      notes: { [edited.id]: edited },
    }) as { notes: Record<string, Note> };
    expect(Object.keys(out.notes).sort()).toEqual([
      'p1-notepad',
      'p2-notepad',
      'p3-notepad',
    ]);
    // Dated with its project, so it is the first pin.
    expect(out.notes['p1-notepad']?.createdAt).toBe('2026-01-02T00:00:00.000Z');
    // One that is there already is left as it is.
    expect(out.notes['p2-notepad']).toBe(edited);
    expect(addNotepads({})).toEqual({ notes: {} });
  });
});
