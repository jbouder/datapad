import {
  CalendarDotIcon,
  CalendarDotsIcon,
  CalendarPlusIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import {
  addDays,
  daysBetween,
  formatDay,
  formatTimeRange,
  longDay,
} from '#shared/dates';
import { lanesOf, waitingCount } from '#shared/loops';
import { briefOn, focusDays, savedFocusOptions } from '#shared/pages';
import { buildRecap, recapLine } from '#shared/recap';
import { unfiledCount } from '#shared/rooms';
import { meId } from '#shared/select';
import {
  dayEntries,
  dayLine,
  dueOn,
  localTime,
  nextMeeting,
  weekAround,
  weekDays,
  weekLine,
} from '#shared/today';
import { type Meeting, type Snapshot, topicsOf } from '#shared/types';
import { CaptureLine } from '@/components/capture/CaptureLine';
import {
  useView,
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow } from '@/components/tasks/TaskRow';
import { BriefCard, BriefMeButton } from '@/components/today/BriefMe';
import { DayTimeline } from '@/components/today/DayTimeline';
import { LoopLanes } from '@/components/today/LoopLanes';
import { RecapSection } from '@/components/today/Recap';
import { WeekZoom } from '@/components/today/WeekZoom';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useNow, useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { linkProps } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';
import { usePageSetting } from '@/providers/PagePrefsProvider';

type Zoom = 'day' | 'week';

/** Day or Week (`?view=week`; `/digest` lands on Week). */
const ZOOMS: readonly ViewOption<Zoom>[] = [
  { id: 'day', label: 'Day', icon: CalendarDotIcon },
  { id: 'week', label: 'Week', icon: CalendarDotsIcon },
];

const HEADING =
  'flex min-h-11 items-center gap-1.5 font-heading text-sm font-semibold desk:min-h-8';

/**
 * Today (`/`, #331), the home page: one day at a time. The header has
 * the long day, one line that counts it, and Previous, Today and Next.
 * Then the capture line; on today, the Next up card while a meeting is
 * ahead (within the days Settings → Today says); what is due (and late,
 * on today); and the timeline, with meetings as anchors and the Now line
 * at the current minute. Beside it on desktop, below it on phones: the
 * Unfiled card and the three lanes of open loops (`lanesOf`), each a
 * section that collapses, hides and moves (Settings → Today, saved under
 * Focus's key so its old settings carry over). Everything follows the
 * local date and rolls over at midnight; the day you step to is an
 * offset from today, so it rolls over too.
 *
 * #332 adds the rest. **Week** (`?view=week`, `v` cycles) zooms out to
 * the week around the day (`WeekZoom`): seven days and the week's
 * digest; Previous and Next step a week, a day's name zooms back into
 * it. The **recap** (`buildRecap`, as MCP's `get_recap` reads it) shows
 * above the timeline on the days of its window (the last working day),
 * and today's line links to it. **Brief me** asks the on-device model
 * for today's brief, shown in a card above the timeline.
 */
export function TodayPage() {
  usePageTitle('Today');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { newMeeting } = useMeetingForm();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const clock = useClock();
  const today = useToday();
  const nowMs = useNow();
  const [offset, setOffset] = useState(0);
  const [zoom, setZoom] = useView(null, ZOOMS, 'day');
  const day = addDays(today, offset);
  const lanesRoot = useRef<HTMLDivElement>(null);
  useFlip(lanesRoot, active);

  const who = usePageSetting('focus', 'who');
  const days = focusDays(usePageSetting('focus', 'days'));
  const brief = briefOn(usePageSetting('focus', 'brief'));
  const me = state ? meId(state.people) : null;
  const lanes = useMemo(() => {
    if (!state) return null;
    const all = lanesOf(state, me);
    // Mine shows only what is assigned to me, when Settings says so.
    return who === 'mine' && me
      ? { ...all, mine: all.mine.filter((t) => t.assignee === me) }
      : all;
  }, [state, me, who]);

  // The saved settings, as MCP reads them: the recap and Brief me match
  // `get_recap` and what the page narrows.
  const options = useMemo(
    () => (state ? savedFocusOptions(state) : null),
    [state],
  );
  const recap = useMemo(
    () =>
      state && options
        ? buildRecap(state, today, options.who, options.weekStart)
        : null,
    [state, options, today],
  );
  const weekStart = options?.weekStart ?? 'mon';
  const week = useMemo(
    () => (state && zoom === 'week' ? weekDays(state, day, weekStart) : null),
    [state, zoom, day, weekStart],
  );

  if (!state || !lanes || !options || !recap) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const isToday = offset === 0;
  const span = weekAround(day, weekStart);
  const weekHasToday = span.from <= today && today <= span.to;
  const step = zoom === 'week' ? 7 : 1;
  const inRecap = day >= recap.window.from && day <= recap.window.to;
  const recapText = recapLine(recap);
  const pick = (picked: string) => {
    setOffset(daysBetween(today, picked));
    setZoom('day');
  };
  const now = localTime(nowMs);
  const entries = dayEntries(state, day);
  const due = dueOn(state, day, today);
  const next = isToday ? nextMeeting(state, today, now, days) : null;
  const unfiled = unfiledCount(state.notes);
  const line = dayLine({
    meetings: entries.filter((e) => e.kind === 'meeting').length,
    due: due.length,
    waiting: waitingCount(lanes),
    decide: lanes.decide.length,
  });

  return (
    <section
      aria-labelledby="today-title"
      className="enter flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {(zoom === 'week' ? weekHasToday : isToday)
              ? zoom === 'week'
                ? 'This week'
                : 'Today'
              : offset < 0
                ? 'Looking back'
                : 'Looking ahead'}
          </p>
          <h1 id="today-title" className="text-page-title">
            {zoom === 'week'
              ? `${formatDay(span.from, today)} – ${formatDay(span.to, today)}`
              : longDay(day, today)}
          </h1>
          <p
            data-day-line
            className="truncate text-sm text-muted-foreground tabular-nums"
          >
            {week ? weekLine(week) : line}
          </p>
          {zoom === 'day' && isToday && recapText ? (
            <button
              type="button"
              data-recap-link
              onClick={() => setOffset(daysBetween(today, recap.window.from))}
              className="max-w-full self-start truncate text-left text-sm text-muted-foreground tabular-nums underline-offset-2 outline-ring/50 hover:text-foreground hover:underline focus-visible:outline-2"
            >
              {recapText}
            </button>
          ) : (
            // Holds the recap's line so the header keeps its height from day to day.
            <span aria-hidden className="text-sm">
              &nbsp;
            </span>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 desk:w-auto">
          {zoom === 'day' && isToday && brief && (
            <BriefMeButton today={today} options={options} />
          )}
          <ViewSwitcher views={ZOOMS} value={zoom} onChange={setZoom} />
          <nav
            aria-label={zoom === 'week' ? 'Week' : 'Day'}
            className="ml-auto flex items-center gap-1"
          >
            <Button
              variant="outline"
              size="icon"
              className="press size-11 desk:size-8"
              onClick={() => setOffset((o) => o - step)}
            >
              <CaretLeftIcon />
              <span className="sr-only">
                {zoom === 'week' ? 'Previous week' : 'Previous day'}
              </span>
            </Button>
            <Button
              variant="outline"
              className="press h-11 desk:h-8"
              aria-current={
                (zoom === 'week' ? weekHasToday : isToday) ? 'date' : undefined
              }
              onClick={() => setOffset(0)}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="press size-11 desk:size-8"
              onClick={() => setOffset((o) => o + step)}
            >
              <CaretRightIcon />
              <span className="sr-only">
                {zoom === 'week' ? 'Next week' : 'Next day'}
              </span>
            </Button>
          </nav>
        </div>
      </header>

      <CaptureLine />

      {week ? (
        <WeekZoom
          days={week}
          state={state}
          today={today}
          clock={clock}
          onPick={pick}
        />
      ) : (
        <div className="grid gap-6 desk:grid-cols-[minmax(0,1fr)_20rem] desk:gap-8">
          <div className="flex min-w-0 flex-col gap-6">
            {isToday && brief && <BriefCard today={today} options={options} />}

            {next && (
              <NextUp
                meeting={next}
                state={state}
                today={today}
                clock={clock}
              />
            )}

            {due.length > 0 && (
              <section aria-labelledby="due-title" className="flex flex-col">
                <h2 id="due-title" className={HEADING}>
                  <span>{isToday ? 'Due today or late' : 'Due'}</span>
                  <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                    {due.length}
                  </span>
                </h2>
                <ul aria-label="Due" className="flex flex-col border-t">
                  {due.map((task) => (
                    <li key={task.id}>
                      <TaskRow
                        task={task}
                        done={isDone(task)}
                        today={today}
                        projects={state.projects}
                        people={state.people}
                        onToggle={toggle}
                        onOpen={(t) => openTask(t.id)}
                        onEdit={(t, patch) =>
                          actions.editTask({ id: t.id, patch })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {inRecap && (
              <RecapSection
                recap={recap}
                projects={state.projects}
                people={state.people}
                today={today}
                onOpenTask={(t) => openTask(t.id)}
              />
            )}

            <section aria-labelledby="timeline-title" className="flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <h2 id="timeline-title" className={HEADING}>
                  Timeline
                </h2>
                <Button
                  variant="ghost"
                  className="press h-11 text-muted-foreground desk:h-8"
                  onClick={() => newMeeting({ projectId: null, date: day })}
                >
                  <CalendarPlusIcon />
                  Add meeting
                </Button>
              </div>
              <DayTimeline
                entries={entries}
                state={state}
                today={today}
                now={isToday ? now : null}
                clock={clock}
              />
            </section>
          </div>

          <aside
            aria-label="Open loops"
            className="flex min-w-0 flex-col gap-4"
          >
            <a
              {...linkProps({ name: 'unfiled' })}
              data-unfiled-card
              className="press flex min-h-11 flex-col gap-0.5 border p-3 outline-ring/50 hover:bg-accent focus-visible:outline-2"
            >
              <span className="text-sm font-medium">Unfiled</span>
              <span className="text-sm text-muted-foreground">
                {unfiled === 0
                  ? 'Nothing waiting for a home.'
                  : `${unfiled} ${unfiled === 1 ? 'note' : 'notes'} with no home yet.`}
              </span>
            </a>
            <div ref={lanesRoot} className="flex flex-col gap-4">
              <LoopLanes
                lanes={lanes}
                page="focus"
                today={today}
                projects={state.projects}
                people={state.people}
              />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

/**
 * The meeting coming up (or going on), with Enter meeting. It opens the
 * meeting in meeting mode (#336).
 */
function NextUp({
  meeting,
  state,
  today,
  clock,
}: {
  meeting: Meeting;
  state: Snapshot;
  today: string;
  clock: ReturnType<typeof useClock>;
}) {
  const project = meeting.projectId
    ? state.projects[meeting.projectId]
    : undefined;
  const open = topicsOf(meeting).filter((t) => !t.done).length;
  const people = meeting.attendees
    .map((id) => state.people[id]?.name)
    .filter(Boolean);
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
      aria-labelledby="next-up-title"
      data-next-up={meeting.id}
      className="flex flex-wrap items-center justify-between gap-3 border border-primary/50 bg-primary/5 p-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="next-up-title" className="text-xs font-medium text-primary">
          Next up
        </h2>
        <p className="font-medium">{meeting.title}</p>
        <p className="text-sm text-muted-foreground">
          {when}
          {project && ` · ${project.name}`}
          {people.length > 0 && ` · ${people.join(', ')}`}
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
