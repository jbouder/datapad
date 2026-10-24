import { PlusIcon } from '@phosphor-icons/react';
import { type FormEvent, useMemo, useState } from 'react';
import { localDate } from '#shared/dates';
import { activeProjects, focusBuckets } from '#shared/select';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

const ANYONE = { kind: 'anyone' } as const;

/**
 * Focus: what needs attention today. Until the buckets arrive (M5) and the
 * shared task rows and quick-add (M2, #20), this is a plain list of open
 * tasks with a General quick-add, enough to use the data layer end to end.
 */
export function FocusPage() {
  usePageTitle('Focus');
  const { state, actions } = useDatapad();
  const [title, setTitle] = useState('');

  const today = localDate(new Date());
  const open = useMemo(() => {
    if (!state) return [];
    const b = focusBuckets(state.tasks, state.projects, today, null, ANYONE);
    return [...b.overdue, ...b.today, ...b.thisWeek, ...b.later, ...b.noDate];
  }, [state, today]);
  const projects = state ? activeProjects(state.projects).length : 0;

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (actions.addTask({ projectId: null, title })) {
      setTitle('');
    }
  };

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

      <form onSubmit={add} className="relative">
        <label htmlFor="quick-add" className="sr-only">
          Add a task
        </label>
        <PlusIcon
          weight="bold"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="quick-add"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 pl-8 text-base sm:h-9 md:text-sm"
        />
      </form>

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
