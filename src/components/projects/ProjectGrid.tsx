import { useEffect, useRef } from 'react';
import { localDate } from '#shared/dates';
import { nextMilestones, openCounts } from '#shared/select';
import type { Project } from '#shared/types';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { useDatapad } from '@/hooks/useDatapad';

/** Cards in a grid, entering only the first time the page mounts. */
export function ProjectGrid({
  projects,
  label,
}: {
  projects: Project[];
  label: string;
}) {
  const { state } = useDatapad();
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  const today = localDate(new Date());
  if (!state) return null;
  const open = openCounts(state.tasks);
  const next = nextMilestones(state.projects, today);
  return (
    <ul
      aria-label={label}
      className="vt-list grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-2 lg:grid-cols-3"
    >
      {projects.map((p, i) => (
        <li key={p.id} data-layout-id={p.id} className="flex">
          <div className="flex flex-1 flex-col *:flex-1">
            <ProjectCard
              project={p}
              open={open.get(p.id) ?? 0}
              next={next.get(p.id)}
              people={state.people}
              today={today}
              enter={first.current}
              index={i}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
