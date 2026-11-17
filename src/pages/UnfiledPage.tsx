import { PlusIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { mentionedIds, namesToTokens } from '#shared/mentions';
import { unfiledNotes } from '#shared/notes';
import { NoteComposer } from '@/components/NoteComposer';
import { useNotes } from '@/components/notes/NotesProvider';
import { useNoteCommands } from '@/components/notes/useNoteCommands';
import { Button } from '@/components/ui/button';
import { UnfiledBlock } from '@/components/unfiled/UnfiledBlock';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { newId } from '@/lib/ids';
import { keyFor } from '@/lib/spaces';
import { useSpaces } from '@/providers/DatapadProvider';
import { useToast } from '@/providers/ToastProvider';

/** Where the writing area keeps its unsaved draft (per space). */
const DRAFT_KEY = 'datapad:draft:unfiled';

/**
 * Unfiled (`/unfiled`, #333): one running pad of notes with no home,
 * newest first. It replaces the Notepad. The writing area on top uses
 * the full composer; ⌘Enter or Add block makes a General note, which
 * lands at the top. Each block below can be filed, made a task, marked
 * to decide, edited or deleted (`UnfiledBlock`).
 */
export function UnfiledPage() {
  usePageTitle('Unfiled');
  const { state, actions } = useDatapad();
  const { current } = useSpaces();
  const { hidden } = useNotes();
  const { show } = useToast();
  const commands = useNoteCommands(null);
  const [text, setText] = useState('');
  /** The id the next block will have, known before it is added. */
  const nextId = useRef(newId());
  const notes = useMemo(
    () => unfiledNotes(state?.notes ?? {}, hidden),
    [state?.notes, hidden],
  );
  const people = state?.people ?? {};

  const add = () => {
    const body = namesToTokens(text, people).trim();
    if (!body) return;
    if (
      actions.addNote({ id: nextId.current, projectId: null, body }) === null
    ) {
      return;
    }
    nextId.current = newId();
    setText('');
    // A mention gives it a home: say where it went, since it is not here.
    if (mentionedIds(body).length > 0) {
      show('Added the note. It mentions someone, so it is filed.');
    }
  };

  return (
    <section
      aria-labelledby="unfiled-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1 id="unfiled-title" className="text-page-title">
          Unfiled
        </h1>
        <p className="text-sm text-muted-foreground">
          Write first, file later. Notes with no project, meeting, task or
          person land here.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <NoteComposer
          value={text}
          onChange={setText}
          people={people}
          label="New block"
          placeholder="Write a block. ⌘Enter adds it. / for styles, @ to mention"
          draftKey={keyFor(DRAFT_KEY, current.id)}
          onSubmit={add}
          rows={4}
          {...commands}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            className="press h-11 desk:h-8"
            disabled={!text.trim()}
            onClick={add}
          >
            <PlusIcon />
            Add block
          </Button>
        </div>
      </div>

      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-state">Nothing unfiled.</p>
      ) : (
        <ul aria-label="Unfiled notes" className="flex flex-col gap-3">
          {notes.map((n) => (
            <UnfiledBlock key={n.id} note={n} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}
