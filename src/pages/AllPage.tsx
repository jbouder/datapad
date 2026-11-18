import {
  CalendarBlankIcon,
  ChalkboardSimpleIcon,
  ChartBarHorizontalIcon,
  CheckSquareIcon,
  DoorOpenIcon,
  FolderPlusIcon,
  FoldersIcon,
  type Icon,
  KanbanIcon,
  ListBulletsIcon,
  NoteIcon,
  SquaresFourIcon,
  TableIcon,
  UserIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_ROOMS_QUERY,
  ALL_STATUS_OPTIONS,
  type AllFilters,
  type AllRow,
  activeAllFilters,
  allLayout,
  allQuery,
  allTags,
  BOARD_BY,
  type BoardBy,
  clearedAllFilters,
  currentView,
  defaultAllFilters,
  defaultSort,
  filtersFor,
  KIND_LABELS,
  LAYOUT_SETTING,
  layoutKind,
  layoutsFor,
  parseAllQuery,
  selectAll,
  showsRooms,
  sortsFor,
  viewQuery,
} from '#shared/all';
import { formatDay } from '#shared/dates';
import { ALL_SORT_SETTING, allSortDefaults } from '#shared/pages';
import type { Op } from '#shared/protocol';
import {
  peopleByOwed,
  projectHome,
  projectRoomsByOrg,
  savedViews,
} from '#shared/rooms';
import { ALL_KINDS, type AllKind } from '#shared/routes';
import { meId, taskNoteCounts } from '#shared/select';
import {
  DEFAULT_TASK_FILTERS,
  DUE_BUCKETS,
  type TaskFilters,
  type TaskSortKey,
  undoTaskOps,
} from '#shared/tasks';
import { healthOf, type Person, type Project, type Task } from '#shared/types';
import { SavedViews } from '@/components/all/SavedViews';
import { FindField } from '@/components/inputs/FindField';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { SortField } from '@/components/inputs/SortField';
import type { Selection } from '@/components/layouts/DataTable';
import {
  ListEmpty,
  type ListFilters,
  ListToolbar,
} from '@/components/layouts/ListToolbar';
import {
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { MeetingLayouts } from '@/components/meetings/MeetingLayouts';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { PinButton } from '@/components/PinButton';
import { useNewPerson } from '@/components/people/useNewPerson';
import { HealthBadge } from '@/components/projects/Health';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { ProjectLayouts } from '@/components/projects/ProjectLayouts';
import { StatusPill } from '@/components/projects/StatusPill';
import { BulkBar } from '@/components/tasks/BulkBar';
import {
  TaskBoard,
  type TaskLayoutProps,
  TaskTable,
} from '@/components/tasks/TaskLayouts';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { Button, buttonVariants } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withLayoutTransition, withViewTransition } from '@/lib/motion';
import { linkProps, navigate, useQuery } from '@/lib/router';
import { isTypingTarget, overlayOpen } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import {
  usePageSetting,
  usePageSettingState,
} from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

const KIND_ICONS: Record<AllKind, Icon> = {
  task: CheckSquareIcon,
  note: NoteIcon,
  meeting: CalendarBlankIcon,
  project: FoldersIcon,
  person: UserIcon,
};

/** Each layout's icon in the switcher. */
const LAYOUT_ICONS: Record<string, Icon> = {
  list: ListBulletsIcon,
  table: TableIcon,
  board: KanbanIcon,
  calendar: CalendarBlankIcon,
  cards: SquaresFourIcon,
  timeline: ChartBarHorizontalIcon,
};

const BOARD_LABELS: Record<BoardBy, string> = {
  status: 'Status',
  priority: 'Priority',
};

/** How many rows show before Show more. */
const PAGE = 100;

/** The select value that stands for "any" (an empty value is none). */
const ANY = 'any';

/** The tasks among `rows`. */
const tasksOf = (rows: readonly AllRow[]): Task[] =>
  rows.flatMap((r) => (r.kind === 'task' ? [r.item] : []));

