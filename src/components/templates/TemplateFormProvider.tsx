import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { isNoteTemplate } from '#shared/templates';
import type { TemplateTask } from '#shared/types';
import { NoteTemplateForm } from '@/components/templates/NoteTemplateForm';
import { TemplateForm } from '@/components/templates/TemplateForm';
import { useDatapad } from '@/hooks/useDatapad';

interface Preset {
  name?: string;
  defaultTags?: string[];
  tasks?: TemplateTask[];
}

interface NotePreset {
  name?: string;
  /** Markdown, mentions as `@{personId}`. */
  body?: string;
}

type Session =
  | { kind: 'edit'; key: number; id: string; open: boolean }
  | { kind: 'new'; key: number; preset?: Preset; open: boolean }
  | { kind: 'newNote'; key: number; preset?: NotePreset; open: boolean };

interface TemplateForms {
  openTemplate: (id: string) => void;
  newTemplate: (preset?: Preset) => void;
  newNoteTemplate: (preset?: NotePreset) => void;
}

const Context = createContext<TemplateForms | null>(null);

/**
 * One template panel for the app (Settings, Save as template on a project
 * or a note): the project form or the note form, by the template's kind.
 */
export function TemplateFormProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const [session, setSession] = useState<Session | null>(null);
  const openTemplate = useCallback((id: string) => {
    setSession({ kind: 'edit', key: Date.now(), id, open: true });
  }, []);
  const newTemplate = useCallback((preset?: Preset) => {
    setSession({ kind: 'new', key: Date.now(), preset, open: true });
  }, []);
  const newNoteTemplate = useCallback((preset?: NotePreset) => {
    setSession({ kind: 'newNote', key: Date.now(), preset, open: true });
  }, []);
  const value = useMemo(
    () => ({ openTemplate, newTemplate, newNoteTemplate }),
    [openTemplate, newTemplate, newNoteTemplate],
  );
  const close = () => setSession((s) => (s ? { ...s, open: false } : s));
  const exited = () => setSession((s) => (s?.open ? s : null));
  const template =
    session?.kind === 'edit' ? state?.templates[session.id] : undefined;
  return (
    <Context.Provider value={value}>
      {children}
      {session?.kind === 'edit' && template && isNoteTemplate(template) && (
        <NoteTemplateForm
          key={session.key}
          template={template}
          open={session.open}
          onClose={close}
          onExited={exited}
        />
      )}
      {session?.kind === 'edit' && template && !isNoteTemplate(template) && (
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
      {session?.kind === 'newNote' && (
        <NoteTemplateForm
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
