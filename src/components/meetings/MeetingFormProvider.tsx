import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  MeetingForm,
  type MeetingPreset,
} from '@/components/meetings/MeetingForm';
import { useDatapad } from '@/hooks/useDatapad';

interface MeetingFormContext {
  /** Edit the meeting with `id`. */
  openMeeting: (id: string) => void;
  /** A new meeting, with its project and day filled in. */
  newMeeting: (preset: MeetingPreset) => void;
}

const Context = createContext<MeetingFormContext | null>(null);

type Session = { key: number; open: boolean } & (
  | { id: string }
  | { preset: MeetingPreset }
);

/** One meeting form for the app, opened from rows, day cells and Add meeting. */
export function MeetingFormProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  // A new session each time, so the form reads its values afresh.
  const [session, setSession] = useState<Session | null>(null);
  const openMeeting = useCallback((id: string) => {
    setSession({ key: Date.now(), id, open: true });
  }, []);
  const newMeeting = useCallback((preset: MeetingPreset) => {
    setSession({ key: Date.now(), preset, open: true });
  }, []);
  const value = useMemo(
    () => ({ openMeeting, newMeeting }),
    [openMeeting, newMeeting],
  );
  const meeting =
    session && 'id' in session ? state?.meetings[session.id] : undefined;

  return (
    <Context.Provider value={value}>
      {children}
      {session && ('preset' in session || meeting) && (
        <MeetingForm
          key={session.key}
          meeting={meeting}
          preset={'preset' in session ? session.preset : undefined}
          open={session.open}
          onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
          onExited={() => setSession((s) => (s?.open ? s : null))}
        />
      )}
    </Context.Provider>
  );
}

export function useMeetingForm(): MeetingFormContext {
  const value = useContext(Context);
  if (!value) throw new Error('useMeetingForm needs MeetingFormProvider');
  return value;
}
