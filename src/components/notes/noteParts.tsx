import {
  CalendarBlankIcon,
  CheckSquareIcon,
  CheckSquareOffsetIcon,
} from '@phosphor-icons/react';
import { type RefObject, useEffect, useId, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { taskTitleFrom } from '#shared/notes';
import type { Note, Person, Snapshot } from '#shared/types';
import { NoteComposer } from '@/components/NoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { useMakeTask } from '@/components/notes/useMakeTask';
import { useNoteTemplates } from '@/components/notes/useNoteCommands';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, useQuery } from '@/lib/router';

/*
 * What a note card (`NoteCard`) and a note row (`NoteRow`) share: the
 * actions on a note, editing it in place, asking for a task title, making
 * a task from selected text, and arriving at it from `?note=<id>`.
 */

/**
 * A note's actions: Pin/Unpin, Summarize (null while summaries are off),
 * Save as template (a note template from it), Delete (with Undo), and
 * the text Edit and Make task start from.
 */
export function useNoteActions(note: Note, people: Record<string, Person>) {
  const { actions } = useDatapad();
  const { removeNote } = useNotes();
  const { summarize, enabled: summariesOn } = useSummaries();
  const { newNoteTemplate } = useTemplateForm();
  return {
    /** The body with mentions as names, for the composer. */
    editText: () => tokensToNames(note.body, people),
    /** The first line, for Make task's title. */
    taskTitle: () => taskTitleFrom(note.body, people),
    togglePin: () => actions.pinNote({ id: note.id, pinned: !note.pinned }),
    summarize: summariesOn
      ? () => summarize({ kind: 'note', id: note.id })
      : null,
    saveAsTemplate: () =>
      newNoteTemplate({
        name: taskTitleFrom(note.body, people).slice(0, LIMITS.nameMax),
        body: note.body,
      }),
    remove: () => removeNote(note),
  };
}

const CHIP = 'press inline-flex max-w-full min-h-11 items-center desk:min-h-0';
const CHIP_FACE =
  'inline-flex min-w-0 items-center gap-1 bg-accent px-1.5 py-0.5 text-accent-foreground hover:underline';

/**
 * Where a note belongs, as chips: its project (General, or the Notepad's
 * link), its meeting, its task (opens the panel). Each only when asked.
 */
export function NoteChips({
  note,
  state,
  project: showProject,
  meeting: showMeeting,
  task: showTask,
}: {
  note: Note;
  state: Pick<Snapshot, 'projects' | 'meetings' | 'tasks'>;
  /** The project (or General, or the Notepad). */
  project?: boolean;
  meeting?: boolean;
  task?: boolean;
}) {
  const { openTask } = useTaskPanels();
  const project = note.projectId ? state.projects[note.projectId] : null;
  const meeting = note.meetingId ? state.meetings[note.meetingId] : null;
  const task = note.taskId ? state.tasks[note.taskId] : null;
  return (
    <>
      {showProject &&
        (note.scratch || project ? (
          <a
            {...linkProps(
              project && !note.scratch
                ? { name: 'project', id: project.id }
                : { name: 'notepad' },
            )}
            className="border px-1.5 py-0.5 text-foreground hover:bg-accent"
          >
            {project && !note.scratch ? project.name : 'Notepad'}
          </a>
        ) : (
          <span className="border border-dashed px-1.5 py-0.5">General</span>
        ))}
      {showMeeting && meeting && (
        <a {...linkProps({ name: 'meeting', id: meeting.id })} className={CHIP}>
          <span className={CHIP_FACE}>
            <CalendarBlankIcon aria-hidden className="shrink-0" />
            <span className="sr-only">Meeting: </span>
            <span className="truncate">{meeting.title}</span>
          </span>
        </a>
      )}
      {showTask &&
        note.taskId &&
        (task ? (
          <button
            type="button"
            onClick={() => openTask(task.id)}
            className={CHIP}
          >
            <span className={CHIP_FACE}>
              <CheckSquareIcon aria-hidden className="shrink-0" />
              <span className="sr-only">Task: </span>
              <span className="truncate">{task.title}</span>
            </span>
          </button>
        ) : (
          <span className="border border-dashed px-1.5 py-0.5">
            Task deleted
          </span>
        ))}
    </>
  );
}

