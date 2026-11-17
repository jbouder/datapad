/** Prototype: the pieces the screens share. */
import type { MouseEvent, ReactNode } from 'react';
import { formatDay } from '#shared/dates';
import { meId } from '#shared/select';
import { blockedOf, type Snapshot, type Task } from '#shared/types';
import { Checkbox } from '@/components/ui/checkbox';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import type { Lanes } from './model';
import { go, type V2Route, v2Path } from './nav';

export function Go({
  to,
  className,
  children,
  label,
}: {
  to: V2Route;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a
      href={v2Path(to)}
      onClick={onClick}
      aria-label={label}
      className={cn(
        'outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
    </a>
  );
}

export function SectionTitle({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
      {children}
      {count !== undefined && (
        <span className="tabular-nums text-muted-foreground/70">{count}</span>
      )}
    </h2>
  );
}

/** Small grey chip: project, person, date. */
export function Chip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'warn' | 'danger' | 'ok' | 'accent';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap border border-border px-1.5 text-[11px] leading-5 text-muted-foreground',
        tone === 'warn' && 'border-warn/40 text-warn',
        tone === 'danger' && 'border-destructive/40 text-destructive',
        tone === 'ok' && 'border-ok/40 text-ok',
        tone === 'accent' && 'border-primary/40 text-primary',
      )}
    >
      {children}
    </span>
  );
}

export function personName(state: Snapshot, id: string): string {
  if (!id) return 'Someone';
  return state.people[id]?.name ?? 'Someone';
}

/** One open loop or task: checkbox, title, where it lives, when. */
export function TaskLine({
  task,
  showProject = true,
  showPerson = true,
}: {
  task: Task;
  showProject?: boolean;
  showPerson?: boolean;
}) {
  const { state, actions } = useDatapad();
  const today = useToday();
  if (!state) return null;
  const project = task.projectId ? state.projects[task.projectId] : null;
  const blocked = blockedOf(task);
  const assigned = task.assignee && task.assignee !== meId(state.people);
  const who = blocked ? blocked.on : assigned ? task.assignee : null;
  const done = task.status === 'done';
  const late = !done && task.due && task.due < today;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="flex h-6 items-center">
        <Checkbox
          checked={done}
          onCheckedChange={(next) =>
            actions.toggleTask({ id: task.id, done: Boolean(next) })
          }
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={`/tasks/${encodeURIComponent(task.id)}`}
          className={cn(
            'block text-sm leading-6 hover:underline',
            done && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </a>
        <div className="flex flex-wrap gap-1">
          {showProject && project && (
            <Go to={{ name: 'project', id: project.id }}>
              <Chip>#{project.name}</Chip>
            </Go>
          )}
          {showPerson && who && (
            <Go to={{ name: 'person', id: who }}>
              <Chip tone={blocked ? 'warn' : undefined}>
                {blocked ? 'waiting on ' : ''}
                {personName(state, who)}
              </Chip>
            </Go>
          )}
          {task.due && (
            <Chip tone={late ? 'danger' : undefined}>
              {formatDay(task.due, today)}
            </Chip>
          )}
        </div>
      </div>
    </li>
  );
}

export function TaskList({
  tasks,
  empty,
  showProject,
  showPerson,
  limit = 8,
}: {
  tasks: Task[];
  empty: string;
  showProject?: boolean;
  showPerson?: boolean;
  limit?: number;
}) {
  if (tasks.length === 0) {
    return <p className="py-2 text-muted-foreground text-sm">{empty}</p>;
  }
  return (
    <>
      <ul className="divide-y divide-border">
        {tasks.slice(0, limit).map((t) => (
          <TaskLine
            key={t.id}
            task={t}
            showProject={showProject}
            showPerson={showPerson}
          />
        ))}
      </ul>
      {tasks.length > limit && (
        <p className="pt-1 text-muted-foreground text-xs">
          and {tasks.length - limit} more under{' '}
          <Go to={{ name: 'all' }} className="underline">
            All
          </Go>
        </p>
      )}
    </>
  );
}

/** The three lanes, with their labels (a person's room renames them). */
export function LanesPanel({
  lanes,
  labels = ['Mine', 'Waiting on', 'To decide'],
  showProject = true,
  groupWaiting = true,
}: {
  lanes: Lanes;
  labels?: [string, string, string];
  showProject?: boolean;
  groupWaiting?: boolean;
}) {
  const { state } = useDatapad();
  if (!state) return null;
  const waitingCount = lanes.waiting.reduce((n, g) => n + g.tasks.length, 0);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={labels[0]}>
        <SectionTitle count={lanes.mine.length}>{labels[0]}</SectionTitle>
        <TaskList
          tasks={lanes.mine}
          empty="Nothing open."
          showProject={showProject}
        />
      </section>
      <section aria-label={labels[1]}>
        <SectionTitle count={waitingCount}>{labels[1]}</SectionTitle>
        {waitingCount === 0 && (
          <p className="py-2 text-muted-foreground text-sm">
            Nobody owes you anything.
          </p>
        )}
        {groupWaiting
          ? lanes.waiting.map((g) => (
              <div key={g.personId} className="mb-2">
                <Go
                  to={{ name: 'person', id: g.personId }}
                  className="font-medium text-sm hover:underline"
                >
                  {personName(state, g.personId)}
                </Go>
                <TaskList
                  tasks={g.tasks}
                  empty=""
                  showPerson={false}
                  showProject={showProject}
                  limit={4}
                />
              </div>
            ))
          : waitingCount > 0 && (
              <TaskList
                tasks={lanes.waiting.flatMap((g) => g.tasks)}
                empty=""
                showProject={showProject}
                showPerson={false}
              />
            )}
      </section>
      <section aria-label={labels[2]}>
        <SectionTitle count={lanes.decide.length}>{labels[2]}</SectionTitle>
        <TaskList
          tasks={lanes.decide}
          empty="Nothing waiting on a call from you."
          showProject={showProject}
        />
      </section>
    </div>
  );
}

/** A page's heading block: title, one line of state, actions. */
export function RoomHeader({
  kicker,
  title,
  state,
  actions,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  state?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker && (
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {kicker}
          </p>
        )}
        <h1 className="font-heading text-2xl">{title}</h1>
        {state && <p className="mt-1 text-muted-foreground text-sm">{state}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