/**
 * All (`/all`, #337): every item of every kind in one list. The kind
 * chips pick some kinds (none is every kind); the toolbar's Find, filters
 * and Sort follow the kinds picked, and everything lives in the address
 * (`shared/all.ts` reads and writes it). Each kind keeps its own row:
 * a task opens its panel, a note opens in place (`?note=<id>` opens and
 * highlights one), a meeting goes to its page, a project or a person to
 * their room. The Rooms chip beside the kinds (`?show=rooms`) shows the
 * rooms in place of the items, with their pins; the space's whiteboard is
 * in the header.
 *
 * #338 adds layouts for one kind alone (tasks: list, table, board by
 * status or priority; meetings: list, calendar; projects: list, cards,
 * timeline), in the address as `?view=`, each kind's default saved with
 * the space (Settings → All); saved views as chips above the list
 * (`SavedViews`); and select boxes on tasks for the bulk bar, whose
 * actions are one `batch` each, with Undo.
 */
export function AllPage() {
  usePageTitle('All');
  const { state, actions } = useDatapad();
  const { hidden } = useNotes();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const { show } = useToast();
  const today = useToday();
  const query = useQuery();
  const value = query.toString();
  // The owner's default sorts (Settings → All), as the page opened.
  const taskSort = usePageSetting('all', ALL_SORT_SETTING.task);
  const projectSort = usePageSetting('all', ALL_SORT_SETTING.project);
  const sorts = useMemo(
    () =>
      allSortDefaults({
        [ALL_SORT_SETTING.task]: taskSort,
        [ALL_SORT_SETTING.project]: projectSort,
      }),
    [taskSort, projectSort],
  );
  const filters = useMemo(
    () => parseAllQuery(new URLSearchParams(value), sorts),
    [value, sorts],
  );
  const target = query.get('note');
  // The Rooms chip: the rooms list in place of the items.
  const rooms = showsRooms(query);
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  // Each kind's saved layout, and the one shown.
  const [taskView, setTaskView] = usePageSettingState(
    'all',
    LAYOUT_SETTING.task,
  );
  const [meetingView, setMeetingView] = usePageSettingState(
    'all',
    LAYOUT_SETTING.meeting,
  );
  const [projectView, setProjectView] = usePageSettingState(
    'all',
    LAYOUT_SETTING.project,
  );
  const layout = allLayout(filters, {
    [LAYOUT_SETTING.task]: taskView,
    [LAYOUT_SETTING.meeting]: meetingView,
    [LAYOUT_SETTING.project]: projectView,
  });
  const kind = layoutKind(filters.kinds);
  const board = kind === 'task' && layout === 'board';

  /** Show `next`: the kinds as the route's, the rest as its query. */
  const change = useCallback(
    (next: AllFilters, how: 'filter' | 'layout' | 'none' = 'filter') => {
      const params = new URLSearchParams();
      for (const [key, v] of Object.entries(allQuery(next, sorts))) {
        if (v) params.set(key, v);
      }
      const go = () =>
        navigate(
          { name: 'all', kinds: next.kinds },
          { query: params.toString(), replace: how !== 'filter' },
        );
      if (how === 'filter') withViewTransition(go, active, 'filter');
      else if (how === 'layout') withLayoutTransition(go, active);
      else go();
      setLimit(PAGE);
    },
    [active, sorts],
  );
  const set = (patch: Partial<AllFilters>, transition = true) =>
    change({ ...filters, ...patch }, transition ? 'filter' : 'none');

  /** Switch layout: in the address, and saved as the kind's default. */
  const setLayout = (view: string) => {
    if (kind === 'task') setTaskView(view);
    else if (kind === 'meeting') setMeetingView(view);
    else if (kind === 'project') setProjectView(view);
    change({ ...filters, view }, 'layout');
  };

  const rows = useMemo(
    () => (state && !rooms ? selectAll(state, filters, today, hidden) : []),
    [state, rooms, filters, today, hidden],
  );
  const tasks = useMemo(() => tasksOf(rows), [rows]);
  // The board's Done column while Status is Open: the done tasks the
  // other filters keep.
  const extraDone = useMemo(() => {
    if (!state || rooms || !board || filters.status !== 'open') return [];
    return tasksOf(
      selectAll(state, { ...filters, status: 'done' }, today, hidden),
    );
  }, [state, rooms, board, filters, today, hidden]);

  /* ---------- selection, for the bulk bar ---------- */

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const order = useMemo(() => [...tasks, ...extraDone], [tasks, extraDone]);

  // Selection follows what is shown.
  useEffect(() => {
    setSelected((s) => {
      const shown = new Set(order.map((t) => t.id));
      const next = new Set([...s].filter((id) => shown.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [order]);

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

  /** A drag or a drop on the board, as one change with Undo. */
  const changeTasks = useCallback(
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
        actions.batch({ ops: undoTaskOps(before, ops) });
      });
    },
    [actions, show],
  );

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

  const offered = filtersFor(filters.kinds);
  const count = activeAllFilters(filters).length;
  const listFilters: ListFilters = {
    count,
    filtered: count > 0 || filters.q.trim() !== '',
    clear: () => change(clearedAllFilters(filters)),
  };

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // On the rooms list no kind is picked, and a kind leaves it: `change`
  // writes no `show`.
  const from = rooms ? defaultAllFilters([], sorts) : filters;
  const toggleKind = (kind: AllKind) => {
    const kinds = from.kinds.includes(kind)
      ? from.kinds.filter((k) => k !== kind)
      : ALL_KINDS.filter((k) => k === kind || from.kinds.includes(k));
    // The new kinds start at their own sort and layout.
    change({
      ...from,
      kinds,
      sort: defaultSort(kinds, sorts),
      dir: 'asc',
      view: '',
      board: 'status',
    });
  };
  /** The Rooms chip: on clears the kinds and filters; off is plain All. */
  const toggleRooms = () => {
    withViewTransition(
      () => navigate({ name: 'all' }, { query: rooms ? '' : ALL_ROOMS_QUERY }),
      active,
      'filter',
    );
    setLimit(PAGE);
  };

  const people = Object.values(state.people).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const me = meId(state.people);
  const projects = Object.values(state.projects).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const tags = allTags(state);
  const noteCounts = taskNoteCounts(state.notes);
  // A linked note is shown, however far down it is.
  const targetAt = target ? rows.findIndex((r) => r.id === target) : -1;
  const shown = rows.slice(0, Math.max(limit, targetAt + 1));

  const layouts: ViewOption<string>[] = layoutsFor(filters.kinds).map((o) => ({
    id: o.value,
    label: o.label,
    icon: LAYOUT_ICONS[o.value] ?? ListBulletsIcon,
  }));
  // What Save view keeps: the address, the layout shown spelled out.
  const showing = { ...filters, view: layouts.length > 0 ? layout : '' };
  const here = currentView(savedViews(state), filters, layout);
  const selectedTasks = order.filter((t) => selected.has(t.id));

  // Tasks alone, for the table and the board: one group, in All's order.
  const taskFilters: TaskFilters = {
    ...DEFAULT_TASK_FILTERS,
    status: filters.status === 'open' ? 'open' : 'all',
    group: filters.board === 'priority' ? 'priority' : 'none',
    q: filters.q,
    sort: filters.sort as TaskSortKey,
    dir: filters.dir,
  };
  const taskLayout: TaskLayoutProps = {
    groups: [{ id: 'all', label: '', rows: tasks }],
    filters: taskFilters,
    state,
    today,
    selection,
    isDone,
    toggle,
    openTask,
    change: changeTasks,
    onSort: (column) => {
      const same = filters.sort === column;
      set(
        { sort: column, dir: same && filters.dir === 'asc' ? 'desc' : 'asc' },
        false,
      );
    },
  };

  const row = (r: AllRow) => {
    switch (r.kind) {
      case 'task':
        return (
          <li key={`task:${r.id}`} data-flip-id={r.id}>
            <TaskRow
              task={r.item}
              done={isDone(r.item)}
              today={today}
              projects={state.projects}
              people={state.people}
              onToggle={toggle}
              onOpen={openFromRow}
              onEdit={onEdit}
              select={{
                selected: selected.has(r.id),
                onToggle: (range) => selection.toggle(r.id, range),
              }}
              noteCount={noteCounts.get(r.id)}
            />
          </li>
        );
      case 'note':
        return (
          <NoteRow
            key={`note:${r.id}`}
            note={r.item}
            state={state}
            chips={{ project: true, meeting: true, task: true }}
            className="border-x-0 border-t-0 bg-transparent"
          />
        );
      case 'meeting':
        return (
          <li key={`meeting:${r.id}`} data-flip-id={r.id}>
            <MeetingRow meeting={r.item} state={state} today={today} />
          </li>
        );
      case 'project':
        return <ProjectLine key={`project:${r.id}`} project={r.item} />;
      case 'person':
        return <PersonLine key={`person:${r.id}`} person={r.item} />;
    }
  };

  const empty = rows.length === 0 && extraDone.length === 0;
  const doneTasks =
    filters.status === 'open'
      ? extraDone
      : tasks.filter((t) => t.status === 'done');

  /** The rows in the layout shown. */
  const body = () => {
    if (board) {
      return (
        <div className="flex flex-col gap-2">
          <Segmented
            legend="Columns"
            value={filters.board}
            options={BOARD_BY.map((b) => ({
              value: b,
              label: BOARD_LABELS[b],
            }))}
            onChange={(by) => change({ ...filters, board: by }, 'layout')}
            className="self-start"
          />
          <TaskBoard {...taskLayout} doneTasks={doneTasks} />
        </div>
      );
    }
    if (kind === 'meeting' && layout === 'calendar') {
      return (
        <MeetingLayouts
          view="calendar"
          meetings={rows.flatMap((r) => (r.kind === 'meeting' ? [r.item] : []))}
          state={state}
          today={today}
          projectId={
            filters.room && filters.room !== 'general' ? filters.room : null
          }
          filters={listFilters}
          empty="Nothing here yet."
        />
      );
    }
    if (empty) {
      return <ListEmpty state={listFilters}>Nothing here yet.</ListEmpty>;
    }
    if (kind === 'task' && layout === 'table') {
      return <TaskTable {...taskLayout} />;
    }
    if (kind === 'project' && (layout === 'cards' || layout === 'timeline')) {
      return (
        <ProjectLayouts
          view={layout}
          projects={rows.flatMap((r) => (r.kind === 'project' ? [r.item] : []))}
          label="Projects"
        />
      );
    }
    return (
      <>
        <ul
          ref={list}
          aria-label="Items"
          className="vt-list flex flex-col border-t"
        >
          {shown.map(row)}
        </ul>
        {shown.length < rows.length && (
          <Button
            variant="outline"
            className="press h-11 self-start desk:h-8"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show more ({rows.length - shown.length} left)
          </Button>
        )}
      </>
    );
  };

  return (
    <div
      className={cn('enter flex flex-col gap-10', selected.size > 0 && 'pb-24')}
    >
      <section aria-labelledby="all-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 id="all-title" className="text-page-title flex-1">
            All
          </h1>
          {!rooms && layouts.length > 0 && (
            <ViewSwitcher views={layouts} value={layout} onChange={setLayout} />
          )}
          <a
            {...linkProps({ name: 'whiteboard' })}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'press h-11 desk:h-8',
            )}
          >
            <ChalkboardSimpleIcon aria-hidden />
            Whiteboard
          </a>
        </div>

        <fieldset className="-mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <legend className="sr-only">Show</legend>
          <div className="flex w-max gap-1 pr-4 sm:w-auto sm:flex-wrap sm:pr-0">
            {ALL_KINDS.map((kind) => {
              const on = !rooms && filters.kinds.includes(kind);
              const KindIcon = KIND_ICONS[kind];
              return (
                <Toggle
                  key={kind}
                  variant="outline"
                  className="press h-11 px-3 desk:h-8"
                  pressed={on}
                  onPressedChange={() => toggleKind(kind)}
                >
                  <KindIcon weight={on ? 'fill' : 'regular'} aria-hidden />
                  {KIND_LABELS[kind]}
                </Toggle>
              );
            })}
            <Toggle
              variant="outline"
              className="press h-11 px-3 desk:h-8"
              pressed={rooms}
              onPressedChange={toggleRooms}
            >
              <DoorOpenIcon weight={rooms ? 'fill' : 'regular'} aria-hidden />
              Rooms
            </Toggle>
          </div>
        </fieldset>

        {rooms ? (
          <Rooms />
        ) : (
          <>
            <SavedViews query={viewQuery(showing)} current={here} />

            <ListToolbar
              state={listFilters}
              find={
                <FindField
                  value={filters.q}
                  placeholder="Words in anything"
                  onChange={(q) => set({ q }, false)}
                />
              }
              filters={
                <>
                  {offered.includes('room') && (
                    <SelectField
                      label="Room"
                      value={filters.room || ANY}
                      options={[
                        { value: ANY, label: 'Any room' },
                        { value: 'general', label: 'General' },
                        ...projects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onChange={(v) => set({ room: v === ANY ? '' : v })}
                    />
                  )}
                  {offered.includes('person') && (
                    <SelectField
                      label="Person"
                      value={filters.person || ANY}
                      options={[
                        { value: ANY, label: 'Anyone' },
                        ...(me ? [{ value: 'me', label: 'Me' }] : []),
                        ...people
                          .filter((p) => p.id !== me)
                          .map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      onChange={(v) => set({ person: v === ANY ? '' : v })}
                    />
                  )}
                  {offered.includes('status') && (
                    <SelectField
                      label="Status"
                      value={filters.status}
                      options={[...ALL_STATUS_OPTIONS]}
                      onChange={(status) => set({ status })}
                    />
                  )}
                  {offered.includes('due') && (
                    <SelectField
                      label="Due"
                      value={filters.due || ANY}
                      options={[
                        { value: ANY, label: 'Any time' },
                        ...DUE_BUCKETS.map((b) => ({
                          value: b.id,
                          label: b.label,
                        })),
                      ]}
                      onChange={(v) =>
                        set({ due: v === ANY ? '' : (v as AllFilters['due']) })
                      }
                    />
                  )}
                  {offered.includes('tag') && tags.length > 0 && (
                    <SelectField
                      label="Tag"
                      value={filters.tag || ANY}
                      options={[
                        { value: ANY, label: 'Any tag' },
                        ...tags.map((t) => ({ value: t, label: t })),
                      ]}
                      onChange={(v) => set({ tag: v === ANY ? '' : v })}
                    />
                  )}
                  {offered.includes('decide') && (
                    <Segmented
                      legend="Tasks"
                      value={
                        filters.decide
                          ? 'decide'
                          : filters.waiting
                            ? 'waiting'
                            : ANY
                      }
                      options={[
                        { value: ANY, label: 'Any' },
                        { value: 'decide', label: 'To decide' },
                        { value: 'waiting', label: 'Waiting on' },
                      ]}
                      onChange={(v) =>
                        set({
                          decide: v === 'decide',
                          waiting: v === 'waiting',
                        })
                      }
                    />
                  )}
                </>
              }
              sort={
                <SortField
                  value={filters.sort}
                  options={sortsFor(filters.kinds)}
                  dir={filters.dir}
                  onChange={(sort, dir) => set({ sort, dir }, false)}
                />
              }
            />

            <p className="text-xs text-muted-foreground tabular-nums">
              {rows.length === 1 ? '1 item' : `${rows.length} items`}
            </p>

            {body()}
          </>
        )}
      </section>

      {selected.size > 0 && (
        <BulkBar tasks={selectedTasks} onDone={() => setSelected(new Set())} />
      )}
    </div>
  );
}

const LINE =
  'flex min-h-11 items-center gap-3 border-b py-1.5 pr-1 text-sm desk:min-h-9';

/** A project in the list: its name (to its room), org, status, health, target. */
function ProjectLine({ project }: { project: Project }) {
  const today = useToday();
  const { state } = useDatapad();
  return (
    <li data-flip-id={project.id} className={LINE}>
      <FoldersIcon
        className="ml-2 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col desk:flex-row desk:items-center desk:gap-3">
        <a
          {...linkProps(projectHome(project.id, state ?? {}))}
          className="truncate font-medium hover:underline"
        >
          {project.name}
        </a>
        {project.org && (
          <span className="truncate text-xs text-muted-foreground">
            {project.org}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <HealthBadge
          health={healthOf(project)}
          className="hidden sm:inline-flex"
        />
        {project.targetDate && (
          <span className="hidden tabular-nums sm:inline">
            {formatDay(project.targetDate, today)}
          </span>
        )}
        {project.archived ? (
          <span className="border px-1.5">Archived</span>
        ) : (
          <StatusPill status={project.status} />
        )}
      </span>
    </li>
  );
}

/** A person in the list: their name (to their room) and role. */
function PersonLine({ person }: { person: Person }) {
  return (
    <li data-flip-id={person.id} className={LINE}>
      <UserIcon className="ml-2 shrink-0 text-muted-foreground" aria-hidden />
      <a
        {...linkProps({ name: 'person', id: person.id })}
        className="min-w-0 truncate font-medium hover:underline"
      >
        {person.name}
      </a>
      {person.role && (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {person.role}
        </span>
      )}
    </li>
  );
}

/**
 * The rooms, in place of the items while the Rooms chip is on: every
 * project room under its org, with New project, and every person by how
 * much they owe you, with New person, each with Pin. Not `RoomLists`: that lists only the
 * pinned rooms (or the active projects) and the people owed, with no Pin
 * and no orgs; this is where the rest are found and pinned.
 */
function Rooms() {
  const { state } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const newPerson = useNewPerson();
  if (!state) return null;
  const orgs = projectRoomsByOrg(state.projects);
  const people = peopleByOwed(state);
  const grouped = orgs.some((g) => g.org);
  return (
    <section aria-labelledby="rooms-title" className="flex flex-col gap-4">
      {/* The Rooms chip, pressed, says what this is. */}
      <h2 id="rooms-title" className="sr-only">
        Rooms
      </h2>
      <div className="grid gap-8 desk:grid-cols-2">
        <section
          aria-labelledby="project-rooms"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 id="project-rooms" className="text-sm font-semibold">
              Projects
            </h3>
            <Button
              variant="ghost"
              className="press h-11 text-muted-foreground desk:h-8"
              onClick={() => openProjectForm()}
            >
              <FolderPlusIcon />
              New project
            </Button>
          </div>
          {orgs.length === 0 && <p className="text-state">No projects yet.</p>}
          {orgs.map((group) => (
            <div key={group.org} className="flex flex-col gap-1">
              {grouped && (
                <h4 className="text-xs font-medium text-muted-foreground">
                  {group.org || 'No org'}
                </h4>
              )}
              <ul className="flex flex-col border-t">
                {group.projects.map((p) => (
                  <RoomLine
                    key={p.id}
                    name={p.name}
                    room={{ kind: 'project', id: p.id }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section aria-labelledby="people-rooms" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id="people-rooms" className="text-sm font-semibold">
              People
            </h3>
            <Button
              variant="ghost"
              className="press h-11 text-muted-foreground desk:h-8"
              onClick={newPerson.open}
            >
              <UserPlusIcon />
              New person
            </Button>
          </div>
          {people.length === 0 ? (
            <p className="text-state">No people yet.</p>
          ) : (
            <ul className="flex flex-col border-t">
              {people.map(({ person, count }) => (
                <RoomLine
                  key={person.id}
                  name={person.name}
                  room={{ kind: 'person', id: person.id }}
                  note={count > 0 ? `owes you ${count}` : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      {newPerson.form}
    </section>
  );
}

function RoomLine({
  name,
  room,
  note,
}: {
  name: string;
  room: { kind: 'project'; id: string } | { kind: 'person'; id: string };
  note?: string;
}) {
  const { state } = useDatapad();
  return (
    <li className={cn(LINE, 'gap-2')}>
      <a
        {...linkProps(
          room.kind === 'project'
            ? projectHome(room.id, state ?? {})
            : { name: 'person', id: room.id },
        )}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 hover:underline desk:min-h-8"
      >
        <span className="truncate">{name}</span>
        {note && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {note}
          </span>
        )}
      </a>
      <PinButton room={room} name={name} />
    </li>
  );
}
