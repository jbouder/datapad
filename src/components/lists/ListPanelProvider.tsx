import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { ListPanel, type ListPanelFor } from '@/components/lists/ListPanel';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';

interface ListPanels {
  /** Open the list panel for a new list (preset project) or one to edit. */
  openPanel: (of: ListPanelFor) => void;
  /**
   * An item's Make task (#301): the new-task panel, preset to the item's
   * text and the list's project, its toast offering Open. Here rather
   * than in the item's menu so the list page's chunk does not pull the
   * task panel out of the entry.
   */
  makeTask: (text: string, projectId: string | null) => void;
}

const Context = createContext<ListPanels | null>(null);

/**
 * The list panel (#300) lives here, one for the app: the Lists page, a
 * list's page, the project page's Lists section, the top bar's +, ⌘K and
 * `Shift+L` open it. Each opening is a fresh form.
 */
export function ListPanelProvider({ children }: { children: ReactNode }) {
  const { newTask } = useTaskPanels();
  const [session, setSession] = useState<{
    key: number;
    of: ListPanelFor;
    open: boolean;
  } | null>(null);
  const openPanel = useCallback(
    (of: ListPanelFor) =>
      setSession((s) => ({ key: (s?.key ?? 0) + 1, of, open: true })),
    [],
  );
  const makeTask = useCallback(
    (text: string, projectId: string | null) =>
      newTask(projectId, { title: text, offerOpen: true }),
    [newTask],
  );
  const value = useMemo(() => ({ openPanel, makeTask }), [openPanel, makeTask]);
  return (
    <Context.Provider value={value}>
      {children}
      {session && (
        <ListPanel
          key={session.key}
          of={session.of}
          open={session.open}
          onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
          onExited={() => setSession((s) => (s?.open ? s : null))}
        />
      )}
    </Context.Provider>
  );
}

export function useListPanel(): ListPanels {
  const value = useContext(Context);
  if (!value) throw new Error('useListPanel needs ListPanelProvider');
  return value;
}
