import type { ReactNode } from 'react';
import { formatDay } from '#shared/dates';
import { roomTabRoute } from '#shared/routes';
import {
  healthOf,
  milestonesOf,
  type Person,
  type Project,
  type Snapshot,
} from '#shared/types';
import { ExternalLink } from '@/components/ExternalLink';
import { Initials } from '@/components/Initials';
import { Timeline } from '@/components/layouts/Timeline';
import { Markdown } from '@/components/Markdown';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { ActivityList } from '@/components/projects/ActivityList';
import { HealthPicker } from '@/components/projects/Health';
import { Milestones } from '@/components/projects/Milestones';
import { StatusPill } from '@/components/projects/StatusPill';
import { Section } from '@/components/Section';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { linkProps, navigate } from '@/lib/router';

const HEADING =
  'flex min-h-11 items-center gap-1.5 font-heading text-sm font-semibold desk:min-h-8';

function Block({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className={HEADING}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A project room's Plan tab (#334): what the project page's header and
 * detail sections held. The description, the details (status, health,
 * which sets in place, priority, dates, tags), the project's bar on a
 * timeline with its milestones, Milestones (add, edit, delete), the
 * members, the links, and Activity, collapsed. The header's Edit opens
 * the project form for the rest.
 */
export function ProjectPlan({
  project,
  state,
}: {
  project: Project;
  state: Snapshot;
}) {
  const { actions } = useDatapad();
  const today = useToday();
  const milestones = milestonesOf(project);
  const members = project.members
    .map((m) => state.people[m])
    .filter((p): p is Person => Boolean(p));
  const first =
    project.startDate ||
    [project.createdAt.slice(0, 10), milestones[0]?.date]
      .filter((d): d is string => Boolean(d))
      .sort()[0];

  return (
    <div className="grid gap-8 desk:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Block id="plan-description" title="Description">
          {project.desc ? (
            <Markdown
              text={project.desc}
              people={state.people}
              className="max-w-prose"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No description yet.</p>
          )}
        </Block>

        <Block id="plan-timeline" title="Timeline">
          <Timeline
            label={`${project.name} timeline`}
            rows={[
              {
                id: project.id,
                label: project.name,
                start: first,
                end: project.targetDate || project.updatedAt.slice(0, 10),
                open: !project.targetDate,
                points: milestones.map((m) => ({
                  id: m.id,
                  date: m.date,
                  label: m.title,
                  kind: 'milestone' as const,
                })),
              },
            ]}
            onOpenPoint={(_, milestone) =>
              navigate(roomTabRoute(project.id, 'plan'), {
                query: `milestone=${encodeURIComponent(milestone)}`,
              })
            }
          />
        </Block>

        <Milestones
          project={project}
          today={today}
          remember={{ page: 'project', key: 'milestones' }}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Block id="plan-details" title="Details">
          <ul
            aria-label="Details"
            className="flex flex-col gap-2 text-sm text-muted-foreground"
          >
            <li className="flex items-center gap-2">
              <span className="w-16 shrink-0">Status</span>
              <StatusPill status={project.status} />
            </li>
            <li>
              <HealthPicker
                value={healthOf(project)}
                onChange={(health) =>
                  actions.setHealth({ id: project.id, health })
                }
                className="max-w-full"
              />
            </li>
            <li className="flex items-center gap-2">
              <span className="w-16 shrink-0">Priority</span>
              <span className="flex items-center gap-1.5 text-foreground">
                <PriorityDot priority={project.priority} labeled={false} />
                {PRIORITY_LABELS[project.priority]}
              </span>
            </li>
            {project.startDate && (
              <li className="flex items-center gap-2">
                <span className="w-16 shrink-0">
                  {project.startDate > today ? 'Starts' : 'Started'}
                </span>
                <span className="text-foreground">
                  {formatDay(project.startDate, today)}
                </span>
              </li>
            )}
            {project.targetDate && (
              <li className="flex items-center gap-2">
                <span className="w-16 shrink-0">Target</span>
                <span className="text-foreground">
                  {formatDay(project.targetDate, today)}
                </span>
              </li>
            )}
            {project.tags.length > 0 && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0">Tags</span>
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="border px-1.5 py-0.5 text-xs text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </li>
            )}
          </ul>
        </Block>

        <Block id="plan-members" title="Members">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No members yet. Edit adds them.
            </p>
          ) : (
            <ul aria-label="Members" className="flex flex-col">
              {members.map((p) => (
                <li key={p.id}>
                  <a
                    {...linkProps({ name: 'person', id: p.id })}
                    className="press flex min-h-11 items-center gap-2 text-sm outline-ring/50 hover:underline focus-visible:outline-2 desk:min-h-8"
                  >
                    <Initials person={p} />
                    {p.name}
                    {p.role && (
                      <span className="text-muted-foreground">{p.role}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block id="plan-links" title="Links">
          {project.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No links yet. Edit adds them.
            </p>
          ) : (
            <ul aria-label="Links" className="flex flex-col">
              {project.links.map((link, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: links are positional
                <li key={i}>
                  <ExternalLink
                    url={link.url}
                    className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 hover:text-foreground desk:min-h-8"
                  >
                    {link.label || link.type}
                  </ExternalLink>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Section
          title="Activity"
          remember={{ page: 'project', key: 'activity' }}
          defaultOpen={false}
        >
          <ActivityList entries={state.activity[project.id]?.events ?? []} />
        </Section>
      </div>
    </div>
  );
}
