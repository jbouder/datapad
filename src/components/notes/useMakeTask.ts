import { useCallback } from 'react';
import { defaultAssignee, defaultPriority } from '#shared/tasks';
import type { Note, Snapshot } from '#shared/types';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import type { Route } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/**
 * Make a task from a note: in the note's project, pointing back at it
 * (`sourceNoteId`), with a toast that opens the task. The note itself is
 * not changed. Returns whether the task was made. With `decide`, it is
 * something to decide (#328), as Unfiled's To decide makes (#333).
 */
export function useMakeTask(): (
  note: Note,
  title: string,
  options?: { decide?: boolean },
) => boolean {
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { show } = useToast();
  return useCallback(
    (note, title, options) => {
      const clean = title.trim().slice(0, 200);
      if (!clean) return false;
      const decide = options?.decide === true;
      const id = actions.addTask({
        projectId: note.projectId,
        title: clean,
        sourceNoteId: note.id,
        assignee: state ? defaultAssignee(state) : '',
        priority: state ? defaultPriority(state) : 'med',
        ...(decide ? { decide: true } : {}),
      });
      if (id === null) return false;
      show(
        decide ? `Added “${clean}” to decide` : `Added “${clean}”`,
        undefined,
        {
          label: 'Open',
          run: () => openTask(id),
        },
      );
      return true;
    },
    [state, actions, openTask, show],
  );
}

/**
 * Where a note is shown, with `?note=` to scroll to and highlight it: its
 * project page, or Notes for General (and for a project that is gone).
 */
export function noteLocation(
  note: Note,
  state: Pick<Snapshot, 'projects'>,
): { route: Route; query: string } {
  const query = `note=${encodeURIComponent(note.id)}`;
  return note.projectId && state.projects[note.projectId]
    ? { route: { name: 'project', id: note.projectId }, query }
    : { route: { name: 'all', kind: 'note' }, query };
}
