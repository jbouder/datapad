import {
  CalendarBlankIcon,
  CheckSquareIcon,
  CheckSquareOffsetIcon,
} from '@phosphor-icons/react';
import {
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { inScratch, taskTitleFrom } from '#shared/notes';
import type { Note, Person, Snapshot } from '#shared/types';
import { NoteComposer } from '@/components/NoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { useMakeTask } from '@/components/notes/useMakeTask';
import { useNoteCommands } from '@/components/notes/useNoteCommands';
import { Picker } from '@/components/pickers/Picker';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { addLeaveGuard } from '@/lib/leave';
import { linkProps, navigate, useQuery } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/*
 * What a note card (`NoteCard`) and a note row (`NoteRow`) share: the
 * actions on a note, editing it in place, asking for a task title, making
 * a task from selected text, and arriving at it from `?note=<id>`.
 */

/**
 * A note's actions: Pin/Unpin, Save as template (a note template from it), Delete (with Undo), and
 * the text Edit and Make task start from.
 */
export function useNoteActions(note: Note, people: Record<string, Person>) {
  const { actions } = useDatapad();
  const { removeNote } = useNotes();
  const { newNoteTemplate } = useTemplateForm();
  return {
    /** The body with mentions as names, for the composer. */
    editText: () => tokensToNames(note.body, people),
    /** The first line, for Make task's title. */
    taskTitle: () => taskTitleFrom(note.body, people),
    togglePin: () => actions.pinNote({ id: note.id, pinned: !note.pinned }),
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
        (project || inScratch(note) ? (
          <a
            {...linkProps(
              project
                ? { name: 'project', id: project.id }
                : { name: 'scratch' },
            )}
            className={CHIP}
          >
            <span className="truncate border px-1.5 py-0.5 text-foreground hover:bg-accent">
              {project ? project.name : 'Scratch'}
            </span>
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
 * e.g. to open a row. Off (`enabled` false) where the note opens
 * elsewhere: a room's pinned note opens at the top of the room (#377).
 */
export function useNoteTarget(
  box: RefObject<HTMLElement | null>,
  noteId: string,
  onArrive?: () => void,
  enabled = true,
): boolean {
  const target = useQuery().get('note');
  const [flash, setFlash] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the target changes, not when the callback does
  useEffect(() => {
    if (!enabled || target !== noteId || !box.current) return;
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
 * A double-click on a note's text starts editing it, as Edit in its menu
 * does. Not on a link, a checkbox or a button inside it, and the word the
 * double-click selected is let go.
 */
export function editOnDoubleClick(start: () => void) {
  return (event: React.MouseEvent) => {
    const target = event.target as Element;
    if (target.closest('a, button, input, label, [role="checkbox"]')) return;
    document.getSelection()?.removeAllRanges();
    start();
  };
}

/**
 * Editing a note in place: the composer with mentions as names, Cancel
 * and Save note. Esc cancels. `onDone` runs once it is saved or dropped.
 *
 * With changes not yet saved, leaving asks "Save changes to this note?"
 * (Discard or Save note) in place of its buttons: a link, Back, or
 * closing the panel it sits in waits for the answer, then goes on
 * (`src/lib/leave.ts`). A click elsewhere on the page keeps it open with
 * its text, so it does not ask.
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
  const commands = useNoteCommands(note.projectId, note.meetingId, note.id);
  const [text, setText] = useState(initial);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  /** Asking whether to save, after a leave it held. */
  const [asking, setAsking] = useState(false);
  /** The leave that waits for the answer. */
  const pending = useRef<(() => void) | null>(null);
  /** Whether there is anything to lose: the text differs from the start. */
  const changed = useRef(false);
  changed.current = text !== initial;

  useEffect(
    () =>
      addLeaveGuard({
        element: () => box.current,
        hold: (resume) => {
          if (!changed.current) return false;
          pending.current = resume;
          setAsking(true);
          requestAnimationFrame(() => keep.current?.focus());
          return true;
        },
      }),
    [],
  );

  /** Done with it: close, then finish the leave that waited, if one did. */
  const finish = () => {
    changed.current = false;
    setAsking(false);
    const resume = pending.current;
    pending.current = null;
    onDone();
    resume?.();
  };

  const save = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    if (actions.editNote({ id: note.id, body }) !== false) finish();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc cancels the edit; the controls inside are the interactive part
    <div
      ref={box}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          // While it asks, Esc goes back to the text and the leave waits
          // no more.
          if (asking) {
            pending.current = null;
            setAsking(false);
          } else {
            finish();
          }
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
        {...commands}
        autoFocus
        rows={4}
      />
      {asking ? (
        <div
          role="alertdialog"
          aria-labelledby={`${id}-ask`}
          className="flex flex-wrap items-center justify-end gap-2 border px-3 py-2"
        >
          <p id={`${id}-ask`} className="flex-1 text-sm">
            Save changes to this note?
          </p>
          <Button
            type="button"
            variant="outline"
            className="press h-11 desk:h-8"
            onClick={finish}
          >
            Discard
          </Button>
          <Button
            ref={keep}
            type="button"
            className="press h-11 desk:h-8"
            disabled={!text.trim()}
            onClick={save}
          >
            Save note
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            className="press h-11 desk:h-7"
            onClick={finish}
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
      )}
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

/**
 * Whether a note can move to another project (`moveNote`): not a
 * meeting's, a task's or the Notepad.
 */
export function canMoveNote(note: Note): boolean {
  return (
    note.meetingId === null && (note.taskId ?? null) === null && !note.scratch
  );
}

/** The picker's pick for "no project": Scratch, or its mentions' rooms. */
const NO_PROJECT = '-';

/**
 * Move a note to another project, or to none: a project picker with
 * Cancel, Esc too. Moving toasts with Undo and Open. `onDone` runs once
 * it is moved or dropped.
 */
export function MoveNoteForm({
  note,
  projects,
  onDone,
}: {
  note: Note;
  projects: Snapshot['projects'];
  onDone: () => void;
}) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const id = useId();
  const options = useMemo(
    () => [
      ...Object.values(projects)
        .filter((p) => !p.archived && p.id !== note.projectId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.id, label: p.name, hint: p.org || undefined })),
      ...(note.projectId ? [{ id: NO_PROJECT, label: 'No project' }] : []),
    ],
    [projects, note.projectId],
  );

  // The picker takes focus as it opens.
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);

  const move = (picked: string) => {
    const to = picked === NO_PROJECT ? null : picked;
    const from = note.projectId;
    const project = to ? projects[to] : null;
    if (to && !project) return;
    if (!actions.moveNote({ id: note.id, projectId: to })) return;
    onDone();
    show(
      project ? `Moved to “${project.name}”` : 'Moved out of the project',
      () => actions.moveNote({ id: note.id, projectId: from }),
      project
        ? {
            label: 'Open',
            run: () =>
              navigate(
                { name: 'project', id: project.id },
                { query: `note=${encodeURIComponent(note.id)}` },
              ),
          }
        : undefined,
    );
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc leaves the picker; the controls inside are the interactive part
    <div
      className="flex flex-wrap items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <Picker
        id={id}
        aria-label="Move to project"
        placeholder="Move to…"
        options={options}
        value=""
        onChange={move}
        className="min-w-48 flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        className="press h-11 desk:h-8"
        onClick={onDone}
      >
        Cancel
      </Button>
    </div>
  );
}