/**
 * Arriving from a link to the note (`?note=<id>`: a task's "From note",
 * the agenda, search): bring `box` into view, focus it, and say for a
 * moment that it is the one (`data-highlighted`). `onArrive` runs first,
 * e.g. to open a row.
 */
export function useNoteTarget(
  box: RefObject<HTMLElement | null>,
  noteId: string,
  onArrive?: () => void,
): boolean {
  const target = useQuery().get('note');
  const [flash, setFlash] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the target changes, not when the callback does
  useEffect(() => {
    if (target !== noteId || !box.current) return;
    onArrive?.();
    box.current.scrollIntoView({ block: 'center' });
    box.current.focus({ preventScroll: true });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [target, noteId, box]);
  return flash;
}

interface Picked {
  title: string;
  top: number;
  left: number;
}

/**
 * Make task from selected text: a selection inside `body` offers a Make
 * task button beside it (below it on touch, where the system's own menu
 * is above), placed relative to `box`. Esc dismisses it. Render
 * `SelectionTaskButton` with what this returns.
 */
export function useSelectionTask(
  note: Note,
  body: RefObject<HTMLElement | null>,
  box: RefObject<HTMLElement | null>,
) {
  const makeTask = useMakeTask();
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      const el = body.current;
      const outer = box.current;
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !el ||
        !outer
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
      const c = outer.getBoundingClientRect();
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
  }, [body, box]);

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

  const make = () => {
    if (!picked) return;
    if (makeTask(note, picked.title)) {
      document.getSelection()?.removeAllRanges();
      setPicked(null);
    }
  };
  return { picked, make };
}

/** The Make task button by a selection (`useSelectionTask`). */
export function SelectionTaskButton({
  picked,
  onClick,
}: {
  picked: Picked;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      className="press absolute z-10 h-11 -translate-x-1/2 shadow-md desk:h-8"
      style={{ top: picked.top, left: picked.left }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={`Make task “${picked.title}”`}
    >
      <CheckSquareOffsetIcon />
      Make task
    </Button>
  );
}

/**
 * Editing a note in place: the composer with mentions as names, Cancel
 * and Save note. Esc cancels. `onDone` runs once it is saved or dropped.
 */
export function NoteEditor({
  note,
  people,
  initial,
  onDone,
}: {
  note: Note;
  people: Record<string, Person>;
  /** The text to start from (`useNoteActions().editText()`). */
  initial: string;
  onDone: () => void;
}) {
  const { actions } = useDatapad();
  const makeTask = useMakeTask();
  const templates = useNoteTemplates();
  const [text, setText] = useState(initial);
  const id = useId();

  const save = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    if (actions.editNote({ id: note.id, body }) !== false) onDone();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc cancels the edit; the controls inside are the interactive part
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <NoteComposer
        id={id}
        label="Edit note"
        value={text}
        onChange={setText}
        people={people}
        onSubmit={save}
        onTask={(title) => makeTask(note, title)}
        templates={templates}
        autoFocus
        rows={4}
      />
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          className="press h-11 desk:h-7"
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="press h-11 desk:h-7"
          disabled={!text.trim()}
          onClick={save}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}

/**
 * Make task from a whole note: asks for the title, starting from the
 * note's first line. `onDone` runs once the task is made or dropped.
 */
export function AskTaskForm({
  note,
  initial,
  onDone,
}: {
  note: Note;
  initial: string;
  onDone: () => void;
}) {
  const makeTask = useMakeTask();
  const [title, setTitle] = useState(initial);
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (makeTask(note, title)) onDone();
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-medium">
          Task title
        </label>
        <Input
          id={id}
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onDone();
            }
          }}
          className="h-11 text-base desk:h-8 desk:text-xs"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        className="press h-11 desk:h-8"
        onClick={onDone}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        className="press h-11 desk:h-8"
        disabled={!title.trim()}
      >
        Make task
      </Button>
    </form>
  );
}
