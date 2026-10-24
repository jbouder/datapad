import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Event, NotePhase } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { navigate } from '@/lib/router';

/** A Prep or Debrief note waiting for a composer. */
export interface EventNoteIntent {
  eventId: string;
  phase: NotePhase;
}

/** A composer on the page that can take a Prep or Debrief note. */
export interface NoteTarget {
  /** Its fixed project (null = General), or undefined: it has a picker. */
  projectId: string | null | undefined;
  prefill: (event: Event, phase: NotePhase) => void;
}

interface EventNotes {
  /** Prep or Debrief: prefill a composer here, or go where there is one. */
  startNote: (event: Event, phase: NotePhase) => void;
  /** A composer announces itself; the return value withdraws it. */
  register: (target: NoteTarget) => () => void;
  /** Parked by `startNote` until a composer for it mounts. */
  pending: EventNoteIntent | null;
  clearPending: () => void;
}

const Context = createContext<EventNotes | null>(null);

export function accepts(target: NoteTarget, event: Event): boolean {
  return target.projectId === undefined || target.projectId === event.projectId;
}

/**
 * The route from an event's Prep note / Debrief note to a composer
 * (docs/SPEC.md § Events and notes linkage). A composer on this page that
 * can take the event's project is prefilled in place; otherwise the
 * intent is parked as `pending` and the app goes to the event's project
 * (Notes for General), whose composer applies it on arrival.
 */
export function EventNotesProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const targets = useRef<NoteTarget[]>([]);
  const [pending, setPending] = useState<EventNoteIntent | null>(null);
  const projects = useRef(state?.projects);
  projects.current = state?.projects;

  const register = useCallback((target: NoteTarget) => {
    targets.current = [...targets.current, target];
    return () => {
      targets.current = targets.current.filter((t) => t !== target);
    };
  }, []);

  const startNote = useCallback((event: Event, phase: NotePhase) => {
    // A composer bound to the event's project beats one with a picker.
    const here =
      targets.current.find((t) => t.projectId === event.projectId) ??
      targets.current.find((t) => accepts(t, event));
    if (here) {
      here.prefill(event, phase);
      return;
    }
    setPending({ eventId: event.id, phase });
    if (event.projectId && projects.current?.[event.projectId]) {
      navigate({ name: 'project', id: event.projectId });
    } else {
      navigate({ name: 'notes' });
    }
  }, []);

  const clearPending = useCallback(() => setPending(null), []);
  const value = useMemo(
    () => ({ startNote, register, pending, clearPending }),
    [startNote, register, pending, clearPending],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useEventNotes(): EventNotes {
  const value = useContext(Context);
  if (!value) throw new Error('useEventNotes needs EventNotesProvider');
  return value;
}
