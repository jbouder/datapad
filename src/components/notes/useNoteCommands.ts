import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/** `/task` in a note composer: a task in the note's project. */
export function useNoteCommands(projectId: string | null): {
  onTask: (title: string) => boolean;
} {
  const { actions } = useDatapad();
  const { show } = useToast();
  return {
    onTask: (title) => {
      if (actions.addTask({ projectId, title }) === null) return false;
      show(`Added “${title}”`);
      return true;
    },
  };
}
