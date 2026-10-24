import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { TemplateTask } from '#shared/types';
import { TemplateForm } from '@/components/templates/TemplateForm';
import { useDatapad } from '@/hooks/useDatapad';

interface Preset {
  name?: string;
  defaultTags?: string[];
  tasks?: TemplateTask[];
}

type Session =
  | { kind: 'edit'; key: number; id: string; open: boolean }
  | { kind: 'new'; key: number; preset?: Preset; open: boolean };

interface TemplateForms {
  openTemplate: (id: string) => void;
  newTemplate: (preset?: Preset) => void;
}

const Context = createContext<TemplateForms | null>(null);

/** One template panel for the app (Settings, Save as template). */
export function TemplateFormProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const [session, setSession] = useState<Session | null>(null);
  const openTemplate = useCallback((id: string) => {
    setSession({ kind: 'edit', key: Date.now(), id, open: true });
  }, []);
  const newTemplate = useCallback((preset?: Preset) => {
    setSession({ kind: 'new', key: Date.now(), preset, open: true });
  }, []);
  const value = useMemo(
    () => ({ openTemplate, newTemplate }),
    [openTemplate, newTemplate],
  );
  const close = () => setSession((s) => (s ? { ...s, open: false } : s));
  const exited = () => setSession((s) => (s?.open ? s : null));
  const template =
    session?.kind === 'edit' ? state?.templates[session.id] : undefined;
  return (
    <Context.Provider value={value}>
      {children}
      {session?.kind === 'edit' && template && (
        <TemplateForm
          key={session.key}
          template={template}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
      {session?.kind === 'new' && (
        <TemplateForm
          key={session.key}
          preset={session.preset}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
    </Context.Provider>
  );
}

export function useTemplateForm(): TemplateForms {
  const value = useContext(Context);
  if (!value) throw new Error('useTemplateForm needs TemplateFormProvider');
  return value;
}
