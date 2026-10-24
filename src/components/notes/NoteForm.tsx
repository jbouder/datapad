import { LinkBreakIcon, PlusIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDay, localDate } from '#shared/dates';
import { namesToTokens } from '#shared/mentions';
import type { Event, NotePhase, Person } from '#shared/types';
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
export function seedLine(event: Event, phase: NotePhase, today: string) {
  return `## ${PHASE_LABELS[phase]}: ${event.title} — ${formatDay(event.date, today)}`;
}

/**
 * Write a note: the composer, the project it goes to (a picker on the
 * Notes page, fixed on a project page) and Add note (or ⌘Enter). The
 * draft is kept per project; adding clears it and keeps the focus for
 * the next one. `/task` makes a task in the same project.
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
  const linked = link ? state?.events[link.eventId] : undefined;

  const prefill = useRef<NoteTarget['prefill']>(() => {});
  prefill.current = (event, phase) => {
    const seed = seedLine(event, phase, localDate(new Date()));
    const draft = textRef.current.replace(/\s+$/, '');
    setText(draft ? `${draft}\n${seed}\n` : `${seed}\n`);
    setLink({ eventId: event.id, phase });
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
    const event = state.events[pending.eventId];
    if (!event) {
      clearPending();
      return;
    }
    if (!accepts({ projectId: fixed, prefill: () => {} }, event)) return;
    clearPending();
    // After the composer has put back any draft, which the seed follows.
    // Not cancelled: clearing `pending` re-runs this effect.
    window.setTimeout(() => prefill.current(event, pending.phase));
  }, [pending, state, fixed, clearPending]);

  /** The id the note will have, known before it is added. */
  const noteId = useRef(newId());

  const add = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    const event = linked ? { eventId: linked.id, phase: link?.phase } : {};
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
    <div className="flex flex-col gap-2">
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
          placeholder="Write a note. / for styles, @ to mention"
          draftKey={`datapad:draft:note:${fixed === undefined ? 'notes' : (fixed ?? 'general')}`}
          onSubmit={add}
          data={{
            'data-event': linked?.id,
            'data-phase': linked ? link?.phase : undefined,
          }}
          onTask={(title) => {
            if (actions.addTask({ projectId, title }) === null) return false;
            show(`Added “${title}”`);
            return true;
          }}
          onDecision={(title) => {
            const made = actions.addDecision({
              projectId,
              title,
              sourceNoteId: noteId.current,
            });
            if (made === null) return false;
            show(`Proposed “${title}”`);
            return true;
          }}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
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
    </div>
  );
}
