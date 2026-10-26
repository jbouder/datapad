import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Meeting, NotePhase } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { navigate } from '@/lib/router';

/** A Prep or Debrief note waiting for a composer. */
export interface MeetingNoteIntent {
  meetingId: string;
  phase: NotePhase;
}

/** A composer on the page that can take a Prep or Debrief note. */
export interface NoteTarget {
  /** Its fixed project (null = General), or undefined: it has a picker. */
  projectId: string | null | undefined;
  prefill: (meeting: Meeting, phase: NotePhase) => void;
}

interface MeetingNotes {
  /** Prep or Debrief: prefill a composer here, or go where there is one. */
  startNote: (meeting: Meeting, phase: NotePhase) => void;
  /** A composer announces itself; the return value withdraws it. */
  register: (target: NoteTarget) => () => void;
  /** Parked by `startNote` until a composer for it mounts. */
  pending: MeetingNoteIntent | null;
  clearPending: () => void;
}

const Context = createContext<MeetingNotes | null>(null);

export function accepts(target: NoteTarget, meeting: Meeting): boolean {
  return (
    target.projectId === undefined || target.projectId === meeting.projectId
  );
}

/**
 * The route from a meeting's Prep note / Debrief note to a composer
 * (docs/SPEC.md § Meetings and notes linkage). A composer on this page that
 * can take the meeting's project is prefilled in place; otherwise the
 * intent is parked as `pending` and the app goes to the meeting's project
 * (Notes for General), whose composer applies it on arrival.
 */
export function MeetingNotesProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const targets = useRef<NoteTarget[]>([]);
  const [pending, setPending] = useState<MeetingNoteIntent | null>(null);
  const projects = useRef(state?.projects);
  projects.current = state?.projects;

  const register = useCallback((target: NoteTarget) => {
    targets.current = [...targets.current, target];
    return () => {
      targets.current = targets.current.filter((t) => t !== target);
    };
  }, []);

  const startNote = useCallback((meeting: Meeting, phase: NotePhase) => {
    // A composer bound to the meeting's project beats one with a picker.
    const here =
      targets.current.find((t) => t.projectId === meeting.projectId) ??
      targets.current.find((t) => accepts(t, meeting));
    if (here) {
      here.prefill(meeting, phase);
      return;
    }
    setPending({ meetingId: meeting.id, phase });
    if (meeting.projectId && projects.current?.[meeting.projectId]) {
      navigate({ name: 'project', id: meeting.projectId });
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

export function useMeetingNotes(): MeetingNotes {
  const value = useContext(Context);
  if (!value) throw new Error('useMeetingNotes needs MeetingNotesProvider');
  return value;
}
