import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { DecisionPanel } from '@/components/decisions/DecisionPanel';
import { useDatapad } from '@/hooks/useDatapad';

type Session =
  | { kind: 'edit'; key: number; id: string; open: boolean }
  | {
      kind: 'new';
      key: number;
      projectId: string | null;
      title?: string;
      open: boolean;
    };

interface DecisionPanels {
  openDecision: (id: string) => void;
  newDecision: (projectId: string | null, title?: string) => void;
}

const Context = createContext<DecisionPanels | null>(null);

/** One decision panel for the app (rows, ⌘K, New decision). */
export function DecisionPanelProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const [session, setSession] = useState<Session | null>(null);
  const openDecision = useCallback((id: string) => {
    setSession({ kind: 'edit', key: Date.now(), id, open: true });
  }, []);
  const newDecision = useCallback(
    (projectId: string | null, title?: string) => {
      setSession({
        kind: 'new',
        key: Date.now(),
        projectId,
        title,
        open: true,
      });
    },
    [],
  );
  const value = useMemo(
    () => ({ openDecision, newDecision }),
    [openDecision, newDecision],
  );
  const close = () => setSession((s) => (s ? { ...s, open: false } : s));
  const exited = () => setSession((s) => (s?.open ? s : null));
  const decision =
    session?.kind === 'edit' ? state?.decisions[session.id] : undefined;

  return (
    <Context.Provider value={value}>
      {children}
      {session?.kind === 'edit' && decision && (
        <DecisionPanel
          key={session.key}
          decision={decision}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
      {session?.kind === 'new' && (
        <DecisionPanel
          key={session.key}
          preset={{ projectId: session.projectId, title: session.title }}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
    </Context.Provider>
  );
}

export function useDecisionPanel(): DecisionPanels {
  const value = useContext(Context);
  if (!value) throw new Error('useDecisionPanel needs DecisionPanelProvider');
  return value;
}
