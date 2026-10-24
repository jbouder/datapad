import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localDate, relativeTime } from '#shared/dates';
import type { AssigneeFilter } from '#shared/select';
import { meId } from '#shared/select';
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
import { DataTable } from '@/components/layouts/DataTable';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { BulkBar } from '@/components/tasks/BulkBar';
import { DueDate } from '@/components/tasks/DueDate';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskCheck, TaskRow } from '@/components/tasks/TaskRow';
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

const GROUPS = [
  { value: 'project', label: 'Project' },
  { value: 'due', label: 'Due date' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'Nothing' },
] as const;

function whoFrom(value: string | null): AssigneeFilter {
  if (value === 'mine') return { kind: 'mine' };
  if (value === 'unassigned') return { kind: 'unassigned' };
  if (value?.startsWith('p:')) return { kind: 'person', id: value.slice(2) };
  return { kind: 'anyone' };
}

function whoTo(who: AssigneeFilter): string {
  return who.kind === 'person' ? `p:${who.id}` : who.kind;
}

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
      who: whoFrom(q.get('who')),
      q: q.get('q') ?? '',
      sort: (TASK_SORTS as readonly string[]).includes(sort ?? '')
        ? (sort as TaskSortKey)
        : DEFAULT_TASK_FILTERS.sort,
      dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
    };
  }, [value]);
}

/**
 * Every task, across projects. A dense, sortable table on desktop with
 * group headers, multi-select (Shift for ranges, ⌘/Ctrl+A in a group) and
 * a bulk bar; task rows under group headers on phones. Status, grouping,
 * assignee, text and sort all live in the URL.
 */
export function TasksPage() {
  usePageTitle('Tasks');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { active } = useMotion();
  const { toggle, isDone } = useTaskToggle();
  const filters = useTaskFilters();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const flipRoot = useRef<HTMLDivElement>(null);
  useFlip(flipRoot, active);
  const today = localDate(new Date());
  const now = new Date();
  const me = state ? meId(state.people) : null;

  const change = useCallback(
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

  // Selection follows what is shown.
  useEffect(() => {
    setSelected((s) => {
      const shown = new Set(flat.map((t) => t.id));
      const next = new Set([...s].filter((id) => shown.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [flat]);

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

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const toggleSelected = (id: string, range: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      const from = anchor.current
        ? flat.findIndex((t) => t.id === anchor.current)
        : -1;
      const to = flat.findIndex((t) => t.id === id);
      if (range && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (const t of flat.slice(a, b + 1)) next.add(t.id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      anchor.current = id;
      return next;
    });
  };

  const sortBy = (column: string) => {
    const same = filters.sort === column;
    change(
      {
        sort: column === DEFAULT_TASK_FILTERS.sort && !same ? null : column,
        dir: same && filters.dir === 'asc' ? 'desc' : null,
      },
      false,
    );
  };

  const assignTo =
    filters.who.kind === 'mine'
      ? (me ?? '')
      : filters.who.kind === 'person'
        ? filters.who.id
        : '';
  const people = Object.values(state.people).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const project = (t: Task) =>
    t.projectId ? (state.projects[t.projectId]?.name ?? 'General') : 'General';

  return (
    <section
      aria-labelledby="tasks-title"
      className="enter flex flex-col gap-4"
    >
      <h1 id="tasks-title" className="text-page-title">
        Tasks
      </h1>

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr]">
        <Segmented
          legend="Show"
          value={filters.status}
          onChange={(v) => change({ status: v === 'open' ? null : v })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SelectField
          label="Group by"
          value={filters.group}
          options={[...GROUPS]}
          onChange={(v) => change({ group: v === 'project' ? null : v })}
        />
        <SelectField
          label="Assignee"
          value={whoTo(filters.who)}
          options={[
            { value: 'anyone', label: 'Anyone' },
            ...(me ? [{ value: 'mine', label: 'Mine' }] : []),
            { value: 'unassigned', label: 'Unassigned' },
            ...people.map((p) => ({ value: `p:${p.id}`, label: p.name })),
          ]}
          onChange={(v) => change({ who: v === 'anyone' ? null : v })}
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
            onChange={(e) => change({ q: e.target.value || null }, false)}
            className="h-11 text-base desk:h-8 desk:text-xs"
          />
        </div>
      </div>

      <div ref={flipRoot}>
        {flat.length === 0 ? (
          <p className="text-state">No tasks here.</p>
        ) : (
          <DataTable<Task>
            label="Tasks"
            groups={groups}
            getId={(t) => t.id}
            rowLabel={(t) => t.title}
            sort={{ column: filters.sort, dir: filters.dir }}
            onSort={sortBy}
            selection={{
              selected,
              toggle: toggleSelected,
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
            }}
            onOpen={(t) => openTask(t.id)}
            columns={[
              {
                id: 'done',
                header: 'Done',
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
              {
                id: 'title',
                header: 'Title',
                sortable: true,
                cell: (t) => (
                  <button
                    type="button"
                    data-task-title
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
                          {project(t)}
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
        )}
      </div>

      {selected.size > 0 && (
        <BulkBar
          tasks={flat.filter((t) => selected.has(t.id))}
          onDone={() => setSelected(new Set())}
        />
      )}
    </section>
  );
}
