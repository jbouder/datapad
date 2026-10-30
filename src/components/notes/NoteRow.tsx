import {
  CaretRightIcon,
  CheckSquareOffsetIcon,
  CopySimpleIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { notePreview } from '#shared/notes';
import type { Note, Snapshot } from '#shared/types';
import { Markdown, marked } from '@/components/Markdown';
import {
  AskTaskForm,
  NoteChips,
  NoteEditor,
  SelectionTaskButton,
  useNoteActions,
  useNoteTarget,
  useSelectionTask,
} from '@/components/notes/noteParts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';

const MENU_TRIGGER =
  'press flex size-11 shrink-0 items-center justify-center outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

/** Which "where it belongs" chips a row shows; none by default. */
export type NoteRowChips = Omit<
  React.ComponentProps<typeof NoteChips>,
  'note' | 'state'
>;

/**
 * One note, compact (#273): a line of meta (when, edited, pinned, and
 * where it belongs when `chips` asks) over its first two lines as plain
 * text (`notePreview`). The row is a disclosure: the toggle (or a click
 * on the preview) opens it in place to the rendered note, where
 * checkboxes save and selected text offers Make task. Open or closed is
 * this row's own, not saved. The ⋯ menu holds Edit (in place), Pin,
 * Make task, Summarize (when on), Save as template and Delete (with
 * Undo). `?note=<id>` scrolls to the row, opens and highlights it.
 *
 * It is an `<li>`: put it in a `<ul>`.
 */
export function NoteRow({
  note,
  state,
  chips,
  when = 'relative',
  highlight,
  reveal = false,
  className,
  style,
}: {
  note: Note;
  state: Pick<Snapshot, 'people' | 'projects' | 'meetings' | 'tasks'>;
  chips?: NoteRowChips;
  /** `time` (hh:mm) under a day heading; `relative` where there is none. */
  when?: 'relative' | 'time';
  /** Words to mark (lower-case), in the preview and the opened note. */
  highlight?: string[];
  /**
   * Opens the row while true (Notes, when Find matches past the
   * preview), and closes it again when it turns false.
   */
  reveal?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const clock = useClock();
  const { actions } = useDatapad();
  const act = useNoteActions(note, state.people);
  const [open, setOpen] = useState(reveal);
  const [revealed, setRevealed] = useState(reveal);
  if (revealed !== reveal) {
    setRevealed(reveal);
    setOpen(reveal);
  }
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const row = useRef<HTMLLIElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const flash = useNoteTarget(row, note.id, () => setOpen(true));
  const { picked, make } = useSelectionTask(note, body, row);
  const bodyId = useId();
  const preview = useMemo(
    () => notePreview(note.body, state.people),
    [note.body, state.people],
  );

  const stamp = formatTimestamp(note.createdAt, clock);
  const time = new Date(note.createdAt);
  const shown =
    when === 'time'
      ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
      : relativeTime(note.createdAt, new Date());
  const words = highlight?.length ? highlight : undefined;

  /** Back to the toggle once an edit or a Make task is done with. */
  const settle = () => toggle.current?.focus({ preventScroll: true });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the toggle is the keyboard way to open the row
    <li
      ref={row}
      tabIndex={-1}
      data-note-id={note.id}
      data-flip-id={note.id}
      data-open={open || undefined}
      data-highlighted={flash || undefined}
      aria-label={`Note, ${stamp}`}
      className={cn(
        'enter note-row relative flex flex-col border bg-card outline-none',
        className,
      )}
      style={style}
      onClick={(e) => {
        // A click on a closed row's preview opens it, unless it ended a
        // text selection.
        if (open || editing !== null) return;
        const target = e.target as Element;
        if (!target.closest('[data-note-preview]')) return;
        if (!document.getSelection()?.isCollapsed) return;
        setOpen(true);
      }}
    >
      <div className="flex items-start gap-1 pr-1 pl-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
            className="press inline-flex min-h-11 items-center gap-1 px-1 text-left outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:min-h-8"
          >
            <CaretRightIcon
              weight="bold"
              aria-hidden
              className={cn(
                'size-3 shrink-0 transition-transform duration-(--duration-fast)',
                open && 'rotate-90',
              )}
            />
            <span className="sr-only">Note from </span>
            <time dateTime={note.createdAt} title={stamp}>
              {shown}
            </time>
            {note.editedAt && (
              <span title={formatTimestamp(note.editedAt, clock)}>
                · edited
              </span>
            )}
          </button>
          {note.pinned && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <PushPinIcon weight="fill" aria-hidden />
              Pinned
            </span>
          )}
          {chips && <NoteChips note={note} state={state} {...chips} />}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={MENU_TRIGGER}
            aria-label={`More for note from ${stamp}`}
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => {
                setAsking(null);
                setEditing(act.editText());
              }}
            >
              <PencilSimpleIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={act.togglePin}>
              {note.pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
              {note.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setEditing(null);
                setAsking(act.taskTitle());
              }}
            >
              <CheckSquareOffsetIcon />
              Make task
            </DropdownMenuItem>
            {act.summarize && (
              <DropdownMenuItem onClick={act.summarize}>
                <SparkleIcon />
                Summarize
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={act.saveAsTemplate}>
              <CopySimpleIcon />
              Save as template
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={act.remove}>
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div id={bodyId} className="px-3 pb-3">
        {editing !== null ? (
          <NoteEditor
            note={note}
            people={state.people}
            initial={editing}
            onDone={() => {
              setEditing(null);
              settle();
            }}
          />
        ) : open ? (
          <div ref={body} className="note-row-body">
            <Markdown
              text={note.body}
              people={state.people}
              highlight={words}
              onToggle={(line) =>
                actions.editNote({
                  id: note.id,
                  body: toggleCheck(note.body, line),
                })
              }
            />
          </div>
        ) : (
          <p
            data-note-preview
            className="line-clamp-2 cursor-pointer text-sm whitespace-pre-line break-words"
          >
            {preview ? marked(preview, words) : <em>Empty note</em>}
          </p>
        )}
      </div>

      {picked && open && editing === null && (
        <SelectionTaskButton picked={picked} onClick={make} />
      )}

      {editing === null && asking !== null && (
        <div className="px-3 pb-3">
          <AskTaskForm
            note={note}
            initial={asking}
            onDone={() => {
              setAsking(null);
              settle();
            }}
          />
        </div>
      )}
    </li>
  );
}
