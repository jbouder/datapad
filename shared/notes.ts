import { localDate } from './dates';
import { type Inline, parseMarkdown } from './markdown';
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

/**
 * The space's Notepad (#218): its note marked `scratch`, or undefined
 * before anything is written. Should two ever be marked (an import), the
 * oldest is the Notepad.
 */
export function notepadOf(notes: Snapshot['notes']): Note | undefined {
  let found: Note | undefined;
  for (const n of Object.values(notes)) {
    if (!n.scratch) continue;
    if (
      !found ||
      n.createdAt < found.createdAt ||
      (n.createdAt === found.createdAt && n.id < found.id)
    ) {
      found = n;
    }
  }
  return found;
}

/** A note's title for a row: its first line, plain, mentions as names. */
export function noteTitle(note: Note, people: Snapshot['people']): string {
  return taskTitleFrom(note.body, people);
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

/** How many lines `notePreview()` keeps; a row shows two of them. */
const PREVIEW_LINES = 6;

function plainInline(nodes: Inline[], people: Snapshot['people']): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.v;
        case 'mention':
          return `@${people[n.id]?.name ?? 'unknown'}`;
        default:
          return plainInline(n.c, people);
      }
    })
    .join('');
}

/**
 * A note's first lines as plain text, for a compact row (#273): Markdown
 * marks stripped, mentions as `@Name`, list items kept as `•`, `1.`, `☐`
 * or `☑`, blank lines and dividers left out. Lines are joined with `\n`
 * (at most six); the row clamps them to two.
 */
export function notePreview(body: string, people: Snapshot['people']): string {
  const out: string[] = [];
  const push = (line: string) => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (clean && out.length < PREVIEW_LINES) out.push(clean);
  };
  for (const b of parseMarkdown(body)) {
    if (out.length >= PREVIEW_LINES) break;
    switch (b.t) {
      case 'h':
        push(plainInline(b.c, people));
        break;
      case 'p':
      case 'quote':
        for (const l of b.lines) push(plainInline(l, people));
        break;
      case 'ul':
        for (const item of b.items) push(`• ${plainInline(item, people)}`);
        break;
      case 'ol':
        b.items.forEach((item, i) => {
          push(`${b.start + i}. ${plainInline(item, people)}`);
        });
        break;
      case 'check':
        for (const item of b.items) {
          push(`${item.checked ? '☑' : '☐'} ${plainInline(item.c, people)}`);
        }
        break;
      case 'code':
        for (const l of b.text.split('\n')) push(l);
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}
