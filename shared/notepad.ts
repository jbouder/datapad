import { LIMITS } from './limits';
import type { Note, Project } from './types';

/**
 * Every project's Notepad: a pinned note headed "Notepad", made with the
 * project (`createProject`) and, for the projects from before it, once at
 * schema 6 (`addNotepads()`). After that it is an ordinary note: edit it,
 * unpin it or delete it, and it stays that way.
 */

export const NOTEPAD_BODY = '# Notepad';

const SUFFIX = '-notepad';

/**
 * A project's Notepad id, from the project's own: the reducer stays pure
 * and the schema 6 backfill can never make a second one.
 */
export function notepadId(projectId: string): string {
  return `${projectId.slice(0, LIMITS.idMax - SUFFIX.length)}${SUFFIX}`;
}

/** A project's Notepad, created at `createdAt`. */
export function notepadNote(projectId: string, createdAt: string): Note {
  return {
    id: notepadId(projectId),
    projectId,
    body: NOTEPAD_BODY,
    pinned: true,
    meetingId: null,
    phase: null,
    taskId: null,
    createdAt,
  };
}

/**
 * Schema 6: a Notepad for each project that has none, archived ones too,
 * dated with its project so it is the first pin. A project whose Notepad
 * id is taken (by any note) is left alone.
 */
export function addNotepads(input: unknown): unknown {
  const docs = (input ?? {}) as {
    projects?: Record<string, Project>;
    notes?: Record<string, Note>;
  };
  const notes = { ...(docs.notes ?? {}) };
  for (const project of Object.values(docs.projects ?? {})) {
    const id = notepadId(project.id);
    if (notes[id]) continue;
    notes[id] = notepadNote(project.id, project.createdAt);
  }
  return { ...docs, notes };
}
