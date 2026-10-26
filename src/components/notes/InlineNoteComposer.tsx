import { PlusIcon } from '@phosphor-icons/react';
import {
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { namesToTokens } from '#shared/mentions';
import type { NotePhase, Person } from '#shared/types';
import { NoteComposer } from '@/components/NoteComposer';
import { useNoteCommands } from '@/components/notes/NoteForm';
import { Button } from '@/components/ui/button';
import { type ActionInput, useDatapad } from '@/hooks/useDatapad';
import { newId } from '@/lib/ids';
import { cn } from '@/lib/utils';

/** What `addNote` is sent besides the id and the body. */
export type InlineNoteFields = Omit<ActionInput<'addNote'>, 'id' | 'body'>;

export const PHASE_OPTIONS: readonly {
  value: NotePhase | null;
  label: string;
}[] = [
  { value: 'pre', label: 'Prep' },
  { value: 'post', label: 'Debrief' },
  { value: null, label: 'Note' },
];

function dropDraft(key: string | undefined) {
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Private mode: there was no draft.
  }
}

export interface InlineNoteComposerHandle {
  /** The caret to the end of the text, the composer in view. */
  focus: () => void;
}

/**
 * A note written where you are, under the thing it is about: the
 * composer (Markdown, `/` styles, `@` mentions), an optional phase picker
 * (Prep · Debrief · Note), Save note (or ⌘Enter) and Cancel (or Esc).
 * Save sends `addNote` with `fields` (and the picked phase) and calls
 * `onDone` with the new note's id; Cancel calls it with null. The draft
 * is kept per `draftKey` until either. `seed` starts an empty draft, and
 * follows the phase while the text is still only the seed. It opens with
 * `@starting-style` (`.enter`), a panel rather than a view transition.
 */
export function InlineNoteComposer({
  fields,
  people,
  label,
  phase,
  seed = '',
  draftKey,
  onDone,
  ref,
  className,
}: {
  fields: InlineNoteFields;
  people: Record<string, Person>;
  /** The text box's accessible name, e.g. Note for “Shield review”. */
  label: string;
  /** A Prep · Debrief · Note picker; its value is sent as `phase`. */
  phase?: {
    value: NotePhase | null;
    onChange: (phase: NotePhase | null) => void;
  };
  /** The text an empty draft starts with. */
  seed?: string;
  draftKey?: string;
  onDone: (noteId: string | null) => void;
  ref?: Ref<InlineNoteComposerHandle>;
  className?: string;
}) {
  const { actions } = useDatapad();
  const id = useId();
  const pickerName = useId();
  const [text, setText] = useState('');
  /** The id the note will have, known before it is added. */
  const noteId = useRef(newId());
  const commands = useNoteCommands(fields.projectId, noteId.current);

  const focus = () => {
    // After the frame: a menu that opened this hands focus back first.
    requestAnimationFrame(() => {
      const area = document.getElementById(id) as HTMLTextAreaElement | null;
      if (!area) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(area.value.length, area.value.length);
      area.scrollIntoView({ block: 'nearest' });
    });
  };
  useImperativeHandle(ref, () => ({ focus }));

  // A restored draft (NoteComposer's mount effect runs first) wins over
  // the seed; after that the seed follows the phase while untouched.
  const lastSeed = useRef('');
  useEffect(() => {
    const previous = lastSeed.current;
    lastSeed.current = seed;
    setText((t) => (t === '' || t === previous ? seed : t));
  }, [seed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only
  useEffect(focus, []);

  // Left without Save or Cancel (another page, a reload): keep what was
  // written, but not a draft that is only the seed.
  const latest = useRef({ text, seed });
  latest.current = { text, seed };
  useEffect(
    () => () => {
      const { text: t, seed: s } = latest.current;
      if (t.trim() === s.trim()) dropDraft(draftKey);
    },
    [draftKey],
  );

  const save = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    const sent = phase ? { ...fields, phase: phase.value } : fields;
    if (actions.addNote({ ...sent, id: noteId.current, body }) === null) {
      return;
    }
    const added = noteId.current;
    noteId.current = newId();
    setText('');
    dropDraft(draftKey);
    onDone(added);
  };

  const cancel = () => {
    setText('');
    dropDraft(draftKey);
    onDone(null);
  };

  return (
    <fieldset
      className={cn('enter flex min-w-0 flex-col gap-2', className)}
      onKeyDown={(e) => {
        // Esc closes it, unless the composer's menu took it first.
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
    >
      <legend className="sr-only">{label}</legend>
      {phase && (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Kind of note</legend>
          <span className="flex border">
            {PHASE_OPTIONS.map((o) => (
              <label
                key={o.label}
                className={cn(
                  'press flex min-h-11 cursor-pointer items-center px-3 text-xs font-medium text-muted-foreground has-checked:bg-accent has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring hover:text-foreground desk:min-h-8',
                )}
              >
                <input
                  type="radio"
                  name={pickerName}
                  className="sr-only"
                  checked={phase.value === o.value}
                  onChange={() => phase.onChange(o.value)}
                />
                {o.label}
              </label>
            ))}
          </span>
        </fieldset>
      )}
      <NoteComposer
        id={id}
        value={text}
        onChange={setText}
        people={people}
        label={label}
        placeholder="Write a note. / for styles, @ to mention"
        draftKey={draftKey}
        onSubmit={save}
        data={{
          'data-meeting': fields.meetingId ?? undefined,
          'data-phase': phase ? (phase.value ?? 'note') : undefined,
        }}
        {...commands}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="press h-11 desk:h-8"
          onClick={cancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="press h-11 desk:h-8"
          disabled={!text.trim()}
          onClick={save}
        >
          <PlusIcon />
          Save note
        </Button>
      </div>
    </fieldset>
  );
}
