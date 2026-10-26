import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { taskTitleFrom } from '#shared/notes';
import type { Meeting, Note, Snapshot } from '#shared/types';
import { useNotes } from '@/components/notes/NotesProvider';
import { noteLocation } from '@/components/notes/useMakeTask';
import { linkProps } from '@/lib/router';

/** Shown before "Show all". */
const SHOWN = 3;

const GROUPS = [
  { phase: 'pre', label: 'Prep' },
  { phase: 'post', label: 'Debrief' },
  { phase: null, label: 'Notes' },
] as const;

/** An event's notes: Prep, then Debrief, then the rest, oldest first. */
export function linkedNotes(
  notes: Snapshot['notes'],
  meetingId: string,
  hidden: ReadonlySet<string> = new Set(),
): Note[] {
  const rank = (n: Note) =>
    n.phase === 'pre' ? 0 : n.phase === 'post' ? 1 : 2;
  return Object.values(notes)
    .filter((n) => n.meetingId === meetingId && !hidden.has(n.id))
    .sort(
      (a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * The notes linked to an event, under its row: grouped Prep, Debrief and
 * Notes, oldest first, each with its first line, when, and Edit (which
 * goes to the note). Past three, the rest wait behind "Show all".
 */
export function LinkedNotes({
  event,
  state,
}: {
  event: Meeting;
  state: Snapshot;
}) {
  const { hidden } = useNotes();
  const [all, setAll] = useState(false);
  const notes = linkedNotes(state.notes, event.id, hidden);
  if (notes.length === 0) return null;
  const shown = all ? notes : notes.slice(0, SHOWN);
  const now = new Date();

  return (
    <div className="flex flex-col gap-1.5 pb-2 @xl/row:pl-43">
      {GROUPS.map((g) => {
        const list = shown.filter((n) => n.phase === g.phase);
        if (list.length === 0) return null;
        return (
          <section
            key={g.label}
            aria-label={`${g.label} notes for “${event.title}”`}
          >
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase">
              {g.label}
            </h4>
            <ul className="flex flex-col">
              {list.map((n) => {
                const to = noteLocation(n, state);
                return (
                  <li
                    key={n.id}
                    className="flex min-h-11 items-center gap-2 border-l pl-2 text-xs desk:min-h-7"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {taskTitleFrom(n.body, state.people) || 'Empty note'}
                    </span>
                    <time
                      dateTime={n.createdAt}
                      title={formatTimestamp(n.createdAt)}
                      className="shrink-0 text-muted-foreground"
                    >
                      {relativeTime(n.createdAt, now)}
                    </time>
                    <a
                      {...linkProps(to.route, to.query)}
                      className="press flex min-h-11 shrink-0 items-center gap-1 px-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline desk:min-h-7"
                    >
                      <PencilSimpleIcon aria-hidden />
                      Edit
                      <span className="sr-only">
                        {' '}
                        {g.label.toLowerCase()} note from{' '}
                        {formatTimestamp(n.createdAt)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {notes.length > SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="press flex min-h-11 items-center self-start px-1 text-xs font-medium underline-offset-4 hover:underline desk:min-h-7"
        >
          {all ? 'Show fewer' : `Show all ${notes.length}`}
        </button>
      )}
    </div>
  );
}
