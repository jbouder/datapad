import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Note } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { useRoute } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/** How long Undo is offered, matching the toast. */
const UNDO_MS = 5000;

interface Notes {
  /** Notes deleted but still undoable: hidden everywhere until then. */
  hidden: ReadonlySet<string>;
  /** Hide the note, toast with Undo, and delete it for real afterwards. */
  removeNote: (note: Note) => void;
}

const Context = createContext<Notes | null>(null);

/**
 * Deleting a note waits for its Undo: the note disappears at once, and
 * `deleteNote` (which logs "Deleted a note") goes out when the toast
 * ends, when you move to another page, or when the tab goes away. Undo
 * before then changes nothing at all.
 */
export function NotesProvider({ children }: { children: ReactNode }) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const route = useRoute();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());

  const commit = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timers.current.delete(id);
      actions.deleteNote({ id });
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      });
    },
    [actions],
  );

  const commitAll = useCallback(() => {
    for (const id of [...timers.current.keys()]) commit(id);
  }, [commit]);

  const removeNote = useCallback(
    (note: Note) => {
      setHidden((h) => new Set(h).add(note.id));
      timers.current.set(
        note.id,
        window.setTimeout(() => commit(note.id), UNDO_MS),
      );
      show('Deleted the note', () => {
        const timer = timers.current.get(note.id);
        if (timer !== undefined) window.clearTimeout(timer);
        timers.current.delete(note.id);
        setHidden((h) => {
          const next = new Set(h);
          next.delete(note.id);
          return next;
        });
      });
    },
    [commit, show],
  );

  // Leaving the page settles it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every route change
  useEffect(() => {
    commitAll();
  }, [route]);
  useEffect(() => {
    window.addEventListener('pagehide', commitAll);
    return () => window.removeEventListener('pagehide', commitAll);
  }, [commitAll]);

  const value = useMemo(() => ({ hidden, removeNote }), [hidden, removeNote]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotes(): Notes {
  const value = useContext(Context);
  if (!value) throw new Error('useNotes needs NotesProvider');
  return value;
}
