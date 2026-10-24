import { ArchiveIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { TaskList } from '@/components/tasks/TaskList';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useToast } from '@/providers/ToastProvider';

/**
 * One project: its tasks with a quick-add bound to it. The header, state
 * line, second column and Activity land in #18.
 */
export function ProjectPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const { show } = useToast();
  const project = state?.projects[id];
  const tasks = useMemo(() => {
    const mine = Object.values(state?.tasks ?? {}).filter(
      (t) => t.projectId === id,
    );
    return {
      open: mine
        .filter((t) => t.status === 'open')
        .sort((a, b) => a.order - b.order),
      done: mine
        .filter((t) => t.status === 'done')
        .sort((a, b) =>
          (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
        ),
    };
  }, [state?.tasks, id]);
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
      <div className="flex flex-wrap items-start gap-3">
        <h1 id="project-title" className="text-page-title min-w-0 flex-1">
          {project.name}
        </h1>
        <div className="flex gap-1">
          <Button
            variant="outline"
            className="press"
            onClick={() => openProjectForm(project.id)}
          >
            <PencilSimpleIcon />
            Edit
          </Button>
          <Button
            variant="outline"
            className="press"
            onClick={() => {
              const archive = !project.archived;
              const ok = archive
                ? actions.archiveProject({ id: project.id })
                : actions.unarchiveProject({ id: project.id });
              if (!ok) return;
              show(
                `${archive ? 'Archived' : 'Restored'} ${project.name}`,
                () =>
                  archive
                    ? actions.unarchiveProject({ id: project.id })
                    : actions.archiveProject({ id: project.id }),
              );
            }}
          >
            <ArchiveIcon />
            {project.archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      </div>
      {project.state && <p className="text-state-lg">{project.state}</p>}
      <section
        aria-labelledby="project-tasks"
        className="mt-4 flex flex-col gap-2"
      >
        <h2 id="project-tasks" className="font-heading text-sm font-semibold">
          Tasks
        </h2>
        <TaskList
          label="Open tasks"
          open={tasks.open}
          done={tasks.done}
          showProject={false}
          doneKey={`datapad:section:${id}:done`}
          quickAdd={{
            onAdd: (title) =>
              actions.addTask({ projectId: id, title }) !== null,
          }}
        />
      </section>
    </section>
  );
}
