import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localDate } from '#shared/dates';
import {
  TASK_GROUP_OPTIONS,
  TASK_SORT_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '#shared/pages';
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
  undoTaskOps,
} from '#shared/tasks';
import type { Task } from '#shared/types';
import { FindField } from '@/components/inputs/FindField';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { SortField } from '@/components/inputs/SortField';
import type { Selection } from '@/components/layouts/DataTable';
import {
  ListEmpty,
  ListToolbar,
  useListFilters,
} from '@/components/layouts/ListToolbar';
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
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withViewTransition } from '@/lib/motion';
import { navigate } from '@/lib/router';
import { isTypingTarget, overlayOpen } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

const GROUPS = TASK_GROUP_OPTIONS;

/**
 * The view's controls, from the URL so Back restores them, over what is
 * saved for the page.
 */
function useTaskFilters(query: URLSearchParams): TaskFilters {
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

/** A task opened from Tasks is its page; anywhere else, its panel. */
const openTask = (id: string) => navigate({ name: 'task', id });

/**
 * Every task, across projects, as a List, a dense Table (the desktop
 * default), a Board or a Timeline. Status, grouping, assignee, text, sort
 * and layout live in the URL; all but the text are saved for the page
 * (#186). Add task opens the new-task panel (assigned
 * to whoever the view is filtered to); a task opens its own page. Every
 * layout has the filters and multi-select with the bulk bar.
 */
export function TasksPage() {
  usePageTitle('Tasks');
  const { state, actions } = useDatapad();
  const { newTask } = useTaskPanels();
  const { active } = useMotion();
  const { show } = useToast();
  const { toggle, isDone } = useTaskToggle();
  const [query, changePage] = usePageQuery('tasks');
  const filters = useTaskFilters(query);
  const [view, setView] = useView('tasks', TASK_VIEWS, defaultTaskView());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const flipRoot = useRef<HTMLDivElement>(null);
  useFlip(flipRoot, active);
  const today = localDate(new Date());
  const me = state ? meId(state.people) : null;

  const changeQuery = useCallback(
    (changes: Record<string, string | null>, transition = true) => {
      changePage(changes, {
        replace: !transition,
        transition: transition
          ? (update) => withViewTransition(update, active, 'filter')
          : undefined,
      });
    },
    [active, changePage],
  );
  const listFilters = useListFilters('tasks', query, changeQuery);

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

  /** One change for a drag or drop, with Undo putting back what it changed. */
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
          ops: undoTaskOps(before, ops),
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

  const sortTo = (sort: string, dir: 'asc' | 'desc') =>
    changeQuery(
      {
        sort: sort === DEFAULT_TASK_FILTERS.sort ? null : sort,
        dir: dir === 'desc' ? 'desc' : null,
      },
      false,
    );
  const sortBy = (column: string) => {
    const same = filters.sort === column;
    sortTo(column, same && filters.dir === 'asc' ? 'desc' : 'asc');
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
        <Button
          className="press h-11 desk:h-8"
          onClick={() => newTask(null, { assignee: assignTo })}
        >
          <PlusIcon />
          Add task
        </Button>
      </div>

      <ListToolbar
        state={listFilters}
        find={
          <FindField
            value={filters.q}
            placeholder="Title, details or tag"
            onChange={(q) => changeQuery({ q: q || null }, false)}
          />
        }
        filters={
          <>
            <Segmented
              legend="Status"
              value={filters.blocked ? 'blocked' : filters.status}
              onChange={(v) => changeQuery({ status: v === 'open' ? null : v })}
              options={[...TASK_STATUS_OPTIONS]}
            />
            <SelectField
              label="Group by"
              value={filters.group}
              options={[...GROUPS]}
              onChange={(v) =>
                changeQuery({ group: v === 'project' ? null : v })
              }
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
          </>
        }
        sort={
          <SortField
            value={filters.sort}
            options={[...TASK_SORT_OPTIONS]}
            dir={filters.dir}
            onChange={sortTo}
          />
        }
      />

      <div ref={flipRoot}>
        {empty ? (
          <ListEmpty state={listFilters}>No tasks here.</ListEmpty>
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
