import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { taskTitleFrom } from '#shared/notes';
import { notesOfMeeting } from '#shared/select';
import type { Meeting, Snapshot } from '#shared/types';
import { useNotes } from '@/components/notes/NotesProvider';
import { noteLocation } from '@/components/notes/useMakeTask';
import { linkProps } from '@/lib/router';

/** Shown before "Show all". */
const SHOWN = 3;

/**
 * The notes linked to a meeting, under its row: one list, newest first,
 * each with its first line, when, and Edit (which goes to the note).
 * Past three, the rest wait behind "Show all".
 */
export function LinkedNotes({
  meeting,
  state,
}: {
  meeting: Meeting;
  state: Snapshot;
}) {
  const { hidden } = useNotes();
  const [all, setAll] = useState(false);
  const notes = notesOfMeeting(state.notes, meeting.id).filter(
    (n) => !hidden.has(n.id),
  );
  if (notes.length === 0) return null;
  const shown = all ? notes : notes.slice(0, SHOWN);
  const now = new Date();

  return (
    <div className="flex flex-col gap-1.5 pb-2 @xl/row:pl-43">
      <ul aria-label={`Notes for “${meeting.title}”`} className="flex flex-col">
        {shown.map((n) => {
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
                  note from {formatTimestamp(n.createdAt)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
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
