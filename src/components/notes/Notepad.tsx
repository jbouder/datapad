import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { notepadOf } from '#shared/notes';
import type { Snapshot } from '#shared/types';
import { NoteComposer } from '@/components/NoteComposer';
import { useNoteCommands } from '@/components/notes/useNoteCommands';
import { useDatapad } from '@/hooks/useDatapad';

/** How long the Notepad waits after the last keystroke before saving. */
export const NOTEPAD_SAVE_MS = 1000;

type Status = 'idle' | 'typing' | 'saved';

const STATUS: Record<Status, string> = {
  idle: 'Saves as you type.',
  typing: 'Saving…',
  saved: 'Saved.',
};

/**
 * Notes' Notepad layout (#218): one running note for the space, written
 * in place with the note composer (`/` styles, `@` mentions, `/task`).
 * It saves itself: `writeNotepad` goes out a second after the last
 * keystroke, and at once on blur, ⌘Enter, leaving the page or hiding the
 * tab. The op is silent in Activity. A change from another device shows
 * when nothing here is waiting to be saved. The note is an ordinary
 * General note too, so List and Grid show it, labelled Notepad.
 */
export function Notepad({ state }: { state: Snapshot }) {
  const { actions } = useDatapad();
  const id = useId();
  const hint = useId();
  const pad = notepadOf(state.notes);
  const remote = pad?.body ?? '';
  const people = state.people;
  const commands = useNoteCommands(null);

  const [text, setText] = useState(() => tokensToNames(remote, people));
  const [status, setStatus] = useState<Status>('idle');
  /** The text as last saved here or last taken from the data, as tokens. */
  const sent = useRef(remote);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ text, people, actions });
  latest.current = { text, people, actions };

  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const { text: now, people: names, actions: act } = latest.current;
    const body = namesToTokens(now, names);
    if (body !== sent.current) {
      sent.current = body;
      act.writeNotepad({ body });
    }
    setStatus('saved');
  }, []);

  // Another device's change, when nothing here waits to be saved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: names are read when the text changes, not when a person does
  useEffect(() => {
    if (dirty.current || remote === sent.current) return;
    sent.current = remote;
    setText(tokensToNames(remote, people));
  }, [remote]);

  // Leaving the page, or the tab going away, saves first.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save]);

  const change = (value: string) => {
    setText(value);
    dirty.current = true;
    setStatus('typing');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, NOTEPAD_SAVE_MS);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles from the composer to save
    <div
      data-notepad={pad?.id ?? ''}
      className="flex min-w-0 flex-col gap-2"
      onBlur={(e) => {
        // Not when focus only moves to the composer's own toolbar.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <NoteComposer
        id={id}
        value={text}
        onChange={change}
        people={people}
        label="Notepad"
        placeholder="Running notes for this space. / for styles, @ to mention."
        aria-describedby={hint}
        onSubmit={save}
        rows={14}
        className="min-h-[50svh] max-h-none bg-card"
        {...commands}
      />
      <p
        id={hint}
        data-notepad-status={status}
        className="text-xs text-muted-foreground"
      >
        {STATUS[status]}
      </p>
    </div>
  );
}
