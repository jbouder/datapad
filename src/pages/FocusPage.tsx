import { CalendarDotIcon, CalendarDotsIcon } from '@phosphor-icons/react';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { formatDay } from '#shared/dates';
import { focusOptions } from '#shared/pages';
import { buildRecap, recapEmpty } from '#shared/recap';
import {
  agenda,
  attention,
  attentionLine,
  byDueDate,
  byPriority,
  type DueDateKey,
  type DueKey,
  daysSince,
  focusBuckets,
  focusDue,
  followUps,
  meId,
  movementLine,
  taskNoteCounts,
  waitingFor,
  waitingOn,
  weekMovement,
} from '#shared/select';
import { healthOf, type Task } from '#shared/types';
import { BriefCard, BriefMeButton } from '@/components/focus/BriefMe';
import { SinceYesterday } from '@/components/focus/SinceYesterday';
import { Segmented } from '@/components/inputs/Segmented';
import {
  useView,
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { AgendaStrip } from '@/components/meetings/AgendaStrip';
import { PRIORITY_LABELS } from '@/components/PriorityDot';
import { HEALTH_LABELS, HealthDot } from '@/components/projects/Health';
import { OrderedSections, Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { linkProps } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';
import {
  usePageQuery,
  usePageSections,
  usePageSetting,
} from '@/providers/PagePrefsProvider';

type FocusView = 'day' | 'week';

export const FOCUS_VIEWS: readonly ViewOption<FocusView>[] = [
  { id: 'day', label: 'Day', icon: CalendarDotIcon },
  { id: 'week', label: 'Week', icon: CalendarDotsIcon },
];

/**
 * The buckets Due draws from in each view, grouped by priority; High
 * priority tasks show whatever their date (`focusDue`).
 */
const DUE: Record<FocusView, DueKey[]> = {
  day: ['overdue', 'today'],
  week: ['overdue', 'today', 'upcoming'],
};

/** Due's groups when grouped by date (#311). */
const DUE_DATE_LABELS: Record<DueDateKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  later: 'Later',
  noDate: 'No date',
};

/** A group's header in Waiting on and Follow-ups: 44px on touch. */
const GROUP_HEAD =
  'flex min-h-11 flex-wrap items-center gap-x-1.5 pt-1 text-sm desk:min-h-8';
const GROUP_LINK =
  'font-medium underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';

/**
 * Focus, the morning briefing (#206), as Day (the default) or Week
 * (`?view=`, then what is saved for the page; `v` switches). The header
 * has the week's movement, and Brief me (#259) where summaries are on:
 * its card, the model's paragraph about yesterday and today, sits on top
 * of the sections and replaces none of them. Then, each only when it has something: Since
 * yesterday (the last working day's recap, #258, the same in Day and
 * Week), the agenda (today's meetings and milestones, or the next seven days'
 * in Week, or as many as Settings → Pages says, `days`), each
 * meeting with its prep), Waiting on (blocked tasks by who they wait on),
 * Attention (active projects off health, near or past their target, or
 * quiet), Follow-ups (open action items from the last week's meetings)
 * and Due (overdue and today's tasks, plus the next seven days' in
 * Week, and every High priority task whatever its date, grouped by
 * priority, High first, or by date; #218). Since yesterday, Waiting
 * on, Attention and Follow-ups are sections remembered with the page.
 * Settings → Pages hides and reorders the sections and sets the rules
 * (#311, `focusOptions()`): Tasks for (`?who=`, everyone's or Mine,
 * narrowing Due, Waiting on, Follow-ups and Since yesterday), Group Due
 * by (`?group=`), Attention's target, quiet and yellow rules, and how far
 * back Follow-ups looks. A hidden section still feeds Brief me. Tasks are
 * added from the + menu or `n` (the new-task panel).
 * Everything follows the local date and rolls over at midnight; rows FLIP
 * between groups when a priority changes and out when a task closes.
 */
export function FocusPage() {
  usePageTitle('Focus');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const flipRoot = useRef<HTMLElement>(null);
  useFlip(flipRoot, active);

  const [view, setView] = useView('focus', FOCUS_VIEWS, 'day');
  // Focus's settings: the address over what is saved (`?who=`, `?group=`,
  // `?days=`), and the rules set in Settings → Pages only.
  const [query, changeQuery] = usePageQuery('focus');
  const target = usePageSetting('focus', 'target');
  const quiet = usePageSetting('focus', 'quiet');
  const yellow = usePageSetting('focus', 'yellow');
  const followDays = usePageSetting('focus', 'followDays');
  const people = state?.people;
  const whoValue = query.get('who');
  const groupValue = query.get('group');
  const daysValue = query.get('days');
  const options = useMemo(
    () =>
      focusOptions(
        {
          who: whoValue,
          group: groupValue,
          days: daysValue,
          target,
          quiet,
          yellow,
          followDays,
        },
        people ?? {},
      ),
    [
      whoValue,
      groupValue,
      daysValue,
      target,
      quiet,
      yellow,
      followDays,
      people,
    ],
  );
  const { days } = options;
  const { visible } = usePageSections('focus');
  const today = useToday();
  const me = state ? meId(state.people) : null;

  const onEdit = useCallback<NonNullable<TaskRowProps['onEdit']>>(
    (task, patch) => {
      actions.editTask({ id: task.id, patch });
    },
    [actions],
  );
  const onOpen = useCallback((task: Task) => openTask(task.id), [openTask]);

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const movement = weekMovement(state.tasks, state.projects, today);
  const recap = buildRecap(state, today, options.who);
  const noRecap = recapEmpty(recap);
  const week = agenda(state.meetings, state.projects, today, days);
  const upcoming =
    view === 'day' ? week.filter((item) => item.date === today) : week;
  const waiting = waitingOn(
    state.tasks,
    state.projects,
    state.people,
    me,
    options.who,
  );
  const projects = attention(
    state.projects,
    today,
    options.targetDays,
    options.quietDays,
    options.yellow,
  );
  const follow = followUps(
    state.meetings,
    state.tasks,
    state.projects,
    today,
    me,
    options.who,
    options.followUpDays,
  );
  const buckets = focusBuckets(
    state.tasks,
    state.projects,
    today,
    me,
    options.who,
    days,
  );
  // A task shows once: an action item under its meeting, not in Due too.
  const followed = new Set(follow.flatMap((g) => g.tasks.map((t) => t.id)));
  const dueTasks = focusDue(buckets, DUE[view]).filter(
    (t) => !followed.has(t.id),
  );
  const due =
    options.group === 'date'
      ? byDueDate(buckets, dueTasks).map(({ key, tasks }) => ({
          key,
          title: DUE_DATE_LABELS[key],
          tasks,
        }))
      : byPriority(dueTasks).map(({ priority, tasks }) => ({
          key: priority,
          title:
            priority === 'none'
              ? PRIORITY_LABELS.none
              : `${PRIORITY_LABELS[priority]} priority`,
          tasks,
        }));
  const waitingCount = waiting.reduce((n, g) => n + g.tasks.length, 0);
  const followCount = follow.reduce((n, g) => n + g.tasks.length, 0);
  // What each section has; the empty state counts only the ones shown.
  const has: Record<string, boolean> = {
    recap: !noRecap,
    agenda: upcoming.length > 0,
    waiting: waiting.length > 0,
    attention: projects.length > 0,
    followUps: follow.length > 0,
    due: due.length > 0,
  };
  const empty = visible.every((key) => !has[key]);

  const notes = taskNoteCounts(state.notes);

  const list = (tasks: Task[], label: string) => (
    <ul aria-label={label} className="flex flex-col border-t">
      {tasks.map((task) => (
        <li key={task.id} data-flip-id={task.id}>
          <TaskRow
            task={task}
            done={isDone(task)}
            today={today}
            projects={state.projects}
            people={state.people}
            onToggle={toggle}
            onOpen={onOpen}
            onEdit={onEdit}
            noteCount={notes.get(task.id)}
          />
        </li>
      ))}
    </ul>
  );

  // Each section, or nothing when it has nothing; shown in the saved
  // order without the hidden ones (`OrderedSections`, #311).
  const sections: Record<string, ReactNode> = {
    recap: has.recap && (
      <SinceYesterday
        recap={recap}
        projects={state.projects}
        people={state.people}
        today={today}
        onOpenTask={onOpen}
      />
    ),
    agenda: has.agenda && (
      <AgendaStrip
        items={upcoming}
        state={state}
        today={today}
        title={view === 'day' ? 'Today’s agenda' : `Next ${days} days`}
      />
    ),
    waiting: has.waiting && (
      <Section
        title="Waiting on"
        count={waitingCount}
        remember={{ page: 'focus', key: 'waiting' }}
      >
        <div className="flex flex-col gap-2">
          {waiting.map((group) => {
            const name = group.person?.name ?? 'Not on anyone';
            const id = `waiting-${group.person?.id ?? 'none'}`;
            return (
              <section
                key={id}
                aria-labelledby={id}
                data-waiting={group.person?.id ?? ''}
                className="flex flex-col"
              >
                <h3 id={id} className={GROUP_HEAD}>
                  {group.person ? (
                    <a
                      {...linkProps({
                        name: 'people',
                        person: group.person.id,
                      })}
                      className={GROUP_LINK}
                    >
                      {name}
                    </a>
                  ) : (
                    <span className="font-medium">{name}</span>
                  )}
                  <span className="count text-xs text-muted-foreground tabular-nums">
                    {group.tasks.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {waitingFor(daysSince(group.since, today))}
                  </span>
                </h3>
                {list(group.tasks, `Waiting on ${name}`)}
              </section>
            );
          })}
        </div>
      </Section>
    ),
    attention: has.attention && (
      <Section
        title="Attention"
        count={projects.length}
        remember={{ page: 'focus', key: 'attention' }}
      >
        <ul
          aria-label="Projects that need attention"
          className="flex flex-col border-t"
        >
          {projects.map(({ project, reasons }) => {
            const health = healthOf(project);
            return (
              <li
                key={project.id}
                data-attention={project.id}
                className="flex min-h-11 flex-col justify-center gap-0.5 border-b py-1.5 desk:min-h-9"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HealthDot health={health} />
                  <a
                    {...linkProps({ name: 'project', id: project.id })}
                    className={`${GROUP_LINK} truncate text-sm`}
                  >
                    {project.name}
                  </a>
                  {health !== 'none' && (
                    <span className="sr-only">
                      , {HEALTH_LABELS[health]} health
                    </span>
                  )}
                </span>
                <span className="pl-4 text-xs text-muted-foreground tabular-nums">
                  {attentionLine(reasons)}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    ),
    followUps: has.followUps && (
      <Section
        title="Follow-ups"
        count={followCount}
        remember={{ page: 'focus', key: 'followUps' }}
      >
        <div className="flex flex-col gap-2">
          {follow.map(({ meeting, tasks }) => {
            const id = `follow-${meeting.id}`;
            return (
              <section
                key={meeting.id}
                aria-labelledby={id}
                data-follow-up={meeting.id}
                className="flex flex-col"
              >
                <h3 id={id} className={GROUP_HEAD}>
                  <a
                    {...linkProps({ name: 'meeting', id: meeting.id })}
                    className={GROUP_LINK}
                  >
                    {meeting.title}
                  </a>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDay(meeting.date, today)}
                  </span>
                  <span className="count text-xs text-muted-foreground tabular-nums">
                    · {tasks.length} open
                  </span>
                </h3>
                {list(tasks, `Action items from ${meeting.title}`)}
              </section>
            );
          })}
        </div>
      </Section>
    ),
    due: has.due && (
      <section aria-label="Due" className="flex flex-col gap-4">
        {due.map(({ key, title, tasks }) => (
          <section
            key={key}
            aria-labelledby={`due-${key}`}
            data-priority={options.group === 'priority' ? key : undefined}
            data-due={options.group === 'date' ? key : undefined}
            className="flex flex-col"
          >
            <h2
              id={`due-${key}`}
              className="flex min-h-11 items-center gap-1.5 font-heading text-sm font-semibold desk:min-h-8"
            >
              <span>{title}</span>
              <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                {tasks.length}
              </span>
            </h2>
            {list(tasks, title)}
          </section>
        ))}
      </section>
    ),
  };

  return (
    <section
      aria-labelledby="focus-title"
      className="enter flex min-w-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="focus-title" className="text-page-title">
            Focus
          </h1>
          <p
            data-movement
            className="text-sm text-muted-foreground tabular-nums"
          >
            {movementLine(movement)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {me && (
            <Segmented
              legend="Tasks for"
              legendHidden
              value={options.who.kind === 'mine' ? 'mine' : 'anyone'}
              options={[
                { value: 'anyone', label: 'Anyone' },
                { value: 'mine', label: 'Mine' },
              ]}
              onChange={(v) => changeQuery({ who: v === 'anyone' ? null : v })}
            />
          )}
          <ViewSwitcher views={FOCUS_VIEWS} value={view} onChange={setView} />
          <BriefMeButton today={today} options={options} />
        </div>
      </div>

      <BriefCard today={today} options={options} />

      <section
        ref={flipRoot}
        aria-label="Briefing"
        className="flex flex-col gap-4"
      >
        {empty && (
          <p className="text-state">
            Nothing needs you. Add a task with + or n, or open a project.
          </p>
        )}
        <OrderedSections page="focus" sections={sections} />
      </section>
    </section>
  );
}
