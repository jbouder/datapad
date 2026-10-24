import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { useDatapad } from '@/hooks/useDatapad';

interface ProjectFormContext {
  /** Open the form: a new project, or the one with `id`. */
  openProjectForm: (id?: string) => void;
}

const Context = createContext<ProjectFormContext | null>(null);

/** One project form for the app, opened from wherever. */
export function ProjectFormProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  // A new session each time, so the form reads its values afresh.
  const [session, setSession] = useState<{
    key: number;
    id?: string;
    open: boolean;
  } | null>(null);
  const openProjectForm = useCallback((id?: string) => {
    setSession({ key: Date.now(), id, open: true });
  }, []);
  const value = useMemo(() => ({ openProjectForm }), [openProjectForm]);
  const project = session?.id ? state?.projects[session.id] : undefined;

  return (
    <Context.Provider value={value}>
      {children}
      {session && (!session.id || project) && (
        <ProjectForm
          key={session.key}
          project={project}
          open={session.open}
          onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
          onExited={() => setSession((s) => (s?.open ? s : null))}
        />
      )}
    </Context.Provider>
  );
}

export function useProjectForm(): ProjectFormContext {
  const value = useContext(Context);
  if (!value) throw new Error('useProjectForm needs ProjectFormProvider');
  return value;
}
