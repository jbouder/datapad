import {
  CheckSquareOffsetIcon,
  FolderSimpleIcon,
  PencilSimpleIcon,
  ScalesIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { taskTitleFrom } from '#shared/notes';
import type { Note, Snapshot } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import {
  NoteEditor,
  SelectionTaskButton,
  useNoteActions,
  useNoteTarget,
  useSelectionTask,
} from '@/components/notes/noteParts';
import { useMakeTask } from '@/components/notes/useMakeTask';
import { Picker } from '@/components/pickers/Picker';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useNow } from '@/hooks/useNow';
import { navigate } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

const ACTION = 'press h-11 px-1.5 desk:h-7 desk:px-2.5';
/** Edit and Delete are icons on a phone, so a block's actions fit a row. */
const ICON_ON_PHONE = 'press size-11 desk:h-7 desk:w-auto desk:px-2.5';

/**
 * One block on Scratch (#333): a note with no home, its relative time,
 * the rendered body (checklists tick in place) and its actions, always
 * shown: File to (a project picker; `moveNote`, with Undo), Make task
 * and To decide (a task titled from the first line, pointing back at the
 * note, which stays), Edit in place and Delete (with Undo). Selected
 * text offers Make task too. A block that gains a project or a mention
 * has a home, so it leaves the page.
 *
 * It is an `<li>`: put it in a `<ul>`.
 */
export function ScratchBlock({
  note,
  state,
}: {
  note: Note;
  state: Pick<Snapshot, 'people' | 'projects'>;
}) {
  const clock = useClock();
  const now = useNow();
  const { actions } = useDatapad();
  const { show } = useToast();
  const act = useNoteActions(note, state.people);
  const makeTask = useMakeTask();
  const [editing, setEditing] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileButton = useRef<HTMLButtonElement>(null);
  const flash = useNoteTarget(row, note.id);
  const { picked, make } = useSelectionTask(note, body, row);
  const pickerId = useId();
  const stamp = formatTimestamp(note.createdAt, clock);
  const title = taskTitleFrom(note.body, state.people);

  const projects = useMemo(
    () =>
      Object.values(state.projects)
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ id: p.id, label: p.name, hint: p.org || undefined })),
    [state.projects],
  );

  // The picker takes focus as it opens.
  useEffect(() => {
    if (filing) document.getElementById(pickerId)?.focus();
  }, [filing, pickerId]);

  const stopFiling = () => {
    setFiling(false);
    requestAnimationFrame(() => fileButton.current?.focus());
  };

  const file = (projectId: string) => {
    const project = state.projects[projectId];
    if (!project) return;
    if (!actions.moveNote({ id: note.id, projectId })) return;
    setFiling(false);
    show(
      `Filed to “${project.name}”`,
      () => actions.moveNote({ id: note.id, projectId: null }),
      {
        label: 'Open',
        run: () =>
          navigate(
            { name: 'project', id: projectId },
            { query: `note=${encodeURIComponent(note.id)}` },
          ),
      },
    );
  };

  return (
    <li
      ref={row}
      tabIndex={-1}
      data-note-id={note.id}
      data-flip-id={note.id}
      data-highlighted={flash || undefined}
      className="enter note-card relative border bg-card outline-none"
    >
      <article
        aria-label={`Block, ${stamp}`}
        className="flex flex-col gap-2 p-3"
      >
        <header className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <time dateTime={note.createdAt} title={stamp}>
            {relativeTime(note.createdAt, new Date(now))}
          </time>
          {note.editedAt && (
            <span title={formatTimestamp(note.editedAt, clock)}>· edited</span>
          )}
        </header>

        {editing !== null ? (
          <NoteEditor
            note={note}
            people={state.people}
            initial={editing}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div ref={body}>
            <Markdown
              text={note.body}
              people={state.people}
              onToggle={(line) =>
                actions.editNote({
                  id: note.id,
                  body: toggleCheck(note.body, line),
                })
              }
            />
          </div>
        )}

        {picked && editing === null && (
          <SelectionTaskButton picked={picked} onClick={make} />
        )}

        {editing === null &&
          (filing ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: Esc leaves the picker; the controls inside are the interactive part
            <div
              className="flex flex-wrap items-center gap-2"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !e.defaultPrevented) {
                  e.preventDefault();
                  e.stopPropagation();
                  stopFiling();
                }
              }}
            >
              <Picker
                id={pickerId}
                aria-label="File to project"
                placeholder="File to…"
                options={projects}
                value=""
                onChange={file}
                className="min-w-48 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                className="press h-11 desk:h-8"
                onClick={stopFiling}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <footer className="-mx-1.5 -mb-1.5 flex flex-wrap desk:gap-0.5">
              <Button
                ref={fileButton}
                variant="ghost"
                size="sm"
                className={ACTION}
                disabled={projects.length === 0}
                onClick={() => setFiling(true)}
              >
                <FolderSimpleIcon />
                File to…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={ACTION}
                disabled={!title}
                onClick={() => makeTask(note, title)}
              >
                <CheckSquareOffsetIcon />
                Make task
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={ACTION}
                disabled={!title}
                onClick={() => makeTask(note, title, { decide: true })}
              >
                <ScalesIcon />
                To decide
              </Button>
              <span className="ml-auto flex desk:ml-0 desk:gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className={ICON_ON_PHONE}
                  title="Edit"
                  onClick={() => setEditing(act.editText())}
                >
                  <PencilSimpleIcon />
                  <span className="sr-only desk:not-sr-only">Edit</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={ICON_ON_PHONE}
                  title="Delete"
                  onClick={act.remove}
                >
                  <TrashIcon />
                  <span className="sr-only desk:not-sr-only">Delete</span>
                </Button>
              </span>
            </footer>
          ))}
      </article>
    </li>
  );
}
