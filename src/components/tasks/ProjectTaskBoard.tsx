import { KanbanIcon, ListBulletsIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import { localDate } from '#shared/dates';
import type { Op } from '#shared/protocol';
import { DEFAULT_TASK_FILTERS } from '#shared/tasks';
import type { Task } from '#shared/types';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';
import { TaskBoard } from '@/components/tasks/TaskLayouts';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { useToast } from '@/providers/ToastProvider';

export const PROJECT_TASK_VIEWS: readonly ViewOption<'list' | 'board'>[] = [
  { id: 'list', label: 'List', icon: ListBulletsIcon },
  { id: 'board', label: 'Board', icon: KanbanIcon },
];

/** A project's tasks as a board by due date (its List is the TaskList). */
export function ProjectTaskBoard({
  projectId,
  open,
  done,
}: {
  projectId: string;
  open: Task[];
  done: Task[];
}) {
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { show } = useToast();
  const { toggle, isDone } = useTaskToggle();
  const change = useCallback(
    (ops: Op[], before: Task[], message: string) => {
      if (ops.length === 0) {
        show(message);
        return;
      }
      const inner = ops.filter(
        (o): o is Exclude<Op, { type: 'batch' }> => o.type !== 'batch',
      );
      if (!actions.batch({ ops: inner })) return;
      show(message, () =>
        actions.batch({
          ops: before.map((doc) => ({ type: 'put', col: 'tasks', doc })),
        }),
      );
    },
    [actions, show],
  );
  if (!state) return null;
  return (
    <TaskBoard
      groups={[{ id: projectId, label: '', rows: open }]}
      doneTasks={done}
      filters={{ ...DEFAULT_TASK_FILTERS, group: 'due' }}
      state={state}
      today={localDate(new Date())}
      isDone={isDone}
      toggle={toggle}
      openTask={openTask}
      change={change}
    />
  );
}
