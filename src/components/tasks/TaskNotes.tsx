import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { notesOfTask } from '#shared/select';
import type { Note, Person, Snapshot, Task } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { NoteComposer } from '@/components/NoteComposer';
import {
  InlineNoteComposer,
  type InlineNoteComposerHandle,
} from '@/components/notes/InlineNoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * A task's running notes, in its panel (docs/SPEC.md § Task notes):
 * newest first, each rendered with when it was written, Edit (in place)
 * and Delete (with Undo); then the inline composer, which Add note (by
 * the heading) opens.
 * They are ordinary notes (`taskId`), so they also show on Notes and the
 * project page.
 */
export function TaskNotes({ task, state }: { task: Task; state: Snapshot }) {
  const { hidden } = useNotes();
  const [composing, setComposing] = useState(false);
  const composer = useRef<InlineNoteComposerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const notes = notesOfTask(state.notes, task.id).filter(
    (n) => !hidden.has(n.id),
  );
  const headingId = useId();

  // The button stays put while the composer is open (pressing it again
  // goes back to the text), so focus always has somewhere to return to.
  const add = () => {
    if (composing) composer.current?.focus();
    else setComposing(true);
  };
  const done = () => {
    setComposing(false);
    addButton.current?.focus();
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-xs font-medium">
          Notes
        </h3>
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          className="press h-11 desk:h-7"
          aria-expanded={composing}
          onClick={add}
        >
          <PlusIcon />
          Add note
        </Button>
      </div>
      {notes.length === 0 ? (
        !composing && (
          <p className="text-sm text-muted-foreground">No notes yet</p>
        )
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-2">
          {notes.map((n) => (
            <TaskNote key={n.id} note={n} people={state.people} />
          ))}
        </ul>
      )}
      {composing && (
        <InlineNoteComposer
          ref={composer}
          fields={{ projectId: task.projectId, taskId: task.id }}
          people={state.people}
          label={`New note on “${task.title}”`}
          draftKey={`datapad:draft:note:task:${task.id}`}
          onDone={done}
        />
      )}
    </section>
  );
}

function TaskNote({
  note,
  people,
}: {
  note: Note;
  people: Record<string, Person>;
}) {
  const { actions } = useDatapad();
  const { removeNote } = useNotes();
  const [editing, setEditing] = useState<string | null>(null);
  const editId = useId();
  const when = formatTimestamp(note.createdAt);

  const save = () => {
    if (editing === null) return;
    const body = namesToTokens(editing, people).trim();
    if (!body) return;
    if (actions.editNote({ id: note.id, body }) !== false) setEditing(null);
  };

  return (
    <li
      data-note-id={note.id}
      aria-label={`Note, ${when}`}
      className="enter flex flex-col gap-1.5 border p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <time dateTime={note.createdAt} title={when}>
          {relativeTime(note.createdAt, new Date())}
        </time>
        {note.editedAt && (
          <span title={formatTimestamp(note.editedAt)}>· edited</span>
        )}
      </div>
      {editing !== null ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: Esc cancels the edit; the controls inside are the interactive part
        <div
          className="flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.defaultPrevented) {
              e.preventDefault();
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
            people={people}
            onSubmit={save}
            autoFocus
            rows={4}
          />
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              className="press h-11 desk:h-7"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
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
          <Markdown
            text={note.body}
            people={people}
            onToggle={(line) =>
              actions.editNote({
                id: note.id,
                body: toggleCheck(note.body, line),
              })
            }
          />
          <div className="-mx-1.5 -mb-1.5 flex flex-wrap gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="press h-11 desk:h-7"
              onClick={() => setEditing(tokensToNames(note.body, people))}
            >
              <PencilSimpleIcon />
              Edit
              <span className="sr-only"> note from {when}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="press h-11 desk:h-7"
              onClick={() => removeNote(note)}
            >
              <TrashIcon />
              Delete
              <span className="sr-only"> note from {when}</span>
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
