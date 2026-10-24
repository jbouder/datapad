import {
  ChartBarHorizontalIcon,
  KanbanIcon,
  ListBulletsIcon,
  TableIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { formatDay, relativeTime } from '#shared/dates';
import type { Op } from '#shared/protocol';
import {
  DUE_BUCKETS,
  type DueBucket,
  dueBucket,
  dueForBucket,
  type TaskFilters,
  type TaskGroup,
} from '#shared/tasks';
import {
  PRIORITIES,
  type Priority,
  type Snapshot,
  type Task,
} from '#shared/types';
import { Board, type BoardColumn } from '@/components/layouts/Board';
import { DataTable, type Selection } from '@/components/layouts/DataTable';
import { Timeline } from '@/components/layouts/Timeline';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { DueDate } from '@/components/tasks/DueDate';
import { TaskCheck, TaskRow } from '@/components/tasks/TaskRow';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type TaskView = 'list' | 'table' | 'board' | 'timeline';

export const TASK_VIEWS: readonly ViewOption<TaskView>[] = [
  { id: 'list', label: 'List', icon: ListBulletsIcon },
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'board', label: 'Board', icon: KanbanIcon },
  { id: 'timeline', label: 'Timeline', icon: ChartBarHorizontalIcon },
];

/** Desktop opens on the table, phones on the list. */
export function defaultTaskView(): TaskView {
  return window.matchMedia('(min-width: 820px)').matches ? 'table' : 'list';
}

export interface TaskLayoutProps {
  groups: TaskGroup[];
  filters: TaskFilters;
  state: Snapshot;
  today: string;
  /** Absent: no select boxes (a project page has no bulk bar). */
  selection?: Selection;
  isDone: (task: Task) => boolean;
  toggle: (task: Task) => void;
  openTask: (id: string) => void;
  /** Run ops as one change; the toast offers Undo (puts the tasks back). */
  change: (ops: Op[], before: Task[], message: string) => void;
  onSort?: (column: string) => void;
}

const project = (state: Snapshot, t: Task) =>
  t.projectId ? (state.projects[t.projectId]?.name ?? 'General') : 'General';

const selectOf = (selection: Selection | undefined, t: Task) =>
  selection
    ? {
        selected: selection.selected.has(t.id),
        onToggle: (range: boolean) => selection.toggle(t.id, range),
      }
    : undefined;

/* ---------- List ---------- */

