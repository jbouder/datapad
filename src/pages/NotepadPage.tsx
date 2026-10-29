import { Notepad } from '@/components/notes/Notepad';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The Notepad (#261), a tool: the space's one running note, a full-width
 * composer that saves as you type. Notes' Notepad layout until it got this
 * page; the note is still a General note, first in Notes' List and Grid.
 */
export function NotepadPage() {
  usePageTitle('Notepad');
  const { state } = useDatapad();

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <section
      aria-labelledby="notepad-title"
      className="enter flex flex-col gap-4"
    >
      <h1 id="notepad-title" className="text-page-title">
        Notepad
      </h1>
      <Notepad state={state} />
    </section>
  );
}
