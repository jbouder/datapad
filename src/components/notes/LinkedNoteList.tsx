import { CaretRightIcon, PlusIcon } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import type { Note, Snapshot } from '#shared/types';
import {
  InlineNoteComposer,
  type InlineNoteComposerHandle,
  type InlineNoteFields,
} from '@/components/notes/InlineNoteComposer';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { type RememberSection, useSectionOpen } from '@/components/Section';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The notes on one thing, on its page and in its panel: a task's running
 * notes (docs/SPEC.md § Task notes) or a meeting's (§ Meetings and notes
 * linkage). Newest first, each a compact `NoteRow` (opens in place; its
 * ⋯ menu edits, pins, makes a task, deletes with Undo…); then the inline
 * composer, which Add note (by the heading) opens and which sends
 * `fields` with the note. They are ordinary notes, so they also show on
 * Notes and the project page. With `remember` (the task page, #312) the
 * heading opens and closes the list, saved with that page's preferences;
 * Add note shows it open while the composer is.
 */
export function LinkedNoteList({
  notes: all,
  fields,
  state,
  label,
  draftKey,
  headingLevel = 3,
  remember,
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
  /** Where open or closed is saved; without it the list is always open. */
  remember?: RememberSection;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { hidden } = useNotes();
  const [composing, setComposing] = useState(false);
  const composer = useRef<InlineNoteComposerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const notes = all.filter((n) => !hidden.has(n.id));
  const headingId = useId();
  const bodyId = useId();
  const section = useSectionOpen({ remember, forced: composing });
  const open = !remember || section.open;

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
        <Heading id={headingId} className="flex text-xs font-medium">
          {remember ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={section.toggle}
              className="-ml-1 flex min-h-11 items-center gap-1.5 px-1 text-left outline-ring/50 focus-visible:outline-2 desk:min-h-7"
            >
              <CaretRightIcon
                weight="bold"
                aria-hidden
                className={cn(
                  'size-3 transition-transform duration-(--duration-fast)',
                  open && 'rotate-90',
                )}
              />
              Notes
            </button>
          ) : (
            'Notes'
          )}
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
      <div
        id={bodyId}
        hidden={!open}
        className="section-body flex flex-col gap-2"
        data-opening={section.opening || undefined}
      >
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
      </div>
    </section>
  );
}
