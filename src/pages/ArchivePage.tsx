import { useMemo } from 'react';
import { DEFAULT_PROJECT_FILTERS, selectProjects } from '#shared/projects';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import {
  PROJECT_VIEWS,
  ProjectLayouts,
} from '@/components/projects/ProjectLayouts';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';

/** Archived projects: out of the default views, still here and searchable. */
export function ArchivePage() {
  usePageTitle('Archived');
  const { state } = useDatapad();
  const [view, setView] = useView('archive', PROJECT_VIEWS, 'cards');
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="archive-title" className="text-page-title flex-1">
          Archived
        </h1>
        {projects.length > 0 && (
          <ViewSwitcher views={PROJECT_VIEWS} value={view} onChange={setView} />
        )}
      </div>
      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-state">Nothing archived.</p>
      ) : (
        <ProjectLayouts
          view={view}
          projects={projects}
          label="Archived projects"
        />
      )}
    </section>
  );
}
