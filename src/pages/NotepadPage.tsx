import { CaretRightIcon } from '@phosphor-icons/react';
import { Notepad } from '@/components/notes/Notepad';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps } from '@/lib/router';

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
      <div className="flex items-center justify-between gap-2">
        <h1 id="notepad-title" className="text-page-title">
          Notepad
        </h1>
        <a
          {...linkProps({ name: 'notes' })}
          className="press flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:min-h-9"
        >
          All notes
          <CaretRightIcon aria-hidden className="size-4" />
        </a>
      </div>
      <Notepad state={state} />
    </section>
  );
}
