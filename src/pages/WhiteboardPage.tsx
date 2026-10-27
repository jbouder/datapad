import { CaretLeftIcon } from '@phosphor-icons/react';
import { GENERAL, GENERAL_BOARD } from '#shared/types';
import { Board } from '@/components/board/Board';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * A whiteboard, full height below the top bar: a project's
 * (`/projects/:id/whiteboard`, with its way back to the project) or the
 * space's own (`/whiteboard`).
 */
export function WhiteboardPage({ project: id }: { project?: string }) {
  const { state } = useDatapad();
  const project = id ? state?.projects[id] : undefined;
  usePageTitle(
    id
      ? project
        ? `${project.name} whiteboard`
        : state
          ? 'Not found'
          : 'Whiteboard'
      : 'Whiteboard',
  );

  if (id && state && (!project || id === GENERAL)) {
    return (
      <div className="px-4 pt-6 sm:px-6">
        <NotFoundPage
          what="project"
          back={{ name: 'projects' }}
          backLabel="Back to Projects"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-12 items-center gap-1 border-b px-2 sm:px-4">
        {project && (
          <a
            {...linkProps({ name: 'project', id: project.id })}
            className="press -ml-1 flex h-11 min-w-0 shrink items-center gap-1 pr-2 text-sm text-muted-foreground outline-ring/50 hover:text-foreground focus-visible:outline-2 desk:h-9"
          >
            <CaretLeftIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">
              <span className="sr-only">Back to </span>
              {project.name}
            </span>
          </a>
        )}
        {project && (
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
        )}
        <h1 className="shrink-0 px-1 font-heading text-base font-semibold tracking-tight">
          Whiteboard
        </h1>
      </header>
      {state ? (
        <Board
          boardId={project ? project.id : GENERAL_BOARD}
          label={
            project ? `Whiteboard for ${project.name}` : 'Space whiteboard'
          }
        />
      ) : (
        <p className="px-4 pt-6 text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
