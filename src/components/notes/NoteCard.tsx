import {
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import type { Note, Snapshot } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { NoteComposer } from '@/components/NoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

const PHASE = { pre: 'Prep', post: 'Debrief' } as const;

/**
 * One note: where it belongs (project or General, and its event), when,
 * the rendered body (checkboxes save the note), and Edit, Pin, Delete.
 * Long notes clamp at 12 lines behind "Show more". Edit swaps the body
 * for the composer, with mentions as names.
 */
export function NoteCard({
  note,
  state,
  showProject = true,
  when = 'time',
  highlight,
  className,
  style,
}: {
  note: Note;
  state: Snapshot;
  showProject?: boolean;
  /** `time` under a day heading; `day` where there is none. */
  when?: 'time' | 'day';
  highlight?: string[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const { actions } = useDatapad();
  const { removeNote } = useNotes();
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const editId = useId();

  // "Show more" only when the clamp hides something.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () =>
      setOverflows(el.scrollHeight > el.clientHeight + 1 || expanded);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [note.body, expanded, editing]);

  const project = note.projectId ? state.projects[note.projectId] : null;
  const event = note.eventId ? state.events[note.eventId] : null;
  const time = new Date(note.createdAt);
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  const save = () => {
    if (editing === null) return;
    const text = namesToTokens(editing, state.people).trim();
    if (!text) return;
    if (actions.editNote({ id: note.id, body: text }) !== false) {
      setEditing(null);
    }
  };

  return (
    <article
      data-flip-id={note.id}
      data-note-id={note.id}
      aria-label={`Note, ${formatTimestamp(note.createdAt)}`}
      className={cn('enter flex flex-col gap-2 border bg-card p-3', className)}
      style={style}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {showProject &&
          (project ? (
            <a
              {...linkProps({ name: 'project', id: project.id })}
              className="border px-1.5 py-0.5 text-foreground hover:bg-accent"
            >
              {project.name}
            </a>
          ) : (
            <span className="border border-dashed px-1.5 py-0.5">General</span>
          ))}
        {event && note.phase && (
          <span className="bg-accent px-1.5 py-0.5 text-accent-foreground">
            {PHASE[note.phase]} · {event.title}
          </span>
        )}
        <time dateTime={note.createdAt} title={formatTimestamp(note.createdAt)}>
          {when === 'time' ? hhmm : relativeTime(note.createdAt, new Date())}
        </time>
        {note.editedAt && (
          <span title={formatTimestamp(note.editedAt)}>· edited</span>
        )}
        {note.pinned && (
          <span className="ml-auto inline-flex items-center gap-1 text-foreground">
            <PushPinIcon weight="fill" aria-hidden />
            Pinned
          </span>
        )}
      </header>

      {editing !== null ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: Esc cancels the edit; the controls inside are the interactive part
        <div
          className="flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(null);
            }
          }}
        >
          <NoteComposer
            id={editId}
            label="Edit note"
            value={editing}
            onChange={setEditing}
            people={state.people}
            onSubmit={save}
            autoFocus
            rows={4}
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              className="press h-11 desk:h-7"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              className="press h-11 desk:h-7"
              disabled={!editing.trim()}
              onClick={save}
            >
              Save note
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={body}
            id={bodyId}
            className={cn(!expanded && 'note-clamp')}
            data-overflows={(overflows && !expanded) || undefined}
          >
            <Markdown
              text={note.body}
              people={state.people}
              highlight={highlight}
              onToggle={(line) =>
                actions.editNote({
                  id: note.id,
                  body: toggleCheck(note.body, line),
                })
              }
            />
          </div>
          {overflows && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((x) => !x)}
              className="self-start text-xs underline underline-offset-4 hover:text-foreground min-h-11 desk:min-h-0"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}

      {editing === null && (
        <footer className="-mx-1.5 -mb-1.5 flex flex-wrap gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Edit note"
            onClick={() => setEditing(tokensToNames(note.body, state.people))}
          >
            <PencilSimpleIcon />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            onClick={() =>
              actions.pinNote({ id: note.id, pinned: !note.pinned })
            }
          >
            {note.pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
            {note.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Delete note"
            onClick={() => removeNote(note)}
          >
            <TrashIcon />
            Delete
          </Button>
        </footer>
      )}
    </article>
  );
}
