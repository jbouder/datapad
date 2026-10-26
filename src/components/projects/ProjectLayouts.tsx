import {
  ChartBarHorizontalIcon,
  SquaresFourIcon,
  TableIcon,
} from '@phosphor-icons/react';
import { formatDay, localDate, relativeTime } from '#shared/dates';
import type { ProjectSort } from '#shared/projects';
import { nextMilestones, openCounts } from '#shared/select';
import {
  healthOf,
  milestonesOf,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  type Priority,
  type Project,
  type ProjectHealth,
  type ProjectStatus,
} from '#shared/types';
import { Initials } from '@/components/Initials';
import { DataTable } from '@/components/layouts/DataTable';
import { Timeline } from '@/components/layouts/Timeline';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import {
  HEALTH_LABELS,
  HealthBadge,
  HealthDot,
} from '@/components/projects/Health';
import { STATUS_LABELS } from '@/components/projects/ProjectForm';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { StatusPill } from '@/components/projects/StatusPill';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { linkProps, navigate } from '@/lib/router';

export type ProjectView = 'cards' | 'table' | 'timeline';

export const PROJECT_VIEWS: readonly ViewOption<ProjectView>[] = [
  { id: 'cards', label: 'Cards', icon: SquaresFourIcon },
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'timeline', label: 'Timeline', icon: ChartBarHorizontalIcon },
];

/** Table columns that sort the way the Cards sort does. */
const SORTABLE: Record<string, ProjectSort> = {
  name: 'name',
  priority: 'priority',
  start: 'start',
  target: 'target',
  next: 'milestone',
  updated: 'updated',
};

const open = (id: string) => navigate({ name: 'project', id });
/** The project page, scrolled to that milestone in its Milestones section. */
const openMilestone = (id: string, milestone: string) =>
  navigate({ name: 'project', id }, { query: `milestone=${milestone}` });

/**
 * The same projects as Cards, a Table, or a Timeline. Filters and sort
 * come from the page, so every layout shows the same set in the same
 * order, and sorting from the table writes the same `?sort=`.
 */
