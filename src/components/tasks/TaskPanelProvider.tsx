import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { NewTaskPanel, TaskPanel } from '@/components/tasks/TaskPanel';
import { useDatapad } from '@/hooks/useDatapad';

type Session =
  | { kind: 'edit'; key: number; id: string; open: boolean }
  | {
      kind: 'new';
      key: number;
      projectId: string | null;
      preset: NewTaskPreset;
      open: boolean;
    };

/** What a new task starts with besides its project. */
export interface NewTaskPreset {
  title?: string;
  /** An action item of this meeting (in the meeting's project). */
  meetingId?: string;
}

interface TaskPanels {
  openTask: (id: string) => void;
  /** A new task in the project, its title prefilled when given. */
  newTask: (projectId: string | null, preset?: NewTaskPreset) => void;
}

const Context = createContext<TaskPanels | null>(null);

/** One task panel for the app, opened from rows, + and `n`. */
export function TaskPanelProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const [session, setSession] = useState<Session | null>(null);
  const openTask = useCallback((id: string) => {
    setSession({ kind: 'edit', key: Date.now(), id, open: true });
  }, []);
  const newTask = useCallback(
    (projectId: string | null, preset: NewTaskPreset = {}) => {
      setSession({
        kind: 'new',
        key: Date.now(),
        projectId,
        preset,
        open: true,
      });
    },
    [],
  );
  const value = useMemo(() => ({ openTask, newTask }), [openTask, newTask]);
  const close = () => setSession((s) => (s ? { ...s, open: false } : s));
  const exited = () => setSession((s) => (s?.open ? s : null));
  const task = session?.kind === 'edit' ? state?.tasks[session.id] : undefined;

  return (
    <Context.Provider value={value}>
      {children}
      {session?.kind === 'edit' && task && (
        <TaskPanel
          key={session.key}
          task={task}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
      {session?.kind === 'new' && (
        <NewTaskPanel
          key={session.key}
          projectId={session.projectId}
          title={session.preset.title}
          meetingId={session.preset.meetingId}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
    </Context.Provider>
  );
}

export function useTaskPanels(): TaskPanels {
  const value = useContext(Context);
  if (!value) throw new Error('useTaskPanels needs TaskPanelProvider');
  return value;
}
