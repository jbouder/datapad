import { LinkBreakIcon, PlusIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDay, localDate } from '#shared/dates';
import { namesToTokens } from '#shared/mentions';
import type { Meeting, NotePhase, Person } from '#shared/types';
import {
  accepts,
  type EventNoteIntent,
  type NoteTarget,
  useEventNotes,
} from '@/components/events/EventNotesProvider';
import { Field } from '@/components/Field';
import { NoteComposer } from '@/components/NoteComposer';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { useToast } from '@/providers/ToastProvider';

export const PHASE_LABELS: Record<NotePhase, string> = {
  pre: 'Prep',
  post: 'Debrief',
};

/** "## Prep: Shield review — Tue 27 Oct", a linked note's first line. */
export function seedLine(event: Meeting, phase: NotePhase, today: string) {
  return `## ${PHASE_LABELS[phase]}: ${event.title} — ${formatDay(event.date, today)}`;
}

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
 * one. `/task` makes a task in the same project.
 *
 * An event's Prep note / Debrief note lands here (EventNotesProvider):
 * the note is linked to the event, its project picked, and the seed line
 * written into an empty draft or added after what is already there.
 */
export function NoteForm({
  projectId: fixed,
  people,
}: {
  /** A project page's project; omitted, a picker chooses (General first). */
  projectId?: string | null;
  people: Record<string, Person>;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { register, pending, clearPending } = useEventNotes();
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = fixed === undefined ? picked : fixed;
  const [text, setText] = useState('');
  const [link, setLink] = useState<EventNoteIntent | null>(null);
  const id = useId();
  const textRef = useRef(text);
  textRef.current = text;
  const linked = link ? state?.meetings[link.meetingId] : undefined;

  const prefill = useRef<NoteTarget['prefill']>(() => {});
  prefill.current = (event, phase) => {
    const seed = seedLine(event, phase, localDate(new Date()));
    const draft = textRef.current.replace(/\s+$/, '');
    setText(draft ? `${draft}\n${seed}\n` : `${seed}\n`);
    setLink({ meetingId: event.id, phase });
    if (fixed === undefined) setPicked(event.projectId);
    if (draft) show(`Linked to “${event.title}”`);
    // Once the new text is on screen: the caret at its end, in view.
    requestAnimationFrame(() => {
      const area = document.getElementById(id) as HTMLTextAreaElement | null;
      if (!area) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(area.value.length, area.value.length);
      area.scrollIntoView({ block: 'center' });
    });
  };

  useEffect(
    () =>
      register({
        projectId: fixed,
        prefill: (event, phase) => prefill.current(event, phase),
      }),
    [register, fixed],
  );

  // Arriving from elsewhere with a parked Prep / Debrief note.
  useEffect(() => {
    if (!pending || !state) return;
    const event = state.meetings[pending.meetingId];
    if (!event) {
      clearPending();
      return;
    }
    if (!accepts({ projectId: fixed, prefill: () => {} }, event)) return;
    clearPending();
    // After the composer has put back any draft, which the seed follows.
    // Not canceled: clearing `pending` re-runs this effect.
    window.setTimeout(() => prefill.current(event, pending.phase));
  }, [pending, state, fixed, clearPending]);

  /** The id the note will have, known before it is added. */
  const noteId = useRef(newId());
  const commands = useNoteCommands(projectId, noteId.current);

  // Open while it has focus or anything in it; a picker's popup (outside
  // the form, in a portal) still counts as in it. Left with a press, it
  // folds once the press is over, so what was pressed stays put for its
  // click.
  const [focused, setFocused] = useState(false);
  const expanded = focused || text.trim() !== '' || linked !== undefined;
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
    const event = linked ? { meetingId: linked.id, phase: link?.phase } : {};
    if (
      actions.addNote({ id: noteId.current, projectId, body, ...event }) ===
      null
    ) {
      return;
    }
    // The next note gets a fresh id (decisions made from it point there).
    noteId.current = newId();
    setText('');
    setLink(null);
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
      {linked && link && (
        <p className="flex min-h-11 items-center gap-2 text-xs desk:min-h-8">
          <span className="border bg-muted px-1.5 py-0.5">
            {PHASE_LABELS[link.phase]} · {linked.title}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="press h-11 desk:h-8"
            onClick={() => setLink(null)}
          >
            <LinkBreakIcon />
            Unlink
          </Button>
        </p>
      )}
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
          data={{
            'data-event': linked?.id,
            'data-phase': linked ? link?.phase : undefined,
          }}
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
