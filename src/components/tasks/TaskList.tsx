import { useCallback, useEffect, useRef, useState } from 'react';
import { localDate } from '#shared/dates';
import { taskNoteCounts } from '#shared/select';
import type { Task } from '#shared/types';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { type RememberSection, Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import {
  type RowReorder,
  TaskRow,
  type TaskRowProps,
} from '@/components/tasks/TaskRow';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { dropIndex, moveItem } from '@/lib/reorder';
import { cn } from '@/lib/utils';
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
  doneRemember,
  onOpen,
  empty = 'No open tasks.',
  reorderProject,
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
  /** Where the Done section's open or closed is saved. */
  doneRemember?: RememberSection;
  onOpen?: TaskRowProps['onOpen'];
  empty?: string;
  /**
   * The open list's order is manual (a project page): drag on desktop,
   * Alt+↑ / Alt+↓, the row menu, and a long-press reorder mode on touch.
   * `null` is General.
   */
  reorderProject?: string | null;
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

  const reorderable = reorderProject !== undefined;
  const [dragId, setDragId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [touchMode, setTouchMode] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const pressTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  /** Move the open task at `from` to `to`, announce it, keep focus. */
  const move = useCallback(
    (from: number, to: number) => {
      if (reorderProject === undefined || to < 0 || to >= open.length) return;
      if (from === to) return;
      const ids = moveItem(
        open.map((t) => t.id),
        from,
        to,
      );
      const task = open[from];
      if (!task) return;
      if (actions.reorderTasks({ projectId: reorderProject, ids })) {
        setAnnouncement(
          `Moved “${task.title}” to position ${to + 1} of ${open.length}`,
        );
      }
    },
    [actions, open, reorderProject],
  );

  const openFromRow = useCallback(
    (task: Task) => openTask(task.id),
    [openTask],
  );

  if (!state) return null;
  const row = (task: Task, index?: number) => {
    const reorder: RowReorder | undefined =
      reorderable && index !== undefined
        ? {
            index,
            count: open.length,
            move: (to) => move(index, to),
            controls: touchMode,
            onHandlePointerDown: (event) => {
              if (event.pointerType === 'mouse') {
                setArmedId(task.id);
                return;
              }
              // Touch: hold the handle to enter reorder mode.
              window.clearTimeout(pressTimer.current);
              const cancel = () => window.clearTimeout(pressTimer.current);
              event.currentTarget.addEventListener('pointerup', cancel, {
                once: true,
              });
              event.currentTarget.addEventListener('pointercancel', cancel, {
                once: true,
              });
              pressTimer.current = window.setTimeout(() => {
                setTouchMode(true);
                navigator.vibrate?.(10);
              }, 450);
            },
          }
        : undefined;
    return (
      <li
        key={task.id}
        data-flip-id={task.id}
        draggable={reorder ? armedId === task.id : undefined}
        data-drop-before={
          dragId && overIndex === index && dragId !== task.id ? '' : undefined
        }
        className={cn(
          reorder && 'task-drop-target',
          dragId === task.id && 'opacity-50',
        )}
        onKeyDown={
          reorder
            ? (event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  reorder.move(
                    reorder.index + (event.key === 'ArrowUp' ? -1 : 1),
                  );
                }
              }
            : undefined
        }
        onDragStart={
          reorder
            ? (event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', task.id);
                setDragId(task.id);
              }
            : undefined
        }
        onDragOver={
          reorder && dragId
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOverIndex(index ?? null);
              }
            : undefined
        }
        onDragEnd={() => {
          setDragId(null);
          setArmedId(null);
          setOverIndex(null);
        }}
      >
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
          reorder={reorder}
          noteCount={taskNoteCounts(state.notes).get(task.id)}
        />
      </li>
    );
  };

  const drop = () => {
    if (!dragId || overIndex === null) return;
    const from = open.findIndex((t) => t.id === dragId);
    const to = from < 0 ? null : dropIndex(from, overIndex);
    if (to !== null) move(from, to);
  };

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
        <>
          {touchMode && (
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-muted-foreground">
                Reordering: use the arrows on each row.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="press min-h-11"
                onClick={() => setTouchMode(false)}
              >
                Done reordering
              </Button>
            </div>
          )}
          <ul
            aria-label={label}
            className={cn(
              'flex flex-col border-t',
              dragId && overIndex === open.length && 'task-drop-end',
            )}
            onDragOver={
              dragId
                ? (event) => {
                    event.preventDefault();
                    // Below the last row: the end of the list.
                    if (event.target === event.currentTarget) {
                      setOverIndex(open.length);
                    }
                  }
                : undefined
            }
            onDrop={(event) => {
              event.preventDefault();
              drop();
            }}
          >
            {open.map((t, i) => row(t, reorderable ? i : undefined))}
          </ul>
        </>
      )}
      {reorderable && (
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      )}
      {done && done.length > 0 && (
        <Section
          title="Done"
          count={done.length}
          remember={doneRemember}
          defaultOpen={false}
        >
          <ul aria-label="Done tasks" className="flex flex-col border-t">
            {done.map((t) => row(t))}
          </ul>
        </Section>
      )}
    </div>
  );
}
