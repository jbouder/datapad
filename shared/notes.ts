import { localDate } from './dates';
import { tokensToNames } from './mentions';
import type { DateString, Note, Snapshot } from './types';

/**
 * The Notes view's selection: which notes, in what order, under which day.
 * Pure; the page memoizes it on the snapshot and the filters.
 */

export interface NoteFilters {
  /** `''` every project, `general` General only, or a project id. */
  project: string;
  pinned: boolean;
  /** Matches the body with mentions read as names; every word must. */
  q: string;
}

export const DEFAULT_NOTE_FILTERS: NoteFilters = {
  project: '',
  pinned: false,
  q: '',
};

/** The words of a filter, lower-cased, for matching and highlighting. */
export function queryWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Notes for the Notes view, newest first. Notes of archived projects are
 * left out unless that project is the filter; `hidden` are notes on
 * their way out (a delete waiting on Undo).
 */
export function selectNotes(
  state: Pick<Snapshot, 'notes' | 'projects' | 'people'>,
  filters: NoteFilters,
  hidden: ReadonlySet<string> = new Set(),
): Note[] {
  const words = queryWords(filters.q);
  return Object.values(state.notes)
    .filter((n) => {
      if (hidden.has(n.id)) return false;
      if (filters.project === 'general') {
        if (n.projectId !== null) return false;
      } else if (filters.project) {
        if (n.projectId !== filters.project) return false;
      } else if (n.projectId && state.projects[n.projectId]?.archived) {
        return false;
      }
      if (filters.pinned && !n.pinned) return false;
      if (words.length > 0) {
        const text = tokensToNames(n.body, state.people).toLowerCase();
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface NoteDay {
  day: DateString;
  notes: Note[];
}

/** Notes (already newest first) under their local day. */
export function groupByDay(notes: Note[]): NoteDay[] {
  const days: NoteDay[] = [];
  for (const note of notes) {
    const day = localDate(new Date(note.createdAt));
    const last = days[days.length - 1];
    if (last?.day === day) last.notes.push(note);
    else days.push({ day, notes: [note] });
  }
  return days;
}

/** One project's notes (null = General): pinned first, then newest. */
export function projectNotes(
  notes: Snapshot['notes'],
  projectId: string | null,
  hidden: ReadonlySet<string> = new Set(),
): Note[] {
  return Object.values(notes)
    .filter((n) => n.projectId === projectId && !hidden.has(n.id))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

/**
 * A task title from note text: its first non-empty line without list,
 * heading or quote markers or inline marks, mentions as names, at most
 * 200 characters.
 */
export function taskTitleFrom(
  text: string,
  people: Snapshot['people'],
): string {
  const line =
    tokensToNames(text, people)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  return line
    .replace(
      /^(#{1,6}\s+|>\s?|[-*•]\s+\[[ xX]\]\s+|[-*•]\s+|\d{1,9}[.)]\s+)/,
      '',
    )
    .replace(/\*\*|~~|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .slice(0, 200);
}
