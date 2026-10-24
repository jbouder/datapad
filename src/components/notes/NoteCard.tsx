import {
  CheckSquareOffsetIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { taskTitleFrom } from '#shared/notes';
import type { Note, Snapshot } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { NoteComposer } from '@/components/NoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { useMakeTask } from '@/components/notes/useMakeTask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';

const PHASE = { pre: 'Prep', post: 'Debrief' } as const;

/**
 * One note: where it belongs (project or General, and its event), when,
 * the rendered body (checkboxes save the note), and Edit, Pin, Delete.
 * Long notes clamp at 12 lines behind "Show more". Edit swaps the body
 * for the composer, with mentions as names.
 *
 * Make task: select text in the body (mouse, touch or Shift+arrows) and
 * a Make task button appears by it; or use the footer's, which asks for
 * the title starting from the first line. `?note=<id>` in the URL scrolls
 * to the card and highlights it (the task panel's "From note" link).
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
  const card = useRef<HTMLElement>(null);
  const makeTask = useMakeTask();
  const [asking, setAsking] = useState<string | null>(null);
  const [picked, setPicked] = useState<{
    title: string;
    top: number;
    left: number;
  } | null>(null);
  const target = useQuery().get('note');
  const [flash, setFlash] = useState(false);

  // Arriving from a task's "From note": bring the card into view.
  useEffect(() => {
    if (target !== note.id || !card.current) return;
    card.current.scrollIntoView({ block: 'center' });
    card.current.focus({ preventScroll: true });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [target, note.id]);

  // A selection inside the body offers Make task beside it.
  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      const el = body.current;
      const box = card.current;
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !el ||
        !box
      ) {
        setPicked(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        setPicked(null);
        return;
      }
      const title = taskTitleFrom(selection.toString(), {});
      if (!title) {
        setPicked(null);
        return;
      }
      const r = range.getBoundingClientRect();
      const c = box.getBoundingClientRect();
      // Below the selection on touch, where the system's own menu is above.
      const below = window.matchMedia('(hover: none)').matches;
      setPicked({
        title,
        top: below ? r.bottom - c.top + 8 : r.top - c.top - 44,
        left: Math.min(
          Math.max(r.left - c.left + r.width / 2, 64),
          c.width - 64,
        ),
      });
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.getSelection()?.removeAllRanges();
        setPicked(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  const fromSelection = () => {
    if (!picked) return;
    if (makeTask(note, picked.title)) {
      document.getSelection()?.removeAllRanges();
      setPicked(null);
    }
  };

  const ask = () => {
    if (asking === null) return;
    if (makeTask(note, asking)) setAsking(null);
  };
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
      ref={card}
      tabIndex={-1}
      data-highlighted={flash || undefined}
      data-flip-id={note.id}
      data-note-id={note.id}
      aria-label={`Note, ${formatTimestamp(note.createdAt)}`}
      className={cn(
        'enter note-card relative flex flex-col gap-2 border bg-card p-3 outline-none',
        className,
      )}
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
            onTask={(title) => makeTask(note, title)}
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

      {picked && editing === null && (
        <Button
          size="sm"
          className="press absolute z-10 h-11 -translate-x-1/2 shadow-md desk:h-8"
          style={{ top: picked.top, left: picked.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={fromSelection}
          aria-label={`Make task “${picked.title}”`}
        >
          <CheckSquareOffsetIcon />
          Make task
        </Button>
      )}

      {editing === null && asking !== null && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor={`${bodyId}-task`} className="text-xs font-medium">
              Task title
            </label>
            <Input
              id={`${bodyId}-task`}
              value={asking}
              maxLength={200}
              autoFocus
              onChange={(e) => setAsking(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAsking(null);
                }
              }}
              className="h-11 text-base desk:h-8 desk:text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="press h-11 desk:h-8"
            onClick={() => setAsking(null)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="press h-11 desk:h-8"
            disabled={!asking.trim()}
          >
            Make task
          </Button>
        </form>
      )}

      {editing === null && asking === null && (
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
            aria-label="Make task from note"
            onClick={() => setAsking(taskTitleFrom(note.body, state.people))}
          >
            <CheckSquareOffsetIcon />
            Make task
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
