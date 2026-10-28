import {
  CaretDownIcon,
  CaretRightIcon,
  PushPinIcon,
} from '@phosphor-icons/react';
import { describeDay, localDate } from '#shared/dates';
import { noteTitle } from '#shared/notes';
import type { Note, Snapshot } from '#shared/types';
import { NoteCard } from '@/components/notes/NoteCard';

/** Where a note belongs, as its row says it. */
function placeOf(note: Note, state: Snapshot): string {
  if (note.scratch) return 'Notepad';
  if (!note.projectId) return 'General';
  return state.projects[note.projectId]?.name ?? 'General';
}

/**
 * Notes' List layout (#218, Feed before it): one compact row per note
 * (its first line, where it belongs, its day, pinned) that opens the note
 * in place, the whole card with its actions, and closes it again. The
 * Notepad's row is dated by its last edit.
 */
export function NoteList({
  notes,
  state,
  today,
  highlight,
  open,
  onToggle,
}: {
  notes: Note[];
  state: Snapshot;
  today: string;
  highlight: string[];
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul aria-label="Notes" className="flex flex-col border-t">
      {notes.map((n) => {
        const isOpen = open.has(n.id);
        const title = noteTitle(n, state.people) || 'Untitled note';
        const stamp = n.scratch ? (n.editedAt ?? n.createdAt) : n.createdAt;
        const panel = `note-row-${n.id}`;
        return (
          <li
            key={n.id}
            data-note-row={n.id}
            data-layout-id={n.id}
            className="flex flex-col border-b"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panel : undefined}
              onClick={() => onToggle(n.id)}
              className="press flex min-h-11 w-full min-w-0 items-center gap-2 px-1 py-1.5 text-left outline-none hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring desk:min-h-9"
            >
              {isOpen ? (
                <CaretDownIcon aria-hidden className="shrink-0" />
              ) : (
                <CaretRightIcon aria-hidden className="shrink-0" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="truncate text-sm font-medium">{title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums sm:ml-auto">
                  {n.pinned && (
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <PushPinIcon weight="fill" aria-hidden />
                      <span className="sr-only">Pinned,</span>
                    </span>
                  )}
                  <span className="max-w-48 truncate">
                    <span className="sr-only">, </span>
                    {placeOf(n, state)}
                  </span>
                  <time dateTime={stamp}>
                    <span className="sr-only">, </span>
                    {describeDay(localDate(new Date(stamp)), today)}
                  </time>
                </span>
              </span>
            </button>
            {isOpen && (
              <div id={panel} className="pb-3">
                <NoteCard
                  note={n}
                  state={state}
                  highlight={highlight}
                  when="day"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
