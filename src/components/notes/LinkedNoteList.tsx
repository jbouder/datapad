import { PlusIcon } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import type { Note, Snapshot } from '#shared/types';
import {
  InlineNoteComposer,
  type InlineNoteComposerHandle,
  type InlineNoteFields,
} from '@/components/notes/InlineNoteComposer';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';

/**
 * The notes on one thing, on its page and in its panel: a task's running
 * notes (docs/SPEC.md § Task notes) or a meeting's (§ Meetings and notes
 * linkage). Newest first, each a compact `NoteRow` (opens in place; its
 * ⋯ menu edits, pins, makes a task, deletes with Undo…); then the inline
 * composer, which Add note (by the heading) opens and which sends
 * `fields` with the note. They are ordinary notes, so they also show on
 * Notes and the project page.
 */
export function LinkedNoteList({
  notes: all,
  fields,
  state,
  label,
  draftKey,
  headingLevel = 3,
}: {
  /** The thing's notes, newest first (`notesOfTask`, `notesOfMeeting`). */
  notes: Note[];
  /** What `addNote` is sent besides the id and the body. */
  fields: InlineNoteFields;
  state: Pick<Snapshot, 'people' | 'projects' | 'meetings' | 'tasks'>;
  /** The composer's accessible name, e.g. New note on “Shield review”. */
  label: string;
  draftKey: string;
  /** 2 on a meeting's page; 3 in a panel. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { hidden } = useNotes();
  const [composing, setComposing] = useState(false);
  const composer = useRef<InlineNoteComposerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const notes = all.filter((n) => !hidden.has(n.id));
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
        <Heading id={headingId} className="text-xs font-medium">
          Notes
        </Heading>
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
            <NoteRow key={n.id} note={n} state={state} />
          ))}
        </ul>
      )}
      {composing && (
        <InlineNoteComposer
          ref={composer}
          fields={fields}
          people={state.people}
          label={label}
          draftKey={draftKey}
          onDone={done}
        />
      )}
    </section>
  );
}