export function ProjectLayouts({
  view,
  projects,
  label,
  sort,
  onSort,
}: {
  view: ProjectView;
  projects: Project[];
  label: string;
  sort?: ProjectSort;
  onSort?: (sort: ProjectSort) => void;
}) {
  const { state, actions } = useDatapad();
  if (!state) return null;
  const today = localDate(new Date());
  const now = new Date();
  const counts = openCounts(state.tasks);
  const next = nextMilestones(state.projects, today);

  if (view === 'cards') {
    return <ProjectGrid projects={projects} label={label} />;
  }

  if (view === 'timeline') {
    return (
      <Timeline
        label={label}
        rows={projects.map((p) => {
          // Kept by date on the project.
          const milestones = milestonesOf(p);
          // The start date when set; else creation or the first milestone.
          const first =
            p.startDate ||
            [p.createdAt.slice(0, 10), milestones[0]?.date]
              .filter((d): d is string => Boolean(d))
              .sort()[0];
          return {
            id: p.id,
            label: p.name,
            start: first,
            // No target: up to the last activity, drawn dashed.
            end: p.targetDate || p.updatedAt.slice(0, 10),
            open: !p.targetDate,
            points: milestones.map((m) => ({
              id: m.id,
              date: m.date,
              label: m.title,
              kind: 'milestone' as const,
            })),
          };
        })}
        onOpenRow={open}
        onOpenPoint={openMilestone}
      />
    );
  }

  return (
    <DataTable<Project>
      label={label}
      groups={[{ id: 'all', label: '', rows: projects }]}
      getId={(p) => p.id}
      rowLabel={(p) => p.name}
      sort={
        sort
          ? {
              column:
                Object.entries(SORTABLE).find(([, s]) => s === sort)?.[0] ?? '',
              // Each sort has one natural direction (newest, highest, A–Z, soonest).
              dir: sort === 'updated' || sort === 'priority' ? 'desc' : 'asc',
            }
          : undefined
      }
      onSort={
        onSort
          ? (column) => {
              const s = SORTABLE[column];
              if (s) onSort(s);
            }
          : undefined
      }
      onOpen={(p) => open(p.id)}
      columns={[
        {
          id: 'name',
          header: 'Name',
          sortable: Boolean(onSort),
          cell: (p) => (
            <a
              {...linkProps({ name: 'project', id: p.id })}
              className="font-medium outline-ring/50 hover:underline focus-visible:outline-2"
            >
              {p.name}
            </a>
          ),
        },
        {
          id: 'org',
          header: 'Org',
          cell: (p) => <span className="text-muted-foreground">{p.org}</span>,
        },
        {
          id: 'status',
          header: 'Status',
          cell: (p) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="press rounded-full outline-ring/50 focus-visible:outline-2"
                aria-label={`Status: ${STATUS_LABELS[p.status]}, change`}
              >
                <StatusPill status={p.status} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36">
                <DropdownMenuRadioGroup
                  value={p.status}
                  onValueChange={(status) =>
                    actions.setStatus({
                      id: p.id,
                      status: status as ProjectStatus,
                    })
                  }
                >
                  {PROJECT_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s} closeOnClick>
                      {STATUS_LABELS[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
        {
          id: 'health',
          header: 'Health',
          cell: (p) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="press flex min-h-8 items-center px-1 text-xs outline-ring/50 focus-visible:outline-2"
                aria-label={`Health: ${HEALTH_LABELS[healthOf(p)]}, change`}
              >
                <HealthDot health={healthOf(p)} />
                <span className="ml-1.5">{HEALTH_LABELS[healthOf(p)]}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36">
                <DropdownMenuRadioGroup
                  value={healthOf(p)}
                  onValueChange={(health) =>
                    actions.setHealth({
                      id: p.id,
                      health: health as ProjectHealth,
                    })
                  }
                >
                  {PROJECT_HEALTHS.map((h) => (
                    <DropdownMenuRadioItem key={h} value={h} closeOnClick>
                      <HealthDot health={h} />
                      {HEALTH_LABELS[h]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
        {
          id: 'priority',
          header: 'Priority',
          sortable: Boolean(onSort),
          cell: (p) => (
            <DropdownMenu>
              <DropdownMenuTrigger className="press inline-flex min-h-8 items-center gap-1.5 px-1 text-muted-foreground outline-ring/50 hover:bg-accent focus-visible:outline-2">
                <PriorityDot priority={p.priority} labeled={false} />
                <span className="sr-only">Priority: </span>
                {PRIORITY_LABELS[p.priority]}
                <span className="sr-only">, change</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuRadioGroup
                  value={p.priority}
                  onValueChange={(priority) =>
                    actions.editProject({
                      id: p.id,
                      patch: { priority: priority as Priority },
                    })
                  }
                >
                  {[...PRIORITIES].reverse().map((pr) => (
                    <DropdownMenuRadioItem key={pr} value={pr} closeOnClick>
                      <PriorityDot priority={pr} labeled={false} />
                      {PRIORITY_LABELS[pr]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
        {
          id: 'open',
          header: 'Open tasks',
          className: 'tabular-nums',
          cell: (p) => counts.get(p.id) ?? 0,
        },
        {
          id: 'start',
          header: 'Start',
          sortable: Boolean(onSort),
          className: 'whitespace-nowrap',
          cell: (p) => (p.startDate ? formatDay(p.startDate, today) : ''),
        },
        {
          id: 'target',
          header: 'Target',
          sortable: Boolean(onSort),
          className: 'whitespace-nowrap',
          cell: (p) => (p.targetDate ? formatDay(p.targetDate, today) : ''),
        },
        {
          id: 'next',
          header: 'Next milestone',
          sortable: Boolean(onSort),
          cell: (p) => {
            const e = next.get(p.id);
            return e ? (
              <span className="text-muted-foreground">
                {e.title} · {formatDay(e.date, today)}
              </span>
            ) : null;
          },
        },
        {
          id: 'members',
          header: 'Members',
          cell: (p) => (
            <span className="flex gap-0.5">
              {p.members.slice(0, 4).map((m) => (
                <Initials key={m} person={state.people[m]} />
              ))}
              {p.members.length > 4 && (
                <span className="px-1 text-[11px] font-semibold">
                  +{p.members.length - 4}
                </span>
              )}
            </span>
          ),
        },
        {
          id: 'updated',
          header: 'Updated',
          sortable: Boolean(onSort),
          className: 'whitespace-nowrap text-xs text-muted-foreground',
          cell: (p) => relativeTime(p.updatedAt, now),
        },
      ]}
      mobileRow={(p) => (
        <a
          {...linkProps({ name: 'project', id: p.id })}
          className="row flex items-center gap-2 border-b px-1 text-sm"
        >
          <PriorityDot priority={p.priority} />
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          <HealthBadge health={healthOf(p)} className="text-xs" />
          <StatusPill status={p.status} />
          <span className="text-xs text-muted-foreground tabular-nums">
            {counts.get(p.id) ?? 0} open
          </span>
        </a>
      )}
    />
  );
}
