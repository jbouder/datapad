import { ArrowRightIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { describeDay, localDate } from '#shared/dates';
import { groupByDay, matchBeyondPreview, notePreview } from '#shared/notes';
import type { Note, Snapshot } from '#shared/types';
import { marked } from '@/components/Markdown';
import { NoteRow } from '@/components/notes/NoteRow';
import { linkProps } from '@/lib/router';

/**
 * Notes' List layout (#218, #274): the compact note row (`NoteRow`, as on
 * a project's page) under day headings, newest first, each with its
 * project (or General), meeting or task, opening in place. When Find matches a
 * note past what its closed row shows, that row opens, so the match is in
 * sight. The Notepad comes first, dated by its last edit, and opens its
 * page (#261).
 */
export function NoteList({
  notes,
  state,
  today,
  highlight,
}: {
  notes: Note[];
  state: Snapshot;
  today: string;
  highlight: string[];
}) {
  const pad = notes.find((n) => n.scratch);
  const days = useMemo(
    () => groupByDay(notes.filter((n) => !n.scratch)),
    [notes],
  );
  return (
    <div className="flex flex-col gap-6">
      {pad && (
        <NotepadRow
          note={pad}
          state={state}
          today={today}
          highlight={highlight}
        />
      )}
      {days.map((d) => (
        <div key={d.day} className="flex flex-col gap-2">
          <h2
            id={`notes-day-${d.day}`}
            className="text-xs font-medium text-muted-foreground"
          >
            {describeDay(d.day, today)}
          </h2>
          <ul
            aria-labelledby={`notes-day-${d.day}`}
            className="flex flex-col gap-2"
          >
            {d.notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                state={state}
                chips={{ project: true, meeting: true, task: true }}
                when="time"
                highlight={highlight}
                reveal={matchBeyondPreview(n.body, state.people, highlight)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The Notepad's row: its last edit and first lines, linking to its page. */
function NotepadRow({
  note,
  state,
  today,
  highlight,
}: {
  note: Note;
  state: Snapshot;
  today: string;
  highlight: string[];
}) {
  const stamp = note.editedAt ?? note.createdAt;
  return (
    <ul aria-label="Notepad">
      <li
        data-note-id={note.id}
        data-flip-id={note.id}
        className="border bg-card"
      >
        <a
          {...linkProps({ name: 'notepad' })}
          className="press flex min-w-0 flex-col gap-1 px-3 py-2 outline-ring/50 hover:bg-accent/40 focus-visible:outline-2"
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowRightIcon aria-hidden className="shrink-0" />
            <span className="font-medium text-foreground">Notepad</span>
            <time dateTime={stamp}>
              <span className="sr-only">, </span>
              {describeDay(localDate(new Date(stamp)), today)}
            </time>
          </span>
          <span className="line-clamp-2 text-sm whitespace-pre-line break-words">
            {marked(
              notePreview(note.body, state.people),
              highlight.length ? highlight : undefined,
            )}
          </span>
        </a>
      </li>
    </ul>
  );
}
