import { XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { addDays, formatTimeRange, longDay } from '#shared/dates';
import {
  type Meeting,
  type Person,
  type Project,
  topicsOf,
} from '#shared/types';
import { buttonVariants } from '@/components/ui/button';
import type { useClock } from '@/hooks/useClock';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * The frame every room shares (#334, and the person's room, #335): the
 * header (kicker, name, state line, a place for the on-device summary
 * (#339), the actions with Pin), the people to narrow it to, the Next
 * meeting card, the tabs when it has them, then its body. `RoomColumns`
 * lays out the Stream: the lanes beside the stream on desktop, above it
 * on phones.
 */
export function RoomFrame({
  titleId,
  header,
  filter,
  next,
  tabs,
  children,
  className,
}: {
  /** The id on the room's `<h1>`, which labels the room. */
  titleId: string;
  header: ReactNode;
  filter?: ReactNode;
  next?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      aria-labelledby={titleId}
      className={cn('enter flex min-w-0 flex-col gap-4', className)}
    >
      {header}
      {filter}
      {next}
      {tabs}
      {children}
    </article>
  );
}

/**
 * A room's header: the kicker (a project's org), the name as the page's
 * `<h1>`, the state line (its parts joined by middots), then `summary`,
 * the place the on-device summary goes (#339). `actions` sit on the
 * right on desktop and wrap under the name on phones.
 */
export function RoomHeader({
  titleId,
  kicker,
  title,
  titleEnd,
  stateLine,
  summary,
  actions,
}: {
  titleId: string;
  kicker: ReactNode;
  title: string;
  /** After the name, inside the `<h1>` (the person's "you" tag). */
  titleEnd?: ReactNode;
  stateLine: readonly string[];
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-col gap-3 desk:flex-row desk:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{kicker}</p>
          <h1
            id={titleId}
            className={cn(
              'text-page-title',
              titleEnd && 'flex flex-wrap items-center gap-2',
            )}
          >
            {title}
            {titleEnd}
          </h1>
          <p data-state-line className="text-sm text-muted-foreground">
            {stateLine.join(' · ')}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
      </div>
      {summary}
    </header>
  );
}

/** One chip in a room's filter. */
interface FilterChip {
  id: string;
  name: string;
  /** Read after the name by screen readers only (" (you)"). */
  srSuffix?: string;
}

/**
 * Chips that narrow a room (the address holds the pick): picking one
 * narrows it, picking it again or Clear shows everything. Each chip is
 * a link, so a narrowed room can be opened in a new tab and its address
 * kept. `chipAttr` names the data attribute each chip carries.
 */
function ChipFilter({
  chips,
  selected,
  hrefFor,
  label,
  chipAttr,
}: {
  chips: readonly FilterChip[];
  selected: string | null;
  hrefFor: (id: string | null) => { route: Route; query: string };
  label: string;
  chipAttr: 'data-person-chip' | 'data-project-chip';
}) {
  if (chips.length === 0) return null;
  const link = (id: string | null) => {
    const { route, query } = hrefFor(id);
    return linkProps(route, query);
  };
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <a
            key={c.id}
            {...link(on ? null : c.id)}
            aria-current={on ? 'true' : undefined}
            {...{ [chipAttr]: c.id }}
            className={cn(
              'press inline-flex h-11 items-center rounded-full border px-3 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 desk:h-7 desk:px-2.5 desk:text-xs',
              on && 'border-primary bg-primary/10 font-medium text-foreground',
            )}
          >
            {c.name}
            {c.srSuffix && <span className="sr-only">{c.srSuffix}</span>}
          </a>
        );
      })}
      {selected && (
        <a
          {...link(null)}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'press h-11 desk:h-7',
          )}
        >
          <XIcon />
          Clear
        </a>
      )}
    </nav>
  );
}

/**
 * The people a project's room can be narrowed to (#334), as chips
 * (`?person=`).
 */
