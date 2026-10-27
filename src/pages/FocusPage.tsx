import { CalendarDotIcon, CalendarDotsIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import {
  agenda,
  assigneeFor,
  assigneeFromQuery,
  assigneeToQuery,
  attention,
  attentionLine,
  daysSince,
  type FocusBuckets,
  focusBuckets,
  followUps,
  meId,
  movementLine,
  taskNoteCounts,
  waitingFor,
  waitingOn,
  weekMovement,
} from '#shared/select';
import { healthOf, type Task } from '#shared/types';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { SelectField } from '@/components/inputs/SelectField';
import {
  useView,
  type ViewOption,
  ViewSwitcher,
} from '@/components/layouts/ViewSwitcher';
import { AgendaStrip } from '@/components/meetings/AgendaStrip';
import { HEALTH_LABELS, HealthDot } from '@/components/projects/Health';
import { Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withViewTransition } from '@/lib/motion';
import { linkProps } from '@/lib/router';
import { shortcutAllowed } from '@/lib/shortcuts';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

type FocusView = 'day' | 'week';
type DueKey = Extract<keyof FocusBuckets, 'overdue' | 'today' | 'thisWeek'>;

export const FOCUS_VIEWS: readonly ViewOption<FocusView>[] = [
  { id: 'day', label: 'Day', icon: CalendarDotIcon },
  { id: 'week', label: 'Week', icon: CalendarDotsIcon },
];

/** Due's buckets; `views` lists the views that show the bucket. */
const DUE: { key: DueKey; title: string; views: FocusView[] }[] = [
  { key: 'overdue', title: 'Overdue', views: ['day', 'week'] },
  { key: 'today', title: 'Today', views: ['day', 'week'] },
  { key: 'thisWeek', title: 'This week', views: ['week'] },
];

/** A group's header in Waiting on and Follow-ups: 44px on touch. */
const GROUP_HEAD =
  'flex min-h-11 flex-wrap items-center gap-x-1.5 pt-1 text-sm desk:min-h-8';
const GROUP_LINK =
  'font-medium underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2';

/**
 * Focus, the morning briefing (#206), as Day (the default) or Week
 * (`?view=`, then what is saved for the page; `v` switches). The header
 * has the week's movement. Then, each only when it has something: the
 * agenda (today's meetings and milestones, or the next seven days', each
 * meeting with its prep), Waiting on (blocked tasks by who they wait on),
 * Attention (active projects off health, near or past their target, or
 * quiet), Follow-ups (open action items from the last week's meetings)
 * and Due (Overdue and Today, plus This week in Week). Waiting on,
 * Attention and Follow-ups are sections remembered with the page. The
 * assignee filter (`m` toggles Mine) lives in the URL, narrows Waiting
 * on, Follow-ups and Due, and pre-assigns quick-added tasks. Everything
 * follows the local date and rolls over at midnight; rows FLIP between
 * buckets when a due date changes and out when a task closes.
 */
export function FocusPage() {
  usePageTitle('Focus');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const { show } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const flipRoot = useRef<HTMLElement>(null);
  useFlip(flipRoot, active);

  const [view, setView] = useView('focus', FOCUS_VIEWS, 'day');
  const today = useToday();
  const [query, changePage] = usePageQuery('focus');
  const whoParam = query.get('who');
  const who = useMemo(() => assigneeFromQuery(whoParam), [whoParam]);
  const me = state ? meId(state.people) : null;

  const setWho = useCallback(
    (value: string) =>
      changePage(
        { who: value === 'anyone' ? null : value },
        {
          transition: (update) => withViewTransition(update, active, 'filter'),
        },
      ),
    [active, changePage],
  );

  // `m`: Mine, or back to Anyone.
  const whoKind = who.kind;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'm' || !shortcutAllowed(event)) return;
      event.preventDefault();
      if (whoKind === 'mine') {
        setWho('anyone');
      } else if (me) {
        setWho('mine');
      } else {
        show('Mark yourself in Settings → People to use Mine.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [whoKind, me, setWho, show]);

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
  const week = agenda(state.meetings, state.projects, today);
  const upcoming =
    view === 'day' ? week.filter((item) => item.date === today) : week;
  const waiting = waitingOn(state.tasks, state.projects, state.people, me, who);
  const projects = attention(state.projects, today);
  const follow = followUps(
    state.meetings,
    state.tasks,
    state.projects,
    today,
    me,
    who,
  );
  const buckets = focusBuckets(state.tasks, state.projects, today, me, who);
  // A task shows once: an action item under its meeting, not in Due too.
  const followed = new Set(follow.flatMap((g) => g.tasks.map((t) => t.id)));
  const due = DUE.flatMap((b) => {
    if (!b.views.includes(view)) return [];
    const tasks = buckets[b.key].filter((t) => !followed.has(t.id));
    return tasks.length > 0 ? [{ ...b, tasks }] : [];
  });
  const waitingCount = waiting.reduce((n, g) => n + g.tasks.length, 0);
  const followCount = follow.reduce((n, g) => n + g.tasks.length, 0);
  const empty =
    upcoming.length === 0 &&
    waiting.length === 0 &&
    projects.length === 0 &&
    follow.length === 0 &&
    due.length === 0;

  const people = Object.values(state.people).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
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
        <ViewSwitcher views={FOCUS_VIEWS} value={view} onChange={setView} />
      </div>

      {upcoming.length > 0 && (
        <AgendaStrip
          items={upcoming}
          state={state}
          today={today}
          title={view === 'day' ? 'Today’s agenda' : 'Next 7 days'}
        />
      )}

      <div className="grid grid-cols-1 gap-3 desk:grid-cols-[minmax(0,1fr)_14rem] desk:items-end">
        <QuickAdd
          projectId={projectId}
          onProjectChange={setProjectId}
          onAdd={(title) => {
            const id = actions.addTask({
              projectId,
              title,
              assignee: assigneeFor(who, me) || undefined,
            });
            if (id === null) return false;
            // No date yet, so not in Due: say where it went.
            show(`Added “${title.trim()}”`, undefined, {
              label: 'Open',
              run: () => openTask(id),
            });
            return true;
          }}
        />
        <SelectField
          label="Assignee"
          value={assigneeToQuery(who)}
          options={[
            { value: 'anyone', label: 'Anyone' },
            ...(me ? [{ value: 'mine', label: 'Mine' }] : []),
            { value: 'unassigned', label: 'Unassigned' },
            ...people.map((p) => ({ value: `p:${p.id}`, label: p.name })),
          ]}
          onChange={setWho}
        />
      </div>

      <section
        ref={flipRoot}
        aria-label="Briefing"
        className="flex flex-col gap-4"
      >
        {empty && (
          <p className="text-state">
            Nothing needs you. Add a task above or open a project.
          </p>
        )}

        {waiting.length > 0 && (
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
        )}

        {projects.length > 0 && (
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
        )}

        {follow.length > 0 && (
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
        )}

        {due.length > 0 && (
          <section aria-label="Due" className="flex flex-col gap-4">
            {due.map(({ key, title, tasks }) => (
              <section
                key={key}
                aria-labelledby={`bucket-${key}`}
                className="flex flex-col"
              >
                <h2
                  id={`bucket-${key}`}
                  className="flex min-h-11 items-center gap-1.5 font-heading text-sm font-semibold desk:min-h-8"
                >
                  <span className={key === 'overdue' ? 'text-destructive' : ''}>
                    {title}
                  </span>
                  <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                    {tasks.length}
                  </span>
                </h2>
                {list(tasks, title)}
              </section>
            ))}
          </section>
        )}
      </section>
    </section>
  );
}
