import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import { formatDay, localDate } from '#shared/dates';
import { GENERAL, type Person } from '#shared/types';
import { Initials } from '@/components/Initials';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { ActivityList } from '@/components/projects/ActivityList';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { StateLine } from '@/components/projects/StateLine';
import { StatusPill } from '@/components/projects/StatusPill';
import { Section } from '@/components/Section';
import {
  PROJECT_TASK_VIEWS,
  ProjectTaskBoard,
} from '@/components/tasks/ProjectTaskBoard';
import { TaskList } from '@/components/tasks/TaskList';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useToast } from '@/providers/ToastProvider';

/**
 * One project, where most entry happens: the header with its facts and
 * actions, the description, the current state line, then Tasks on the
 * left and Activity on the right (3:2 above 820px, one column below).
 * Events (M4) and Notes (M3) join the columns as they land. Sections
 * remember open or closed per project.
 */
export function ProjectPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const { show } = useToast();
  const project = state?.projects[id];
  const [taskView, setTaskView] = useView(
    'project-tasks',
    PROJECT_TASK_VIEWS,
    'list',
  );
  usePageTitle(project?.name ?? (state ? 'Not found' : 'Project'));

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

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!project || id === GENERAL) {
    return (
      <NotFoundPage
        what="project"
        back={{ name: 'projects' }}
        backLabel="Back to Projects"
      />
    );
  }

  const today = localDate(new Date());
  const members = project.members
    .map((m) => state.people[m])
    .filter((p): p is Person => Boolean(p));
  const key = (section: string) => `datapad:section:${id}:${section}`;

  const toggleArchive = () => {
    const archive = !project.archived;
    const ok = archive
      ? actions.archiveProject({ id: project.id })
      : actions.unarchiveProject({ id: project.id });
    if (!ok) return;
    show(`${archive ? 'Archived' : 'Restored'} ${project.name}`, () =>
      archive
        ? actions.unarchiveProject({ id: project.id })
        : actions.archiveProject({ id: project.id }),
    );
  };

  return (
    <article
      aria-labelledby="project-title"
      className="enter flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {project.org || 'No org'}
          {project.archived && ' · Archived'}
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <h1 id="project-title" className="text-page-title min-w-0 flex-1">
            {project.name}
          </h1>
          <div className="flex gap-1">
            {/* Summarize joins these with on-device summaries (M6). */}
            <Button
              variant="outline"
              className="press"
              onClick={() => openProjectForm(project.id)}
            >
              <PencilSimpleIcon />
              Edit
            </Button>
            <Button variant="outline" className="press" onClick={toggleArchive}>
              <ArchiveIcon />
              {project.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>
        </div>
        <ul
          aria-label="Details"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          <li>
            <StatusPill status={project.status} />
          </li>
          <li className="flex items-center gap-1.5">
            <PriorityDot priority={project.priority} labelled={false} />
            {PRIORITY_LABELS[project.priority]}
          </li>
          {project.targetDate && (
            <li>Target {formatDay(project.targetDate, today)}</li>
          )}
          {members.length > 0 && (
            <li className="flex items-center gap-0.5">
              <span className="sr-only">Team: </span>
              {members.map((p) => (
                <Initials key={p.id} person={p} />
              ))}
            </li>
          )}
          {project.tags.map((tag) => (
            <li key={tag} className="border px-1.5 py-0.5 text-xs">
              <span className="sr-only">Tag: </span>
              {tag}
            </li>
          ))}
          {project.links.map((link, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: links are positional
            <li key={i}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
              >
                {link.label || link.type}
                <ArrowSquareOutIcon aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        {/* Rendered as plain paragraphs until the Markdown renderer (M3). */}
        {project.desc && (
          <div className="max-w-prose pt-2 text-sm whitespace-pre-wrap">
            {project.desc}
          </div>
        )}
        <div className="pt-2">
          <StateLine project={project} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 desk:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            title="Tasks"
            count={tasks.open.length}
            storageKey={key('tasks')}
            actions={
              <ViewSwitcher
                views={PROJECT_TASK_VIEWS}
                value={taskView}
                onChange={setTaskView}
              />
            }
          >
            <div className="pt-2">
              {taskView === 'board' ? (
                <ProjectTaskBoard
                  projectId={id}
                  open={tasks.open}
                  done={tasks.done}
                />
              ) : (
                <TaskList
                  label="Open tasks"
                  open={tasks.open}
                  done={tasks.done}
                  showProject={false}
                  doneKey={key('done')}
                  reorderProject={id}
                  quickAdd={{
                    onAdd: (title) =>
                      actions.addTask({ projectId: id, title }) !== null,
                  }}
                />
              )}
            </div>
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            title="Activity"
            storageKey={key('activity')}
            defaultOpen={false}
          >
            <ActivityList entries={state.activity[id]?.events ?? []} />
          </Section>
        </div>
      </div>
    </article>
  );
}
