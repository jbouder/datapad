import { FlagIcon } from '@phosphor-icons/react';
import { formatDay } from '#shared/dates';
import type { Event, Person, Project } from '#shared/types';
import { Initials } from '@/components/Initials';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { StatusPill } from '@/components/projects/StatusPill';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

const MAX_MEMBERS = 4;

/**
 * One project as a card, the whole card a link: org, status, priority,
 * name, the current state line, then open count, target, the next
 * milestone or deadline, and up to four members (+N for the rest).
 */
export function ProjectCard({
  project,
  open,
  next,
  people,
  today,
  enter,
  index,
}: {
  project: Project;
  open: number;
  next: Event | undefined;
  people: Record<string, Person>;
  today: string;
  /** Run the entrance (first mount of the page only). */
  enter: boolean;
  index: number;
}) {
  const members = project.members
    .map((id) => people[id])
    .filter((p): p is Person => Boolean(p));
  const shown = members.slice(0, MAX_MEMBERS);
  const more = members.length - shown.length;

  return (
    <a
      {...linkProps({ name: 'project', id: project.id })}
      data-flip-id={project.id}
      className={cn(
        'press group flex min-h-44 flex-col gap-2 border bg-card p-4 text-card-foreground outline-ring/50 hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2',
        enter && 'enter',
      )}
      style={
        enter
          ? ({ '--i': Math.min(index, 8) } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {project.org || 'No org'}
        </span>
        <StatusPill status={project.status} />
        <PriorityDot priority={project.priority} labelled={false} />
        <span className="sr-only">
          {PRIORITY_LABELS[project.priority]} priority
        </span>
      </div>
      <h2 className="text-card-name group-hover:underline group-hover:underline-offset-4">
        {project.name}
      </h2>
      {project.state && (
        <p className="text-state line-clamp-2">{project.state}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-muted-foreground">
        <span className="count tabular-nums">
          {open === 1 ? '1 open task' : `${open} open tasks`}
        </span>
        {project.targetDate && (
          <span>Target {formatDay(project.targetDate, today)}</span>
        )}
        {next && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <FlagIcon aria-hidden />
            <span className="truncate">
              {next.title} · {formatDay(next.date, today)}
            </span>
          </span>
        )}
        {shown.length > 0 && (
          <span className="ml-auto flex items-center gap-0.5">
            {shown.map((p) => (
              <Initials key={p.id} person={p} />
            ))}
            {more > 0 && (
              <span className="px-1 text-[11px] font-semibold">
                +{more}
                <span className="sr-only"> more</span>
              </span>
            )}
          </span>
        )}
      </div>
    </a>
  );
}
