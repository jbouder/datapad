import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { EventForm, type EventPreset } from '@/components/events/EventForm';
import { useDatapad } from '@/hooks/useDatapad';

interface EventFormContext {
  /** Edit the event with `id`. */
  openEvent: (id: string) => void;
  /** A new event, with its project and day filled in. */
  newEvent: (preset: EventPreset) => void;
}

const Context = createContext<EventFormContext | null>(null);

type Session = { key: number; open: boolean } & (
  | { id: string }
  | { preset: EventPreset }
);

/** One event form for the app, opened from rows, day cells and Add event. */
export function EventFormProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  // A new session each time, so the form reads its values afresh.
  const [session, setSession] = useState<Session | null>(null);
  const openEvent = useCallback((id: string) => {
    setSession({ key: Date.now(), id, open: true });
  }, []);
  const newEvent = useCallback((preset: EventPreset) => {
    setSession({ key: Date.now(), preset, open: true });
  }, []);
  const value = useMemo(() => ({ openEvent, newEvent }), [openEvent, newEvent]);
  const event =
    session && 'id' in session ? state?.meetings[session.id] : undefined;

  return (
    <Context.Provider value={value}>
      {children}
      {session && ('preset' in session || event) && (
        <EventForm
          key={session.key}
          event={event}
          preset={'preset' in session ? session.preset : undefined}
          open={session.open}
          onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
          onExited={() => setSession((s) => (s?.open ? s : null))}
        />
      )}
    </Context.Provider>
  );
}

export function useEventForm(): EventFormContext {
  const value = useContext(Context);
  if (!value) throw new Error('useEventForm needs EventFormProvider');
  return value;
}
