import { memo } from 'react';
import type { Snapshot, Task } from '#shared/types';
import { DueDate } from '@/components/tasks/DueDate';
import { TaskCheck } from '@/components/tasks/TaskRow';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

/** A row's room and person links: 24px tall, spaced apart (WCAG 2.5.8). */
const META_LINK =
  'inline-flex min-h-6 max-w-full items-center truncate underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';

/**
 * One open loop (#331): its checkbox, its title (opens the task panel),
 * then a line with its room, its person and its due date. `person` is
 * the one to show, or none (the Waiting on lane's group already says
 * who). Narrow enough for Today's side column and a room's lanes.
 */
export const LoopRow = memo(function LoopRow({
  task,
  done,
  today,
  projects,
  person,
  onToggle,
  onOpen,
}: {
  task: Task;
  /** Shown done (the check animates ahead of the data). */
  done: boolean;
  today: string;
  projects: Snapshot['projects'];
  person?: { id: string; name: string };
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const project = task.projectId ? projects[task.projectId] : undefined;
  const hasMeta = Boolean(project || person || task.due);
  return (
    <div
      data-loop={task.id}
      className={cn(
        'flex items-start gap-1 border-b pr-1 text-sm',
        done && 'text-muted-foreground',
      )}
    >
      <TaskCheck task={task} done={done} onToggle={onToggle} />
      <div className="flex min-w-0 flex-1 flex-col desk:py-0.5">
        <button
          type="button"
          data-task-title
          onClick={() => onOpen(task)}
          className={cn(
            'flex min-h-11 items-center text-left outline-ring/50 hover:underline focus-visible:outline-2 desk:min-h-7',
            done && 'line-through decoration-muted-foreground/60',
          )}
        >
          {task.title}
        </button>
        {hasMeta && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 pb-1 text-xs text-muted-foreground">
            {project && (
              <a
                {...linkProps({ name: 'project', id: project.id })}
                className={META_LINK}
              >
                {project.name}
              </a>
            )}
            {person && (
              <a
                {...linkProps({ name: 'person', id: person.id })}
                className={META_LINK}
              >
                {person.name}
              </a>
            )}
            {task.due && (
              <span className="inline-flex min-h-6 items-center">
                <span className="sr-only">Due </span>
                <DueDate due={task.due} today={today} done={done} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
