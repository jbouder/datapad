import { useCallback } from 'react';
import { defaultAssignee, defaultDue, defaultPriority } from '#shared/tasks';
import type { Note, Snapshot } from '#shared/types';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import type { Route } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/**
 * Make a task from a note: in the note's project, pointing back at it
 * (`sourceNoteId`), with a toast that opens the task. The note itself is
 * not changed. A meeting's note makes an action item of that meeting
 * (#336). Returns whether the task was made. With `decide`, it is
 * something to decide (#328), as Scratch's To decide makes (#333).
 */
export function useMakeTask(): (
  note: Note,
  title: string,
  options?: { decide?: boolean },
) => boolean {
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { show } = useToast();
  const today = useToday();
  return useCallback(
    (note, title, options) => {
      const clean = title.trim().slice(0, 200);
      if (!clean) return false;
      const decide = options?.decide === true;
      const id = actions.addTask({
        projectId: note.projectId,
        // From a meeting's note, an action item of that meeting (#336).
        ...(note.meetingId ? { meetingId: note.meetingId } : {}),
        title: clean,
        sourceNoteId: note.id,
        assignee: state ? defaultAssignee(state) : '',
        priority: state ? defaultPriority(state) : 'med',
        due: state ? defaultDue(state, today) : '',
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
    [state, actions, openTask, show, today],
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
    : { route: { name: 'all', kinds: ['note'] }, query };
}
