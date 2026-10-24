import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localDate } from '#shared/dates';
import type { Op } from '#shared/protocol';
import {
  assigneeFor,
  assigneeFromQuery,
  assigneeToQuery,
  meId,
} from '#shared/select';
import {
  DEFAULT_TASK_FILTERS,
  selectTasks,
  TASK_SORTS,
  type TaskFilters,
  type TaskSortKey,
} from '#shared/tasks';
import type { Task } from '#shared/types';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import type { Selection } from '@/components/layouts/DataTable';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { BulkBar } from '@/components/tasks/BulkBar';
import {
  defaultTaskView,
  TASK_VIEWS,
  TaskBoard,
  type TaskLayoutProps,
  TaskListLayout,
  TaskTable,
  TaskTimeline,
} from '@/components/tasks/TaskLayouts';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { isTypingTarget, overlayOpen } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const GROUPS = [
  { value: 'project', label: 'Project' },
  { value: 'due', label: 'Due date' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'none', label: 'Nothing' },
] as const;

/** The view's controls, from the URL so Back restores them. */
function useTaskFilters(): TaskFilters {
  const query = useQuery();
  const value = query.toString();
  return useMemo(() => {
    const q = new URLSearchParams(value);
    const status = q.get('status');
    const group = q.get('group');
    const sort = q.get('sort');
    return {
      status:
        status === 'done' || status === 'all'
          ? status
          : DEFAULT_TASK_FILTERS.status,
      group: GROUPS.some((g) => g.value === group)
        ? (group as TaskFilters['group'])
        : DEFAULT_TASK_FILTERS.group,
      who: assigneeFromQuery(q.get('who')),
      q: q.get('q') ?? '',
      // "Blocked" is open tasks waiting on someone.
      blocked: status === 'blocked',
      sort: (TASK_SORTS as readonly string[]).includes(sort ?? '')
        ? (sort as TaskSortKey)
        : DEFAULT_TASK_FILTERS.sort,
      dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
    };
  }, [value]);
}

/**
 * Every task, across projects, as a List, a dense Table (the desktop
 * default), a Board or a Timeline. Status, grouping, assignee, text, sort
 * and layout live in the URL. Every layout has the quick-add, the
 * filters and multi-select with the bulk bar.
 */