export function PersonFilter({
  people,
  selected,
  hrefFor,
  label = 'Narrow to a person',
}: {
  people: readonly Person[];
  selected: string | null;
  /** The address with `person` picked, or with no one for null. */
  hrefFor: (person: string | null) => { route: Route; query: string };
  label?: string;
}) {
  return (
    <ChipFilter
      chips={people.map((p) => ({
        id: p.id,
        name: p.name,
        srSuffix: p.me ? ' (you)' : undefined,
      }))}
      selected={selected}
      hrefFor={hrefFor}
      label={label}
      chipAttr="data-person-chip"
    />
  );
}

/**
 * The projects a person's room can be narrowed to (#335), as chips
 * (`?project=`): the project room's person filter from the other side.
 */
export function ProjectFilter({
  projects,
  selected,
  hrefFor,
  label = 'Narrow to a project',
}: {
  projects: readonly Project[];
  selected: string | null;
  /** The address with `project` picked, or with none for null. */
  hrefFor: (project: string | null) => { route: Route; query: string };
  label?: string;
}) {
  return (
    <ChipFilter
      chips={projects.map((p) => ({ id: p.id, name: p.name }))}
      selected={selected}
      hrefFor={hrefFor}
      label={label}
      chipAttr="data-project-chip"
    />
  );
}

/**
 * The meeting coming up in a room, with Enter meeting. It opens the
 * meeting's page until meeting mode lands (#336).
 */
export function NextMeeting({
  meeting,
  today,
  clock,
  people,
}: {
  meeting: Meeting;
  today: string;
  clock: ReturnType<typeof useClock>;
  people: Record<string, Person>;
}) {
  const open = topicsOf(meeting).filter((t) => !t.done).length;
  const names = meeting.attendees.map((id) => people[id]?.name).filter(Boolean);
  const when = [
    meeting.date === today
      ? 'Today'
      : meeting.date === addDays(today, 1)
        ? 'Tomorrow'
        : longDay(meeting.date, today),
    meeting.time
      ? formatTimeRange(meeting.time, meeting.end, clock)
      : 'All day',
  ].join(', ');
  return (
    <section
      aria-labelledby="room-next-title"
      data-next-meeting={meeting.id}
      className="flex flex-wrap items-center justify-between gap-3 border border-primary/50 bg-primary/5 p-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="room-next-title" className="text-xs font-medium text-primary">
          Next meeting
        </h2>
        <p className="font-medium">{meeting.title}</p>
        <p className="text-sm text-muted-foreground">
          {when}
          {names.length > 0 && ` · ${names.join(', ')}`}
          {open > 0 && ` · ${open} ${open === 1 ? 'topic' : 'topics'}`}
        </p>
      </div>
      <a
        {...linkProps({ name: 'meeting', id: meeting.id })}
        className="press inline-flex h-11 items-center bg-primary px-4 text-sm font-medium text-primary-foreground outline-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2 desk:h-8"
      >
        Enter meeting
      </a>
    </section>
  );
}

export interface RoomTabLink<T extends string> {
  key: T;
  label: string;
  route: Route;
  query?: string;
}

/**
 * A room's tabs, as links (each tab is its own address): the current
 * one carries `aria-current="page"`.
 */
export function RoomTabs<T extends string>({
  tabs,
  current,
  label = 'Room',
  end,
}: {
  tabs: readonly RoomTabLink<T>[];
  current: T;
  label?: string;
  /** After the tabs, at the right (the board's menu). */
  end?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-1 border-b">
      <nav aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.key === current;
          return (
            <a
              key={tab.key}
              {...linkProps(tab.route, tab.query)}
              aria-current={on ? 'page' : undefined}
              data-room-tab={tab.key}
              className={cn(
                'inline-flex h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-sm text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 desk:h-9',
                on && 'border-primary font-medium text-foreground',
              )}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>
      {end}
    </div>
  );
}

/**
 * The Stream tab's layout: the lanes in a narrow column on the left on
 * desktop and above the stream on phones, the stream beside them.
 */
export function RoomColumns({
  lanes,
  stream,
}: {
  lanes: ReactNode;
  stream: ReactNode;
}) {
  return (
    <div className="grid gap-6 desk:grid-cols-[20rem_minmax(0,1fr)] desk:gap-8">
      <aside aria-label="Open loops" className="flex min-w-0 flex-col gap-4">
        {lanes}
      </aside>
      <div className="flex min-w-0 flex-col gap-3">{stream}</div>
    </div>
  );
}