/** Task rows under group headers, on every screen size. */
export function TaskListLayout(props: TaskLayoutProps) {
  const { groups, filters, state, today, selection, isDone, toggle, openTask } =
    props;
  return (
    <div className="vt-list flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.id}
          aria-label={group.label || 'Tasks'}
          className="flex flex-col"
        >
          {group.label && (
            <h3 className="flex items-center gap-2 pb-1 font-heading text-sm font-semibold">
              {group.label}
              <span className="count font-sans text-xs font-normal text-muted-foreground">
                {group.rows.length}
              </span>
            </h3>
          )}
          <ul className="flex flex-col border-t">
            {group.rows.map((t) => (
              <li key={t.id} data-layout-id={t.id} data-flip-id={t.id}>
                <TaskRow
                  task={t}
                  done={isDone(t)}
                  today={today}
                  projects={state.projects}
                  people={state.people}
                  showProject={filters.group !== 'project'}
                  onToggle={toggle}
                  onOpen={(task) => openTask(task.id)}
                  select={selectOf(selection, t)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------- Table ---------- */

/** The dense, sortable table (rows on phones). */
export function TaskTable(props: TaskLayoutProps) {
  const { groups, filters, state, today, selection, isDone, toggle, openTask } =
    props;
  const now = new Date();
  return (
    <DataTable<Task>
      label="Tasks"
      groups={groups}
      getId={(t) => t.id}
      rowLabel={(t) => t.title}
      sort={{ column: filters.sort, dir: filters.dir }}
      onSort={props.onSort}
      selection={selection}
      onOpen={(t) => openTask(t.id)}
      columns={[
        {
          id: 'title',
          header: 'Title',
          sortable: true,
          cell: (t) => (
            <button
              type="button"
              data-task-title
              data-row-action="open"
              onClick={() => openTask(t.id)}
              className={cn(
                'max-w-[28rem] truncate text-left outline-ring/50 hover:underline focus-visible:outline-2',
                isDone(t) && 'text-muted-foreground line-through',
              )}
            >
              {t.title}
            </button>
          ),
        },
        ...(filters.group === 'project'
          ? []
          : [
              {
                id: 'project',
                header: 'Project',
                sortable: true,
                cell: (t: Task) => (
                  <span className="text-muted-foreground">
                    {project(state, t)}
                  </span>
                ),
              },
            ]),
        {
          id: 'priority',
          header: 'Priority',
          sortable: true,
          cell: (t) => (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <PriorityDot priority={t.priority} labelled={false} />
              {t.priority === 'none' ? '' : PRIORITY_LABELS[t.priority]}
            </span>
          ),
        },
        {
          id: 'due',
          header: 'Due',
          sortable: true,
          cell: (t) =>
            t.due ? (
              <DueDate due={t.due} today={today} done={isDone(t)} />
            ) : null,
        },
        {
          id: 'assignee',
          header: 'Assignee',
          sortable: true,
          cell: (t) => (
            <span className="text-muted-foreground">
              {state.people[t.assignee]?.name ?? ''}
            </span>
          ),
        },
        {
          id: 'updated',
          header: 'Updated',
          sortable: true,
          className: 'whitespace-nowrap text-xs text-muted-foreground',
          cell: (t) => relativeTime(t.updatedAt, now),
        },
        {
          id: 'done',
          header: 'Complete',
          className: 'w-9',
          cell: (t) => (
            <TaskCheck
              task={t}
              done={isDone(t)}
              onToggle={toggle}
              className="desk:h-8.5"
            />
          ),
        },
      ]}
      mobileRow={(t) => (
        <TaskRow
          task={t}
          done={isDone(t)}
          today={today}
          projects={state.projects}
          people={state.people}
          showProject={filters.group !== 'project'}
          onToggle={toggle}
          onOpen={(task) => openTask(task.id)}
        />
      )}
    />
  );
}

/* ---------- Board ---------- */

/**
 * A task on a board: the title gets its own lines (columns are narrow),
 * details underneath, and the complete check at the end, apart from the
 * select box.
 */
function BoardCard({
  task,
  done,
  today,
  state,
  showProject,
  onToggle,
  onOpen,
  select,
}: {
  task: Task;
  done: boolean;
  today: string;
  state: Snapshot;
  showProject: boolean;
  onToggle: (task: Task) => void;
  onOpen: () => void;
  select?: { selected: boolean; onToggle: (range: boolean) => void };
}) {
  const person = state.people[task.assignee];
  return (
    <div className="flex flex-col gap-1 p-2 pr-10 text-sm">
      <div className="flex items-start gap-2">
        {select && (
          <input
            type="checkbox"
            checked={select.selected}
            onClick={(e) => select.onToggle(e.shiftKey)}
            onChange={() => {}}
            aria-label={`Select “${task.title}”`}
            className="mt-1 size-4 shrink-0 accent-foreground"
          />
        )}
        <button
          type="button"
          data-task-title
          data-row-focus
          data-row-action="open"
          onClick={onOpen}
          className={cn(
            'line-clamp-3 min-w-0 flex-1 text-left outline-ring/50 hover:underline focus-visible:outline-2',
            done && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PriorityDot priority={task.priority} />
        {showProject && (
          <span className="min-w-0 truncate">{project(state, task)}</span>
        )}
        {task.due && <DueDate due={task.due} today={today} done={done} />}
        {person && <span className="truncate">{person.name}</span>}
        <span className="flex-1" />
        <TaskCheck
          task={task}
          done={done}
          onToggle={onToggle}
          className="-my-2 -mr-8"
        />
      </div>
    </div>
  );
}

const DONE = 'done';

/**
 * Columns by the current group-by (due buckets, projects, people or
 * priorities; with no grouping, by status). Every column is there even
 * when empty, so it can take a drop. Dragging a card, or its Move to
 * menu, edits the field the columns stand for; the Done column (when on)
 * closes, and leaving it reopens.
 */
export function TaskBoard(props: TaskLayoutProps & { doneTasks: Task[] }) {
  const {
    groups,
    filters,
    state,
    today,
    selection,
    isDone,
    toggle,
    openTask,
    change,
  } = props;
  const [showDone, setShowDone] = useState(filters.status !== 'open');
  const by = filters.group === 'none' ? 'status' : filters.group;
  const open = groups.flatMap((g) => g.rows).filter((t) => t.status === 'open');

  const columns: BoardColumn<Task>[] = (() => {
    if (by === 'due') {
      return DUE_BUCKETS.map((b) => ({
        id: b.id,
        title: b.label,
        items: open.filter((t) => dueBucket(t, today) === b.id),
        empty: b.id === 'overdue' ? 'Nothing overdue.' : undefined,
      }));
    }
    if (by === 'project') {
      const projects = Object.values(state.projects)
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
      return [
        ...projects.map((p) => ({
          id: p.id,
          title: p.name,
          items: open.filter((t) => t.projectId === p.id),
        })),
        {
          id: 'general',
          title: 'General',
          items: open.filter((t) => !t.projectId),
        },
      ];
    }
    if (by === 'assignee') {
      const people = Object.values(state.people).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return [
        ...people.map((p) => ({
          id: p.id,
          title: p.name,
          items: open.filter((t) => t.assignee === p.id),
        })),
        {
          id: 'unassigned',
          title: 'Unassigned',
          items: open.filter((t) => !t.assignee || !state.people[t.assignee]),
        },
      ];
    }
    if (by === 'priority') {
      return [...PRIORITIES].reverse().map((p) => ({
        id: p,
        title: PRIORITY_LABELS[p],
        items: open.filter((t) => t.priority === p),
      }));
    }
    return [{ id: 'open', title: 'Open', items: open }];
  })();
  const all =
    showDone || by === 'status'
      ? [...columns, { id: DONE, title: 'Done', items: props.doneTasks }]
      : columns;

  /** The op that puts `task` in column `to`, for the field `by` stands for. */
  const opFor = (task: Task, to: string): Op | null | 'refused' => {
    if (by === 'due') {
      const due = dueForBucket(to as DueBucket, today);
      if (due === null) return 'refused';
      return task.due === due
        ? null
        : { type: 'editTask', id: task.id, patch: { due } };
    }
    if (by === 'project') {
      const projectId = to === 'general' ? null : to;
      return task.projectId === projectId
        ? null
        : { type: 'moveTask', id: task.id, projectId };
    }
    if (by === 'assignee') {
      const assignee = to === 'unassigned' ? '' : to;
      return task.assignee === assignee
        ? null
        : { type: 'editTask', id: task.id, patch: { assignee } };
    }
    if (by === 'priority') {
      return task.priority === to
        ? null
        : {
            type: 'editTask',
            id: task.id,
            patch: { priority: to as Priority },
          };
    }
    return null;
  };

  const move = (task: Task, from: string, to: string) => {
    const column = all.find((c) => c.id === to)?.title ?? to;
    const ops: Op[] = [];
    if (to === DONE) {
      ops.push({ type: 'toggleTask', id: task.id, done: true });
    } else {
      if (from === DONE)
        ops.push({ type: 'toggleTask', id: task.id, done: false });
      const op = opFor(task, to);
      if (op === 'refused') {
        change([], [], 'Overdue is where late tasks land; pick a date instead');
        return;
      }
      if (op) ops.push(op);
    }
    const shown =
      by === 'due' && to !== DONE && to !== 'none'
        ? `${column} (${formatDay(dueForBucket(to as DueBucket, today) || today, today)})`
        : column;
    change(ops, [task], `Moved “${task.title}” to ${shown}`);
  };

  return (
    <div className="flex flex-col gap-2">
      {by !== 'status' && (
        <label
          htmlFor="board-show-done"
          className="flex min-h-11 items-center gap-2 self-end text-xs desk:min-h-8"
        >
          <Checkbox
            id="board-show-done"
            checked={showDone}
            onCheckedChange={(on) => setShowDone(on === true)}
          />
          Show a Done column
        </label>
      )}
      <Board<Task>
        label="Tasks board"
        columns={all}
        getId={(t) => t.id}
        itemLabel={(t) => t.title}
        onMove={move}
        renderCard={(t) => (
          <BoardCard
            task={t}
            done={isDone(t)}
            today={today}
            state={state}
            showProject={by !== 'project'}
            onToggle={toggle}
            onOpen={() => openTask(t.id)}
            select={selectOf(selection, t)}
          />
        )}
      />
    </div>
  );
}

/* ---------- Timeline ---------- */

/**
 * Tasks with a due date as points on a time axis, a lane per project.
 * Drag a point to change its due date; drag an undated task from the tray
 * onto a lane to give it one (and move it to that lane's project).
 */
export function TaskTimeline(props: TaskLayoutProps) {
  const { groups, state, today, selection, isDone, toggle, openTask, change } =
    props;
  const tasks = groups.flatMap((g) => g.rows);
  const dated = tasks.filter((t) => t.due);
  const undated = tasks.filter((t) => !t.due);
  const lanes = [
    ...Object.values(state.projects)
      .filter((p) => !p.archived && dated.some((t) => t.projectId === p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: p.name })),
    { id: 'general', label: 'General' },
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-4">
      <Timeline
        label="Tasks by due date"
        defaultZoom="week"
        rows={lanes.map((lane) => ({
          id: lane.id,
          label: lane.label,
          noBar: true,
          points: dated
            .filter((t) => (t.projectId ?? 'general') === lane.id)
            .map((t) => ({
              id: t.id,
              date: t.due,
              label: t.title,
              kind: 'task' as const,
            })),
        }))}
        onOpenRow={() => {}}
        onOpenPoint={(_lane, id) => openTask(id)}
        onMovePoint={(_lane, id, due) => {
          const t = byId.get(id);
          if (!t) return;
          change(
            [{ type: 'editTask', id, patch: { due } }],
            [t],
            `Moved “${t.title}” to ${formatDay(due, today)}`,
          );
        }}
        onDropItem={(id, lane, due) => {
          const t = byId.get(id);
          if (!t) return;
          const projectId = lane === 'general' ? null : lane;
          const ops: Op[] = [{ type: 'editTask', id, patch: { due } }];
          if (t.projectId !== projectId)
            ops.push({ type: 'moveTask', id, projectId });
          change(ops, [t], `“${t.title}” is due ${formatDay(due, today)}`);
        }}
      />
      <section aria-labelledby="undated-title" className="flex flex-col">
        <h3
          id="undated-title"
          className="pb-1 font-heading text-sm font-semibold"
        >
          No date
          <span className="count ml-2 font-sans text-xs font-normal text-muted-foreground">
            {undated.length}
          </span>
        </h3>
        {undated.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every task here has a date.
          </p>
        ) : (
          <ul className="flex flex-col border-t">
            {undated.map((t) => (
              <li
                key={t.id}
                data-layout-id={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                }}
                className="cursor-grab"
              >
                <TaskRow
                  task={t}
                  done={isDone(t)}
                  today={today}
                  projects={state.projects}
                  people={state.people}
                  onToggle={toggle}
                  onOpen={(task) => openTask(task.id)}
                  onEdit={(task, patch) =>
                    change(
                      [{ type: 'editTask', id: task.id, patch }],
                      [task],
                      `Edited “${task.title}”`,
                    )
                  }
                  select={selectOf(selection, t)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
