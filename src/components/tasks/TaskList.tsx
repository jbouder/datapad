import { useCallback, useRef } from 'react';
import { localDate } from '#shared/dates';
import type { Task } from '#shared/types';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { useMotion } from '@/providers/MotionProvider';

/**
 * Open tasks, then a collapsible Done section, with an optional quick-add
 * on top. Rows FLIP between the two lists when a task closes or reopens
 * (and when another device reorders them). Used by Focus and the project
 * page; the Tasks view has its own table.
 */
export function TaskList({
  label,
  open,
  done,
  quickAdd,
  showProject = true,
  doneKey,
  onOpen,
  empty = 'No open tasks.',
}: {
  /** Names the open list for assistive tech ("Open tasks"). */
  label: string;
  open: Task[];
  /** Omit to leave the Done section out (Focus). */
  done?: Task[];
  quickAdd?: {
    onAdd: (title: string) => boolean;
    projectId?: string | null;
    onProjectChange?: (projectId: string | null) => void;
  };
  showProject?: boolean;
  /** localStorage key for the Done section's open state. */
  doneKey?: string;
  onOpen?: TaskRowProps['onOpen'];
  empty?: string;
}) {
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { active } = useMotion();
  const { toggle, isDone } = useTaskToggle();
  const container = useRef<HTMLDivElement>(null);
  useFlip(container, active);
  const today = localDate(new Date());

  const onEdit = useCallback<NonNullable<TaskRowProps['onEdit']>>(
    (task, patch) => {
      actions.editTask({ id: task.id, patch });
    },
    [actions],
  );

  const openFromRow = useCallback(
    (task: Task) => openTask(task.id),
    [openTask],
  );

  if (!state) return null;
  const row = (task: Task) => (
    <li key={task.id} data-flip-id={task.id}>
      <TaskRow
        task={task}
        done={isDone(task)}
        today={today}
        projects={state.projects}
        people={state.people}
        showProject={showProject}
        onToggle={toggle}
        onOpen={onOpen ?? openFromRow}
        onEdit={onEdit}
      />
    </li>
  );

  return (
    <div ref={container} className="flex flex-col gap-3">
      {quickAdd && (
        <QuickAdd
          onAdd={quickAdd.onAdd}
          projectId={quickAdd.projectId}
          onProjectChange={quickAdd.onProjectChange}
        />
      )}
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-label={label} className="flex flex-col border-t">
          {open.map(row)}
        </ul>
      )}
      {done && done.length > 0 && (
        <Section
          title="Done"
          count={done.length}
          storageKey={doneKey}
          defaultOpen={false}
        >
          <ul aria-label="Done tasks" className="flex flex-col border-t">
            {done.map(row)}
          </ul>
        </Section>
      )}
    </div>
  );
}
