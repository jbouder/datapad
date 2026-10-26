import { PlusIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import type { Person } from '#shared/types';
import { Field } from '@/components/Field';
import { NoteComposer } from '@/components/NoteComposer';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { useToast } from '@/providers/ToastProvider';

/**
 * `/task` and `/decision` in a note composer: a task in the note's
 * project, or a decision pointing back at the note about to be added.
 */
export function useNoteCommands(
  projectId: string | null,
  noteId: string,
): {
  onTask: (title: string) => boolean;
  onDecision: (title: string) => boolean;
} {
  const { actions } = useDatapad();
  const { show } = useToast();
  return {
    onTask: (title) => {
      if (actions.addTask({ projectId, title }) === null) return false;
      show(`Added “${title}”`);
      return true;
    },
    onDecision: (title) => {
      const made = actions.addDecision({
        projectId,
        title,
        sourceNoteId: noteId,
      });
      if (made === null) return false;
      show(`Proposed “${title}”`);
      return true;
    },
  };
}

/**
 * Write a note: the composer, the project it goes to (a picker on the
 * Notes page, fixed on a project page) and Add note (or ⌘Enter). Until
 * you use it, it is one line: the formatting buttons, the picker and Add
 * note arrive with focus, and go again when it is left empty. The draft
 * is kept per project; adding clears it and keeps the focus for the next
 * one. `/task` makes a task in the same project. (A note on a meeting is
 * written on the meeting: MeetingNoteComposer.)
 */
export function NoteForm({
  projectId: fixed,
  people,
}: {
  /** A project page's project; omitted, a picker chooses (General first). */
  projectId?: string | null;
  people: Record<string, Person>;
}) {
  const { actions } = useDatapad();
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = fixed === undefined ? picked : fixed;
  const [text, setText] = useState('');
  const id = useId();

  /** The id the note will have, known before it is added. */
  const noteId = useRef(newId());
  const commands = useNoteCommands(projectId, noteId.current);

  // Open while it has focus or anything in it; a picker's popup (outside
  // the form, in a portal) still counts as in it. Left with a press, it
  // folds once the press is over, so what was pressed stays put for its
  // click.
  const [focused, setFocused] = useState(false);
  const expanded = focused || text.trim() !== '';
  const form = useRef<HTMLFieldSetElement>(null);
  const pressing = useRef(false);
  useEffect(() => {
    const down = () => {
      pressing.current = true;
    };
    const up = () => {
      pressing.current = false;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  const fold = () => {
    if (!form.current?.contains(document.activeElement)) setFocused(false);
  };

  const add = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    if (actions.addNote({ id: noteId.current, projectId, body }) === null) {
      return;
    }
    // The next note gets a fresh id (decisions made from it point there).
    noteId.current = newId();
    setText('');
    document.getElementById(id)?.focus();
  };

  return (
    <fieldset
      ref={form}
      className="flex min-w-0 flex-col gap-2"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        if (
          next instanceof Element &&
          next.closest('[role="listbox"], [role="dialog"]')
        ) {
          return;
        }
        if (!pressing.current) {
          fold();
          return;
        }
        // After the click that pointerup leads to.
        window.addEventListener('pointerup', () => window.setTimeout(fold), {
          once: true,
        });
      }}
    >
      <legend className="sr-only">Write a note</legend>
      <Field label="New note" labelHidden>
        <NoteComposer
          id={id}
          value={text}
          onChange={setText}
          people={people}
          placeholder={
            expanded
              ? 'Write a note. / for styles, @ to mention'
              : 'Write a note…'
          }
          toolbar={expanded}
          className={expanded ? undefined : 'min-h-11 desk:min-h-9'}
          draftKey={`datapad:draft:note:${fixed === undefined ? 'notes' : (fixed ?? 'general')}`}
          onSubmit={add}
          {...commands}
        />
      </Field>
      {expanded && (
        <div className="enter flex flex-wrap items-end gap-2">
          {fixed === undefined && (
            <div className="min-w-48 flex-1 desk:max-w-64">
              <ProjectPicker
                value={picked}
                onChange={setPicked}
                aria-label="Project for the note"
              />
            </div>
          )}
          <Button
            className="press ml-auto h-11 desk:h-8"
            disabled={!text.trim()}
            onClick={add}
          >
            <PlusIcon />
            Add note
          </Button>
        </div>
      )}
    </fieldset>
  );
}
