import { NotePencilIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { isUnfiled } from '#shared/notes';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Unfiled (`/unfiled`, #329): the notes with no home yet, newest first.
 * It replaces the Notepad. A placeholder until #333 builds the page.
 */
export function UnfiledPage() {
  usePageTitle('Unfiled');
  const { state } = useDatapad();
  const { newNote } = useNotes();
  const notes = useMemo(
    () =>
      Object.values(state?.notes ?? {})
        .filter(isUnfiled)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state?.notes],
  );

  return (
    <section
      aria-labelledby="unfiled-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="unfiled-title" className="text-page-title flex-1">
          Unfiled
        </h1>
        <Button
          variant="outline"
          className="press h-11 desk:h-8"
          onClick={() => newNote(null)}
        >
          <NotePencilIcon />
          Write a note
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Notes with no project, meeting, task or person yet.
      </p>
      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-state">Nothing unfiled.</p>
      ) : (
        <ul aria-label="Unfiled notes" className="flex flex-col gap-2">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}
