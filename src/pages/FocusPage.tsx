import { useMemo, useState } from 'react';
import { localDate } from '#shared/dates';
import { activeProjects, agenda, focusBuckets } from '#shared/select';
import { EventRow } from '@/components/events/EventRow';
import { TaskList } from '@/components/tasks/TaskList';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

const ANYONE = { kind: 'anyone' } as const;

/**
 * Focus: what needs attention today. The agenda (events in the next seven
 * days, outside the archive), then, until the buckets arrive (M5), every
 * open task outside the archive, soonest due first, with a quick-add and
 * its project picker.
 */
export function FocusPage() {
  usePageTitle('Focus');
  const { state, actions } = useDatapad();
  const [projectId, setProjectId] = useState<string | null>(null);

  const today = localDate(new Date());
  const open = useMemo(() => {
    if (!state) return [];
    const b = focusBuckets(state.tasks, state.projects, today, null, ANYONE);
    return [...b.overdue, ...b.today, ...b.thisWeek, ...b.later, ...b.noDate];
  }, [state, today]);
  const projects = state ? activeProjects(state.projects).length : 0;
  const week = state ? agenda(state.events, state.projects, today) : [];

  return (
    <section
      aria-labelledby="focus-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1 id="focus-title" className="text-page-title">
          Focus
        </h1>
        {state && (
          <p className="text-sm text-muted-foreground">
            {projects === 1 ? '1 project' : `${projects} projects`} ·{' '}
            {open.length === 1 ? '1 open task' : `${open.length} open tasks`}
          </p>
        )}
      </div>

      {state && week.length > 0 && (
        <section aria-labelledby="agenda-title" className="flex flex-col">
          <h2
            id="agenda-title"
            className="border-b pb-1 font-heading text-sm font-semibold"
          >
            Next 7 days
          </h2>
          {week.map((e) => (
            <EventRow key={e.id} event={e} state={state} today={today} />
          ))}
        </section>
      )}

      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <TaskList
          label="Open tasks"
          open={open}
          quickAdd={{
            projectId,
            onProjectChange: setProjectId,
            onAdd: (title) => actions.addTask({ projectId, title }) !== null,
          }}
          empty="Nothing open. Add a task above or open a project."
        />
      )}
    </section>
  );
}
