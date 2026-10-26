import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeProjects,
  agenda,
  assigneeFor,
  assigneeFromQuery,
  assigneeToQuery,
  type FocusBuckets,
  focusBuckets,
  meId,
} from '#shared/select';
import type { Task } from '#shared/types';
import { AgendaStrip } from '@/components/events/AgendaStrip';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { SelectField } from '@/components/inputs/SelectField';
import { Section } from '@/components/Section';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { TaskRow, type TaskRowProps } from '@/components/tasks/TaskRow';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { shortcutAllowed } from '@/lib/shortcuts';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

type BucketKey = keyof FocusBuckets;

const BUCKETS: { key: BucketKey; title: string; collapsed?: boolean }[] = [
  { key: 'blocked', title: 'Blocked' },
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Today' },
  { key: 'thisWeek', title: 'This week' },
  { key: 'later', title: 'Later', collapsed: true },
  { key: 'noDate', title: 'No date', collapsed: true },
];

/**
 * Focus, the morning view: the next seven days of events, then every open
 * task outside the archive bucketed Overdue / Today / This week, with
 * Later and No date collapsed. The buckets follow the local date and roll
 * over at midnight. The assignee filter (`m` toggles Mine) lives in the
 * URL and pre-assigns quick-added tasks. Rows FLIP between buckets when a
 * due date changes and out when a task closes.
 */
export function FocusPage() {
  usePageTitle('Focus');
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { toggle, isDone } = useTaskToggle();
  const { active } = useMotion();
  const { show } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  /** The task just quick-added: its bucket opens to show it. */
  const [added, setAdded] = useState<string | null>(null);
  const flipRoot = useRef<HTMLElement>(null);
  useFlip(flipRoot, active);

  const today = useToday();
  const whoParam = useQuery().get('who');
  const who = useMemo(() => assigneeFromQuery(whoParam), [whoParam]);
  const me = state ? meId(state.people) : null;
  const buckets = state
    ? focusBuckets(state.tasks, state.projects, today, me, who)
    : null;
  const week = state ? agenda(state.meetings, state.projects, today) : [];
  const projects = state ? activeProjects(state.projects).length : 0;
  const open = buckets
    ? BUCKETS.reduce((n, b) => n + buckets[b.key].length, 0)
    : 0;

  const setWho = useCallback(
    (value: string) =>
      setQuery(
        { who: value === 'anyone' ? null : value },
        {
          transition: (update) => withViewTransition(update, active, 'filter'),
        },
      ),
    [active],
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

  if (!state || !buckets) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const people = Object.values(state.people).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const revealed = BUCKETS.find((b) =>
    buckets[b.key].some((t) => t.id === added),
  )?.key;

  const list = (key: BucketKey, title: string) => (
    <ul aria-label={title} className="flex flex-col border-t">
      {buckets[key].map((task) => (
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
      <div className="flex flex-col gap-1">
        <h1 id="focus-title" className="text-page-title">
          Focus
        </h1>
        <p className="text-sm text-muted-foreground">
          {projects === 1 ? '1 project' : `${projects} projects`} ·{' '}
          {open === 1 ? '1 open task' : `${open} open tasks`}
        </p>
      </div>

      {week.length > 0 && (
        <AgendaStrip events={week} state={state} today={today} />
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
            setAdded(id);
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
        aria-label="Open tasks"
        className="flex flex-col gap-4"
      >
        {open === 0 ? (
          <p className="text-state">
            Nothing open. Add a task above or open a project.
          </p>
        ) : (
          BUCKETS.map(({ key, title, collapsed }) =>
            buckets[key].length === 0 ? null : collapsed ? (
              <Section
                key={key}
                title={title}
                count={buckets[key].length}
                storageKey={`datapad:focus:${key}`}
                defaultOpen={false}
                open={revealed === key}
                onToggle={() => setAdded(null)}
              >
                {list(key, title)}
              </Section>
            ) : (
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
                    {buckets[key].length}
                  </span>
                </h2>
                {list(key, title)}
              </section>
            ),
          )
        )}
      </section>
    </section>
  );
}
