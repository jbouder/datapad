import {
  CalendarBlankIcon,
  ChalkboardSimpleIcon,
  CheckSquareIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ALL_STATUS_OPTIONS,
  type AllFilters,
  type AllRow,
  activeAllFilters,
  allQuery,
  allTags,
  clearedAllFilters,
  defaultSort,
  filtersFor,
  KIND_LABELS,
  parseAllQuery,
  selectAll,
  sortsFor,
} from '#shared/all';
import { formatDay } from '#shared/dates';
import { peopleByOwed, projectRoomsByOrg } from '#shared/rooms';
import { ALL_KINDS, type AllKind } from '#shared/routes';
import { meId, taskNoteCounts } from '#shared/select';
import { DUE_BUCKETS } from '#shared/tasks';
import { healthOf, type Person, type Project, type Task } from '#shared/types';
import { FindField } from '@/components/inputs/FindField';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { SortField } from '@/components/inputs/SortField';
import {
  ListEmpty,
  type ListFilters,
  ListToolbar,
} from '@/components/layouts/ListToolbar';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { NoteRow } from '@/components/notes/NoteRow';
import { useNotes } from '@/components/notes/NotesProvider';
import { PinButton } from '@/components/PinButton';
import { HealthBadge } from '@/components/projects/Health';
import { StatusPill } from '@/components/projects/StatusPill';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { Button, buttonVariants } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withViewTransition } from '@/lib/motion';
import { linkProps, navigate, useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

const KIND_ICONS: Record<AllKind, Icon> = {
  task: CheckSquareIcon,
  note: NoteIcon,
  meeting: CalendarBlankIcon,
  project: FoldersIcon,
  person: UserIcon,
};

/** How many rows show before Show more. */
const PAGE = 100;

/** The select value that stands for "any" (an empty value is none). */
const ANY = 'any';

/**
 * All (`/all`, #337): every item of every kind in one list. The kind
 * chips pick some kinds (none is every kind); the toolbar's Find, filters
 * and Sort follow the kinds picked, and everything lives in the address
 * (`shared/all.ts` reads and writes it). Each kind keeps its own row:
 * a task opens its panel, a note opens in place (`?note=<id>` opens and
 * highlights one), a meeting goes to its page, a project or a person to
 * their room. Below the list, the rooms with their pins, and the space's
 * whiteboard from the header.
 *
 * Layouts, saved views and bulk actions come with #338.
 */
export function AllPage() {
  usePageTitle('All');
  const { state, actions } = useDatapad();
  const { hidden } = useNotes();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const today = useToday();
  const query = useQuery();
  const value = query.toString();
  const filters = useMemo(
    () => parseAllQuery(new URLSearchParams(value)),
    [value],
  );
  const target = query.get('note');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);

  /** Show `next`: the kinds as the route's, the rest as its query. */
  const change = useCallback(
    (next: AllFilters, transition = true) => {
      const params = new URLSearchParams();
      for (const [key, v] of Object.entries(allQuery(next))) {
        if (v) params.set(key, v);
      }
      const go = () =>
        navigate(
          { name: 'all', kinds: next.kinds },
          { query: params.toString(), replace: !transition },
        );
      if (transition) withViewTransition(go, active, 'filter');
      else go();
      setLimit(PAGE);
    },
    [active],
  );
  const set = (patch: Partial<AllFilters>, transition = true) =>
    change({ ...filters, ...patch }, transition);

  const rows = useMemo(
    () => (state ? selectAll(state, filters, today, hidden) : []),
    [state, filters, today, hidden],
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

  const toggleKind = (kind: AllKind) => {
    const kinds = filters.kinds.includes(kind)
      ? filters.kinds.filter((k) => k !== kind)
      : ALL_KINDS.filter((k) => k === kind || filters.kinds.includes(k));
    // The new kinds start at their own sort.
    change({ ...filters, kinds, sort: defaultSort(kinds), dir: 'asc' });
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

  return (
    <div className="enter flex flex-col gap-10">
      <section aria-labelledby="all-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 id="all-title" className="text-page-title flex-1">
            All
          </h1>
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
          <legend className="sr-only">Kinds</legend>
          <div className="flex w-max gap-1 pr-4 sm:w-auto sm:flex-wrap sm:pr-0">
            {ALL_KINDS.map((kind) => {
              const on = filters.kinds.includes(kind);
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
          </div>
        </fieldset>

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
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
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
                    set({ decide: v === 'decide', waiting: v === 'waiting' })
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

        {rows.length === 0 ? (
          <ListEmpty state={listFilters}>Nothing here yet.</ListEmpty>
        ) : (
          <ul
            ref={list}
            aria-label="Items"
            className="vt-list flex flex-col border-t"
          >
            {shown.map(row)}
          </ul>
        )}
        {shown.length < rows.length && (
          <Button
            variant="outline"
            className="press h-11 self-start desk:h-8"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show more ({rows.length - shown.length} left)
          </Button>
        )}
      </section>

      <Rooms />
    </div>
  );
}

const LINE =
  'flex min-h-11 items-center gap-3 border-b py-1.5 pr-1 text-sm desk:min-h-9';

/** A project in the list: its name (to its room), org, status, health, target. */
function ProjectLine({ project }: { project: Project }) {
  const today = useToday();
  return (
    <li data-flip-id={project.id} className={LINE}>
      <FoldersIcon
        className="ml-2 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col desk:flex-row desk:items-center desk:gap-3">
        <a
          {...linkProps({ name: 'project', id: project.id })}
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
 * The rooms, below the list: project rooms under their orgs, and people
 * by how much they owe you, each with Pin.
 */
function Rooms() {
  const { state } = useDatapad();
  if (!state) return null;
  const orgs = projectRoomsByOrg(state.projects);
  const people = peopleByOwed(state);
  const grouped = orgs.some((g) => g.org);
  return (
    <section aria-labelledby="rooms-title" className="flex flex-col gap-4">
      <h2 id="rooms-title" className="font-heading text-xl font-semibold">
        Rooms
      </h2>
      <div className="grid gap-8 desk:grid-cols-2">
        <section
          aria-labelledby="project-rooms"
          className="flex flex-col gap-3"
        >
          <h3 id="project-rooms" className="text-sm font-semibold">
            Projects
          </h3>
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
          <h3 id="people-rooms" className="text-sm font-semibold">
            People
          </h3>
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
  return (
    <li className={cn(LINE, 'gap-2')}>
      <a
        {...linkProps(
          room.kind === 'project'
            ? { name: 'project', id: room.id }
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
