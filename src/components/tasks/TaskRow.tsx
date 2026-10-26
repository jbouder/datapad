import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  NoteIcon,
} from '@phosphor-icons/react';
import { memo, useState } from 'react';
import {
  blockedOf,
  PRIORITIES,
  type Priority,
  type Snapshot,
  type Task,
} from '#shared/types';
import { Initials } from '@/components/Initials';
import { DatePicker } from '@/components/inputs/DatePicker';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { useBlocked } from '@/components/tasks/BlockedProvider';
import { DueDate } from '@/components/tasks/DueDate';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  /** Manual order (project page, open tasks): handle, menu, controls. */
  reorder?: RowReorder;
  /** A select box for bulk actions (Shift extends a range). */
  select?: { selected: boolean; onToggle: (range: boolean) => void };
  /** How many running notes it has (`taskNoteCounts`); none shows nothing. */
  noteCount?: number;
}

export interface RowReorder {
  index: number;
  count: number;
  /** Move this row to `to` (0-based). */
  move: (to: number) => void;
  /** Touch reorder mode: up / down buttons on every row. */
  controls: boolean;
  /** The handle was pressed (mouse: arm drag; touch: long-press). */
  onHandlePointerDown: (event: React.PointerEvent) => void;
}

const POPOVER_TRIGGER =
  'press flex min-h-8 items-center justify-center px-1 outline-ring/50 hover:bg-accent focus-visible:outline-2 data-popup-open:bg-accent';

/** A task's running notes, as a small count; nothing when it has none. */
export function NoteCount({
  count,
  className,
}: {
  count: number | undefined;
  className?: string;
}) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground',
        className,
      )}
      title={count === 1 ? '1 note' : `${count} notes`}
    >
      <NoteIcon aria-hidden />
      <span aria-hidden className="count">
        {count}
      </span>
      <span className="sr-only">
        {count === 1 ? ', 1 note' : `, ${count} notes`}
      </span>
    </span>
  );
}

/**
 * One task, wherever tasks are listed: circular checkbox, priority dot,
 * title (opens the panel), project chip, assignee initials and due date.
 * On desktop the dot, initials and date are buttons with small popovers
 * that save on select; on phones they are plain and the panel edits them.
 * 36px tall on desktop, 44px on phones, and the checkbox is a 44px target
 * on touch.
 */
/**
 * The round close / reopen checkbox: a real checkbox inside a 44px label
 * (36px tall on desktop rows), its mark growing in when it closes.
 */
