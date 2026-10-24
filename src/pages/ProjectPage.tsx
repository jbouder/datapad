import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** One project. Header, state line and the two columns land in #18. */
export function ProjectPage({ id }: { id: string }) {
  const { state } = useDatapad();
  const project = state?.projects[id];
  usePageTitle(project?.name ?? (state ? 'Not found' : 'Project'));

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!project) {
    return (
      <NotFoundPage
        what="project"
        back={{ name: 'projects' }}
        backLabel="Back to Projects"
      />
    );
  }
  return (
    <section
      aria-labelledby="project-title"
      className="enter flex flex-col gap-2"
    >
      {project.org && (
        <p className="text-sm text-muted-foreground">{project.org}</p>
      )}
      <h1 id="project-title" className="text-page-title">
        {project.name}
      </h1>
      {project.state && <p className="text-state-lg">{project.state}</p>}
    </section>
  );
}
