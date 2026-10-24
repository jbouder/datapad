import { PlusIcon } from '@phosphor-icons/react';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps } from '@/lib/router';

/** Projects. The card grid, filters and sorting land in #16. */
export function ProjectsPage() {
  usePageTitle('Projects');
  const { state } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const projects = Object.values(state?.projects ?? {})
    .filter((p) => !p.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section
      aria-labelledby="projects-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="projects-title" className="text-page-title flex-1">
          Projects
        </h1>
        <Button className="press" onClick={() => openProjectForm()}>
          <PlusIcon weight="bold" />
          New project
        </Button>
      </div>
      {projects.length === 0 ? (
        <p className="text-state">No projects yet.</p>
      ) : (
        <ul aria-label="Projects" className="flex flex-col border-t">
          {projects.map((p) => (
            <li key={p.id} className="border-b">
              <a
                {...linkProps({ name: 'project', id: p.id })}
                className="row flex items-center px-1 text-sm hover:underline"
              >
                {p.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