export function TasksPage() {
  usePageTitle('Tasks');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { active } = useMotion();
  const { show } = useToast();
  const { toggle, isDone } = useTaskToggle();
  const filters = useTaskFilters();
  const [view, setView] = useView('tasks', TASK_VIEWS, defaultTaskView());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const flipRoot = useRef<HTMLDivElement>(null);
  useFlip(flipRoot, active);
  const today = localDate(new Date());
  const me = state ? meId(state.people) : null;

  const changeQuery = useCallback(
    (changes: Record<string, string | null>, transition = true) => {
      setQuery(changes, {
        replace: !transition,
        transition: transition
          ? (update) => withViewTransition(update, active, 'filter')
          : undefined,
      });
    },
    [active],
  );

  const groups = useMemo(
    () => (state ? selectTasks(state, filters, today, me) : []),
    [state, filters, today, me],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const doneTasks = useMemo(
    () =>
      state
        ? (selectTasks(
            state,
            { ...filters, status: 'done', group: 'none' },
            today,
            me,
          )[0]?.rows ?? [])
        : [],
    [state, filters, today, me],
  );

  // Selection follows what is shown.
  useEffect(() => {
    setSelected((s) => {
      const shown = new Set([...flat, ...doneTasks].map((t) => t.id));
      const next = new Set([...s].filter((id) => shown.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [flat, doneTasks]);

  // Esc clears the selection (when nothing else wants it).
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !isTypingTarget(event.target) &&
        !overlayOpen()
      ) {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size]);

  /** One change for a drag or drop, with Undo putting the tasks back. */
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
      show(message, () => {
        actions.batch({
          ops: before.map((doc) => ({ type: 'put', col: 'tasks', doc })),
        });
      });
    },
    [actions, show],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const order = view === 'board' ? [...flat, ...doneTasks] : flat;
  const selection: Selection = {
    selected,
    toggle: (id, range) =>
      setSelected((s) => {
        const next = new Set(s);
        const from = anchor.current
          ? order.findIndex((t) => t.id === anchor.current)
          : -1;
        const to = order.findIndex((t) => t.id === id);
        if (range && from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          for (const t of order.slice(a, b + 1)) next.add(t.id);
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        anchor.current = id;
        return next;
      }),
    toggleGroup: (ids) =>
      setSelected((s) => {
        const all = ids.every((id) => s.has(id));
        const next = new Set(s);
        for (const id of ids) {
          if (all) next.delete(id);
          else next.add(id);
        }
        return next;
      }),
    selectGroup: (ids) => setSelected((s) => new Set([...s, ...ids])),
  };

  const sortBy = (column: string) => {
    const same = filters.sort === column;
    changeQuery(
      {
        sort: column === DEFAULT_TASK_FILTERS.sort && !same ? null : column,
        dir: same && filters.dir === 'asc' ? 'desc' : null,
      },
      false,
    );
  };

  const assignTo = assigneeFor(filters.who, me);
  const people = Object.values(state.people).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const layout: TaskLayoutProps = {
    groups,
    filters,
    state,
    today,
    selection,
    isDone,
    toggle,
    openTask,
    change,
    onSort: sortBy,
  };
  const selectedTasks = order.filter((t) => selected.has(t.id));
  const empty =
    flat.length === 0 && (view !== 'board' || doneTasks.length === 0);

  return (
    <section
      aria-labelledby="tasks-title"
      className={cn('enter flex flex-col gap-4', selected.size > 0 && 'pb-24')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="tasks-title" className="text-page-title flex-1">
          Tasks
        </h1>
        <ViewSwitcher views={TASK_VIEWS} value={view} onChange={setView} />
      </div>

      <QuickAdd
        projectId={projectId}
        onProjectChange={setProjectId}
        onAdd={(title) =>
          actions.addTask({
            projectId,
            title,
            assignee: assignTo || undefined,
          }) !== null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end desk:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr]">
        <Segmented
          legend="Show"
          value={filters.blocked ? 'blocked' : filters.status}
          onChange={(v) => changeQuery({ status: v === 'open' ? null : v })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SelectField
          label="Group by"
          value={filters.group}
          options={[...GROUPS]}
          onChange={(v) => changeQuery({ group: v === 'project' ? null : v })}
        />
        <SelectField
          label="Assignee"
          value={assigneeToQuery(filters.who)}
          options={[
            { value: 'anyone', label: 'Anyone' },
            ...(me ? [{ value: 'mine', label: 'Mine' }] : []),
            { value: 'unassigned', label: 'Unassigned' },
            ...people.map((p) => ({ value: `p:${p.id}`, label: p.name })),
          ]}
          onChange={(v) => changeQuery({ who: v === 'anyone' ? null : v })}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-find" className="text-xs font-medium">
            Find
          </label>
          <Input
            id="task-find"
            type="search"
            value={filters.q}
            placeholder="Title, details or tag"
            autoComplete="off"
            onChange={(e) => changeQuery({ q: e.target.value || null }, false)}
            className="h-11 text-base desk:h-8 desk:text-xs"
          />
        </div>
      </div>

      <div ref={flipRoot}>
        {empty ? (
          <p className="text-state">No tasks here.</p>
        ) : view === 'list' ? (
          <TaskListLayout {...layout} />
        ) : view === 'board' ? (
          <TaskBoard {...layout} doneTasks={doneTasks} />
        ) : view === 'timeline' ? (
          <TaskTimeline {...layout} />
        ) : (
          <TaskTable {...layout} />
        )}
      </div>

      {selected.size > 0 && (
        <BulkBar tasks={selectedTasks} onDone={() => setSelected(new Set())} />
      )}
    </section>
  );
}
