import { CheckIcon } from '@phosphor-icons/react';
import { memo, useState } from 'react';
import {
  PRIORITIES,
  type Priority,
  type Snapshot,
  type Task,
} from '#shared/types';
import { Initials } from '@/components/Initials';
import { DatePicker } from '@/components/inputs/DatePicker';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { DueDate } from '@/components/tasks/DueDate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface TaskRowProps {
  task: Task;
  /** Shown done (the check may be animating ahead of the data). */
  done: boolean;
  today: string;
  projects: Snapshot['projects'];
  people: Snapshot['people'];
  /** Show the project chip (desktop only; not when grouped by project). */
  showProject?: boolean;
  onToggle: (task: Task) => void;
  /** Open the task panel; without it the title is plain text. */
  onOpen?: (task: Task) => void;
  /** Save a field from an inline popover (logs "Edited task"). */
  onEdit?: (
    task: Task,
    patch: Partial<Pick<Task, 'priority' | 'due' | 'assignee'>>,
  ) => void;
}

const POPOVER_TRIGGER =
  'press flex min-h-8 items-center justify-center px-1 outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent';

/**
 * One task, wherever tasks are listed: circular checkbox, priority dot,
 * title (opens the panel), project chip, assignee initials and due date.
 * On desktop the dot, initials and date are buttons with small popovers
 * that save on select; on phones they are plain and the panel edits them.
 * 36px tall on desktop, 44px on phones, and the checkbox is a 44px target
 * on touch.
 */
export const TaskRow = memo(function TaskRow({
  task,
  done,
  today,
  projects,
  people,
  showProject = true,
  onToggle,
  onOpen,
  onEdit,
}: TaskRowProps) {
  const project = task.projectId ? projects[task.projectId] : undefined;
  const assignee = task.assignee ? people[task.assignee] : undefined;
  const [dueOpen, setDueOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);

  return (
    <div
      className={cn(
        'row group/row flex items-center gap-1 border-b pr-1 text-sm',
        done && 'text-muted-foreground',
      )}
      data-task-id={task.id}
    >
      <label className="press group/check flex size-11 shrink-0 cursor-pointer items-center justify-center has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-ring desk:h-8.75 desk:w-9">
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggle(task)}
          aria-label={`${done ? 'Reopen' : 'Close'} “${task.title}”`}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'task-check flex size-4.5 items-center justify-center rounded-full border-[1.5px] border-muted-foreground/70 group-hover/check:border-foreground',
            done && 'is-done border-ok bg-ok text-ok-foreground',
          )}
        >
          <CheckIcon weight="bold" className="task-check-mark size-3" />
        </span>
      </label>

      {onEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(POPOVER_TRIGGER, 'hidden size-8 desk:flex')}
            aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}. Change`}
          >
            <PriorityDot priority={task.priority} labelled={false} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuRadioGroup
              value={task.priority}
              onValueChange={(value) =>
                onEdit(task, { priority: value as Priority })
              }
            >
              {[...PRIORITIES].reverse().map((p) => (
                <DropdownMenuRadioItem key={p} value={p} closeOnClick>
                  <PriorityDot priority={p} labelled={false} />
                  {PRIORITY_LABELS[p]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <PriorityDot
        priority={task.priority}
        className={cn('w-4 justify-center', onEdit && 'desk:hidden')}
      />

      <span
        className={cn(
          'min-w-0 flex-1 truncate px-1',
          done && 'line-through decoration-muted-foreground/60',
        )}
      >
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="max-w-full truncate text-left outline-ring/50 hover:underline focus-visible:outline-2"
          >
            {task.title}
          </button>
        ) : (
          task.title
        )}
      </span>

      {showProject && (
        <span className="hidden max-w-40 shrink-0 truncate border px-1.5 py-0.5 text-xs text-muted-foreground desk:inline">
          {project?.name ?? 'General'}
        </span>
      )}

      {onEdit ? (
        <Popover open={whoOpen} onOpenChange={setWhoOpen}>
          <PopoverTrigger
            className={cn(POPOVER_TRIGGER, 'hidden min-w-8 desk:flex')}
            aria-label={`Assignee: ${assignee?.name ?? 'Unassigned'}. Change`}
          >
            {assignee ? (
              <Initials person={assignee} />
            ) : (
              <span aria-hidden className="size-6 border border-dashed" />
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <PersonPicker
              aria-label="Assignee"
              value={task.assignee}
              onChange={(id) => {
                setWhoOpen(false);
                if (id !== task.assignee) onEdit(task, { assignee: id });
              }}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {assignee && (
        <Initials person={assignee} className={cn(onEdit && 'desk:hidden')} />
      )}

      {onEdit ? (
        <Popover open={dueOpen} onOpenChange={setDueOpen}>
          <PopoverTrigger
            className={cn(POPOVER_TRIGGER, 'hidden min-w-8 desk:flex')}
            aria-label={`Due: ${task.due || 'no date'}. Change`}
          >
            {task.due ? (
              <DueDate due={task.due} today={today} done={done} />
            ) : (
              <span className="text-xs text-muted-foreground/60">Due…</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <DatePicker
              label="Due"
              value={task.due}
              autoFocus
              onChange={(due) => {
                setDueOpen(false);
                onEdit(task, { due });
              }}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {task.due && (
        <DueDate
          due={task.due}
          today={today}
          done={done}
          className={cn('px-1', onEdit && 'desk:hidden')}
        />
      )}
    </div>
  );
});
