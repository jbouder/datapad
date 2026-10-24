import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CheckIcon,
  FolderIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { Op } from '#shared/protocol';
import type { Task } from '#shared/types';
import { DatePicker } from '@/components/inputs/DatePicker';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

const plural = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

/**
 * What to do with the selected tasks: close or reopen, move, assign, set
 * the due date, delete. Each action is one `batch` op (all or nothing),
 * and its toast's Undo puts every task back as it was.
 */
export function BulkBar({
  tasks,
  onDone,
}: {
  tasks: Task[];
  /** Clear the selection. */
  onDone: () => void;
}) {
  const { actions } = useDatapad();
  const { show } = useToast();
  const [open, setOpen] = useState<'move' | 'assign' | 'due' | null>(null);

  const run = (ops: Op[], message: string) => {
    if (ops.length === 0) return;
    const before = tasks;
    if (!actions.batch({ ops: ops as Extract<Op, { type: 'batch' }>['ops'] }))
      return;
    setOpen(null);
    onDone();
    show(message, () => {
      actions.batch({
        ops: before.map((doc) => ({ type: 'put', col: 'tasks', doc })),
      });
    });
  };

  const openOnes = tasks.filter((t) => t.status === 'open');
  const doneOnes = tasks.filter((t) => t.status === 'done');

  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="fixed inset-x-0 bottom-[calc(1rem+var(--tabbar-height)+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[min(calc(100%-2rem),44rem)] flex-wrap items-center gap-1 border bg-popover p-2 text-popover-foreground shadow-lg"
    >
      <p role="status" className="px-2 text-sm font-medium">
        {plural(tasks.length)} selected
      </p>
      <span className="flex-1" />
      {openOnes.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="press"
          onClick={() =>
            run(
              openOnes.map((t) => ({
                type: 'toggleTask',
                id: t.id,
                done: true,
              })),
              `Closed ${plural(openOnes.length)}`,
            )
          }
        >
          <CheckIcon />
          Close
        </Button>
      )}
      {doneOnes.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="press"
          onClick={() =>
            run(
              doneOnes.map((t) => ({
                type: 'toggleTask',
                id: t.id,
                done: false,
              })),
              `Reopened ${plural(doneOnes.length)}`,
            )
          }
        >
          <ArrowCounterClockwiseIcon />
          Reopen
        </Button>
      )}
      <Popover
        open={open === 'move'}
        onOpenChange={(o) => setOpen(o ? 'move' : null)}
      >
        <PopoverTrigger
          render={<Button variant="ghost" size="sm" className="press" />}
        >
          <FolderIcon />
          Move…
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          <ProjectPicker
            aria-label="Move to project"
            value={null}
            onChange={(projectId) =>
              run(
                tasks
                  .filter((t) => t.projectId !== projectId)
                  .map((t) => ({ type: 'moveTask', id: t.id, projectId })),
                `Moved ${plural(tasks.length)}`,
              )
            }
          />
        </PopoverContent>
      </Popover>
      <Popover
        open={open === 'assign'}
        onOpenChange={(o) => setOpen(o ? 'assign' : null)}
      >
        <PopoverTrigger
          render={<Button variant="ghost" size="sm" className="press" />}
        >
          <UserIcon />
          Assign…
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          <PersonPicker
            aria-label="Assign to"
            value=""
            onChange={(assignee) =>
              run(
                tasks
                  .filter((t) => t.assignee !== assignee)
                  .map((t) => ({
                    type: 'editTask',
                    id: t.id,
                    patch: { assignee },
                  })),
                `Assigned ${plural(tasks.length)}`,
              )
            }
          />
        </PopoverContent>
      </Popover>
      <Popover
        open={open === 'due'}
        onOpenChange={(o) => setOpen(o ? 'due' : null)}
      >
        <PopoverTrigger
          render={<Button variant="ghost" size="sm" className="press" />}
        >
          <CalendarBlankIcon />
          Set due…
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          <DatePicker
            label="Due date for the selected tasks"
            value=""
            autoFocus
            onChange={(due) =>
              run(
                tasks
                  .filter((t) => t.due !== due)
                  .map((t) => ({ type: 'editTask', id: t.id, patch: { due } })),
                due
                  ? `Set ${plural(tasks.length)} due ${due}`
                  : `Cleared the due date on ${plural(tasks.length)}`,
              )
            }
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="sm"
        className="press text-destructive"
        onClick={() =>
          run(
            tasks.map((t) => ({ type: 'deleteTask', id: t.id })),
            `Deleted ${plural(tasks.length)}`,
          )
        }
      >
        <TrashIcon />
        Delete
      </Button>
      <Button variant="ghost" size="icon" className="press" onClick={onDone}>
        <XIcon />
        <span className="sr-only">Clear selection (Esc)</span>
      </Button>
    </div>
  );
}
