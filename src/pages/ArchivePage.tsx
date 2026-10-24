import { useMemo } from 'react';
import { DEFAULT_PROJECT_FILTERS, selectProjects } from '#shared/projects';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ProjectGrid } from '@/pages/ProjectsPage';

/** Archived projects: out of the default views, still here and searchable. */
export function ArchivePage() {
  usePageTitle('Archived');
  const { state } = useDatapad();
  const projects = useMemo(
    () =>
      state
        ? selectProjects(state.projects, DEFAULT_PROJECT_FILTERS, true)
        : [],
    [state],
  );
  return (
    <section
      aria-labelledby="archive-title"
      className="enter flex flex-col gap-4"
    >
      <h1 id="archive-title" className="text-page-title">
        Archived
      </h1>
      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-state">Nothing archived.</p>
      ) : (
        <ProjectGrid projects={projects} label="Archived projects" />
      )}
    </section>
  );
}
