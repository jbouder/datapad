import { useMemo, useState } from 'react';
import { localDate } from '#shared/dates';
import { activeProjects, focusBuckets } from '#shared/select';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

const ANYONE = { kind: 'anyone' } as const;

/**
 * Focus: what needs attention today. Until the buckets arrive (M5) and the
 * shared task rows (#20), this is a plain list of open tasks with a
 * quick-add and its project picker.
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

      <QuickAdd
        projectId={projectId}
        onProjectChange={setProjectId}
        onAdd={(title) => actions.addTask({ projectId, title }) !== null}
      />

      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : open.length === 0 ? (
        <p className="text-state">
          Nothing open. Add a task above or open a project.
        </p>
      ) : (
        <ul aria-label="Open tasks" className="flex flex-col border-t">
          {open.map((t) => (
            <li
              key={t.id}
              className="flex min-h-11 items-center border-b px-1 text-sm sm:min-h-9"
            >
              {t.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
