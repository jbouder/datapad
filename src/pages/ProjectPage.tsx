import { useMemo } from 'react';
import { TaskList } from '@/components/tasks/TaskList';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * One project: its tasks with a quick-add bound to it. The header, state
 * line, second column and Activity land in #18.
 */
export function ProjectPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
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
      <h1 id="project-title" className="text-page-title">
        {project.name}
      </h1>
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
