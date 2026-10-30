import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CheckSquareOffsetIcon,
  CopySimpleIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import type { Note, Snapshot } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import {
  AskTaskForm,
  NoteChips,
  NoteEditor,
  SelectionTaskButton,
  useNoteActions,
  useNoteTarget,
  useSelectionTask,
} from '@/components/notes/noteParts';
import { Button, buttonVariants } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * One note: where it belongs (project or General, and its meeting), when,
 * the rendered body (checkboxes save the note), and Edit, Pin, Make
 * task, Summarize, Save as template (a note template from it), Delete.
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
  compact = false,
  expand,
  layout = true,
  className,
  style,
}: {
  note: Note;
  state: Snapshot;
  showProject?: boolean;
  /** `time` under a day heading; `day` where there is none. */
  when?: 'time' | 'day';
  highlight?: string[];
  /** Grid: smaller text, 10 lines, no footer (expand for the rest). */
  compact?: boolean;
  /** Grid: the card opens in place, and says whether it is open. */
  expand?: { expanded: boolean; toggle: () => void };
  /**
   * The card itself, carrying its ids (`data-layout-id` so layout
   * switches move it). False for a stand-in that only holds space.
   */
  layout?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const clock = useClock();
  const { actions } = useDatapad();
  const act = useNoteActions(note, state.people);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const flash = useNoteTarget(card, note.id);
  const { picked, make: fromSelection } = useSelectionTask(note, body, card);
  const bodyId = useId();

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

  const time = new Date(note.createdAt);
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the Expand button is the keyboard way to open a compact card
    <article
      ref={card}
      tabIndex={-1}
      data-highlighted={flash || undefined}
      data-flip-id={layout ? note.id : undefined}
      data-layout-id={layout ? note.id : undefined}
      data-note-id={layout ? note.id : undefined}
      aria-label={`Note, ${formatTimestamp(note.createdAt, clock)}`}
      className={cn(
        'enter note-card relative flex flex-col gap-2 border bg-card p-3 outline-none',
        className,
      )}
      style={style}
      onClick={(e) => {
        // A click on a compact card opens it, unless it was on a control
        // or ended a text selection.
        if (!compact || !expand) return;
        const target = e.target as Element;
        if (target.closest('a, button, input, textarea, label')) return;
        if (!document.getSelection()?.isCollapsed) return;
        // The Notepad's card opens the Notepad (#261).
        if (note.scratch) navigate({ name: 'notepad' });
        else expand.toggle();
      }}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <NoteChips
          note={note}
          state={state}
          project={showProject || note.scratch}
          meeting
          task
        />
        <time
          dateTime={note.createdAt}
          title={formatTimestamp(note.createdAt, clock)}
        >
          {when === 'time' ? hhmm : relativeTime(note.createdAt, new Date())}
        </time>
        {note.editedAt && (
          <span title={formatTimestamp(note.editedAt, clock)}>· edited</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {note.pinned && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <PushPinIcon weight="fill" aria-hidden />
              <span className={cn(compact && 'sr-only')}>Pinned</span>
            </span>
          )}
          {expand && note.scratch ? (
            <a
              {...linkProps({ name: 'notepad' })}
              title="Open the Notepad"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                'press -my-1 size-11 desk:size-7',
              )}
            >
              <ArrowsOutSimpleIcon />
              <span className="sr-only">Open the Notepad</span>
            </a>
          ) : (
            expand && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="press -my-1 size-11 desk:size-7"
                aria-expanded={expand.expanded}
                aria-label={expand.expanded ? 'Collapse note' : 'Expand note'}
                onClick={expand.toggle}
              >
                {expand.expanded ? (
                  <ArrowsInSimpleIcon />
                ) : (
                  <ArrowsOutSimpleIcon />
                )}
              </Button>
            )
          )}
        </span>
      </header>

      {editing !== null ? (
        <NoteEditor
          note={note}
          people={state.people}
          initial={editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <>
          <div
            ref={body}
            id={bodyId}
            className={cn(
              compact
                ? 'note-clamp note-clamp-10'
                : !expanded && !expand?.expanded && 'note-clamp',
            )}
            data-overflows={(overflows && !expanded) || undefined}
          >
            <Markdown
              className={cn(compact && 'prose-compact')}
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
          {overflows && !compact && !expand && (
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
        <SelectionTaskButton picked={picked} onClick={fromSelection} />
      )}

      {editing === null && asking !== null && !compact && (
        <AskTaskForm
          note={note}
          initial={asking}
          onDone={() => setAsking(null)}
        />
      )}

      {editing === null && asking === null && !compact && (
        <footer className="-mx-1.5 -mb-1.5 flex flex-wrap gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Edit note"
            onClick={() => setEditing(act.editText())}
          >
            <PencilSimpleIcon />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            onClick={act.togglePin}
          >
            {note.pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
            {note.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Make task from note"
            onClick={() => setAsking(act.taskTitle())}
          >
            <CheckSquareOffsetIcon />
            Make task
          </Button>
          {act.summarize && (
            <Button
              variant="ghost"
              size="sm"
              className="press h-11 desk:h-7"
              aria-label="Summarize note"
              onClick={act.summarize}
            >
              <SparkleIcon />
              Summarize
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Save as template from note"
            onClick={act.saveAsTemplate}
          >
            <CopySimpleIcon />
            Save as template
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-7"
            aria-label="Delete note"
            onClick={act.remove}
          >
            <TrashIcon />
            Delete
          </Button>
        </footer>
      )}
    </article>
  );
}