export function TaskCheck({
  task,
  done,
  onToggle,
  className,
}: {
  task: Task;
  done: boolean;
  onToggle: (task: Task) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'press group/check flex size-11 shrink-0 cursor-pointer items-center justify-center has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-ring desk:h-8.75 desk:w-9',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={`${done ? 'Reopen' : 'Close'} “${task.title}”`}
        data-row-action="complete"
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
  );
}

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
  reorder,
  select,
  noteCount,
}: TaskRowProps) {
  const project = task.projectId ? projects[task.projectId] : undefined;
  const assignee = task.assignee ? people[task.assignee] : undefined;
  const blocked = done ? null : blockedOf(task);
  const waitingOn = blocked?.on ? people[blocked.on] : undefined;
  const blocking = useBlocked();
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
      {reorder && (
        <span
          aria-hidden
          title="Drag to reorder"
          onPointerDown={reorder.onHandlePointerDown}
          className="flex h-11 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing desk:h-8"
        >
          <DotsSixVerticalIcon weight="bold" />
        </span>
      )}
      {select && (
        <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center desk:size-8">
          <input
            type="checkbox"
            checked={select.selected}
            onClick={(e) => select.onToggle(e.shiftKey)}
            onChange={() => {}}
            aria-label={`Select “${task.title}”`}
            className="size-4 accent-foreground"
          />
        </label>
      )}
      {/* With a select box first, completing moves to the end of the row
          so the two boxes never sit side by side (owner's call). */}
      {!select && <TaskCheck task={task} done={done} onToggle={onToggle} />}

      {onEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            data-row-action="priority"
            className={cn(POPOVER_TRIGGER, 'hidden size-8 desk:flex')}
            aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}. Change`}
          >
            <PriorityDot priority={task.priority} labeled={false} />
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
                  <PriorityDot priority={p} labeled={false} />
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
            data-task-title
            data-row-focus
            data-row-action="open"
            onClick={() => onOpen(task)}
            className="max-w-full truncate text-left outline-ring/50 hover:underline focus-visible:outline-2"
          >
            {task.title}
          </button>
        ) : (
          task.title
        )}
      </span>

      <NoteCount count={noteCount} className="px-1" />

      {blocked && (
        <button
          type="button"
          onClick={() => blocking.editBlocked(task)}
          title={blocked.note || undefined}
          className={cn(POPOVER_TRIGGER, 'shrink-0 gap-1 text-warn')}
        >
          <LockSimpleIcon weight="bold" aria-hidden />
          {waitingOn && (
            <span aria-hidden>
              <Initials person={waitingOn} />
            </span>
          )}
          <span className="sr-only">
            Blocked{waitingOn ? ` on ${waitingOn.name}` : ''}
            {blocked.note ? `: ${blocked.note}` : ''}. Change
          </span>
        </button>
      )}
      {!done && (
        // `b` presses this (src/lib/shortcuts.ts); the ⋯ menu is the
        // pointer and screen-reader way.
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-row-action="blocked"
          onClick={() => blocking.toggleBlocked(task)}
          className="sr-only"
        />
      )}

      {showProject && (
        <span className="hidden max-w-40 shrink-0 truncate border px-1.5 py-0.5 text-xs text-muted-foreground desk:inline">
          {project?.name ?? 'General'}
        </span>
      )}

      {onEdit ? (
        <Popover open={whoOpen} onOpenChange={setWhoOpen}>
          <PopoverTrigger
            data-row-action="assignee"
            className={cn(POPOVER_TRIGGER, 'hidden min-w-8 desk:flex')}
          >
            {/* The name includes what is shown (WCAG 2.5.3). */}
            <span className="sr-only">Assignee: </span>
            {assignee ? (
              <Initials person={assignee} />
            ) : (
              <>
                <span aria-hidden className="size-6 border border-dashed" />
                <span className="sr-only">Unassigned</span>
              </>
            )}
            <span className="sr-only">, change</span>
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
            data-row-action="due"
            className={cn(POPOVER_TRIGGER, 'hidden min-w-8 desk:flex')}
          >
            {task.due ? (
              <>
                <span className="sr-only">Due: </span>
                <DueDate due={task.due} today={today} done={done} />
                <span className="sr-only">, change</span>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">Due…</span>
                <span className="sr-only"> set a due date</span>
              </>
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
      {select && <TaskCheck task={task} done={done} onToggle={onToggle} />}

      {reorder?.controls && (
        <span className="flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="press size-11"
            disabled={reorder.index === 0}
            onClick={() => reorder.move(reorder.index - 1)}
          >
            <ArrowUpIcon />
            <span className="sr-only">Move “{task.title}” up</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="press size-11"
            disabled={reorder.index === reorder.count - 1}
            onClick={() => reorder.move(reorder.index + 1)}
          >
            <ArrowDownIcon />
            <span className="sr-only">Move “{task.title}” down</span>
          </Button>
        </span>
      )}

      {(reorder || !done) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(POPOVER_TRIGGER, 'size-11 desk:size-8')}
            aria-label={`More for “${task.title}”`}
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {onOpen && (
              <DropdownMenuItem onClick={() => onOpen(task)}>
                Open
              </DropdownMenuItem>
            )}
            {!done && (
              <DropdownMenuItem onClick={() => blocking.editBlocked(task)}>
                {blocked ? 'Edit blocked…' : 'Mark blocked…'}
              </DropdownMenuItem>
            )}
            {blocked && (
              <DropdownMenuItem onClick={() => blocking.unblock(task)}>
                Unblock
              </DropdownMenuItem>
            )}
            {reorder && (
              <>
                <DropdownMenuItem
                  disabled={reorder.index === 0}
                  onClick={() => reorder.move(reorder.index - 1)}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={reorder.index === reorder.count - 1}
                  onClick={() => reorder.move(reorder.index + 1)}
                >
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={reorder.index === 0}
                  onClick={() => reorder.move(0)}
                >
                  Move to top
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});
