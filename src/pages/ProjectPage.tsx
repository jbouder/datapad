import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  ArrowsLeftRightIcon,
  CopySimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { formatDay, localDate } from '#shared/dates';
import { projectDecisions } from '#shared/decisions';
import { projectMeetings } from '#shared/meetings';
import { projectNotes } from '#shared/notes';
import { GENERAL, healthOf, type Person, type SpaceInfo } from '#shared/types';
import { DecisionList } from '@/components/decisions/DecisionList';
import { Initials } from '@/components/Initials';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { Markdown } from '@/components/Markdown';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { MeetingList } from '@/components/meetings/MeetingList';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteForm } from '@/components/notes/NoteForm';
import { useNotes } from '@/components/notes/NotesProvider';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { ActivityList } from '@/components/projects/ActivityList';
import { HealthPicker } from '@/components/projects/Health';
import { MoveProjectDialog } from '@/components/projects/MoveProjectDialog';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { StateLine } from '@/components/projects/StateLine';
import { StatusPill } from '@/components/projects/StatusPill';
import { Section } from '@/components/Section';
import { useSummaries } from '@/components/summary/SummaryProvider';
import {
  PROJECT_TASK_VIEWS,
  ProjectTaskBoard,
} from '@/components/tasks/ProjectTaskBoard';
import { TaskList } from '@/components/tasks/TaskList';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { moveProject } from '@/lib/api';
import { linkProps, navigate } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useSpaces } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * One project, where most entry happens: the header with its facts and
 * actions, the description, the current state line, then Tasks on the
 * left with Meetings under them, Notes and Activity on the right (3:2
 * above 820px, one column below). Sections remember open or closed per
 * project.
 */
export function ProjectPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const { summarize } = useSummaries();
  const { newTemplate } = useTemplateForm();
  const { newMeeting } = useMeetingForm();
  const { show } = useToast();
  const project = state?.projects[id];
  const [taskView, setTaskView] = useView(
    'project-tasks',
    PROJECT_TASK_VIEWS,
    'list',
  );
  usePageTitle(project?.name ?? (state ? 'Not found' : 'Project'));
  const { spaces, current, openInSpace } = useSpaces();
  const elsewhere = useMemo(
    () => spaces.filter((s) => s.id !== current.id),
    [spaces, current.id],
  );
  const [moveOpen, setMoveOpen] = useState(false);
  /** Moved away just now: on the way to Projects. */
  const [leaving, setLeaving] = useState(false);
  const { hidden } = useNotes();
  const { active } = useMotion();
  const notesList = useRef<HTMLDivElement>(null);
  useFlip(notesList, active);
  const decisions = useMemo(
    () => projectDecisions(state?.decisions ?? {}, id),
    [state?.decisions, id],
  );
  const notes = useMemo(
    () => projectNotes(state?.notes ?? {}, id, hidden),
    [state?.notes, id, hidden],
  );

  const meetings = useMemo(
    () => projectMeetings(state?.meetings ?? {}, id),
    [state?.meetings, id],
  );

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
  if (!project && leaving) {
    // Moved to another space: the snapshot can beat the answer here, and
    // the page is on its way to Projects, so no Not found in between.
    return null;
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

  /**
   * Move it to another space, on the server (it spans two spaces, so it
   * is not an op). It is gone from this one after, so on to Projects;
   * the toast's Open follows it there.
   */
  const move = async (to: SpaceInfo): Promise<boolean> => {
    setLeaving(true);
    try {
      await moveProject(current.id, to.id, project.id);
    } catch (error) {
      setLeaving(false);
      show(error instanceof Error ? error.message : 'Could not move it');
      return false;
    }
    navigate({ name: 'projects' });
    show(`Moved ${project.name} to ${to.name}`, undefined, {
      label: 'Open',
      run: () => openInSpace(to.id, { name: 'project', id }),
    });
    return true;
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
          <div className="flex flex-wrap gap-1">
            <Button
              variant="outline"
              className="press"
              onClick={() => summarize({ kind: 'project', id: project.id })}
            >
              <SparkleIcon />
              Summarize
            </Button>
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
            {elsewhere.length > 0 && (
              <Button
                variant="outline"
                className="press"
                onClick={() => setMoveOpen(true)}
              >
                <ArrowsLeftRightIcon />
                Move to…
              </Button>
            )}
          </div>
          <MoveProjectDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            projectName={project.name}
            spaces={elsewhere}
            onMove={move}
          />
        </div>
        <ul
          aria-label="Details"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          <li>
            <StatusPill status={project.status} />
          </li>
          <li>
            <HealthPicker
              legendHidden
              value={healthOf(project)}
              onChange={(health) =>
                actions.setHealth({ id: project.id, health })
              }
              className="w-72 max-w-full"
            />
          </li>
          <li className="flex items-center gap-1.5">
            <PriorityDot priority={project.priority} labeled={false} />
            {PRIORITY_LABELS[project.priority]}
          </li>
          {project.startDate && (
            <li>
              {project.startDate > today ? 'Starts' : 'Started'}{' '}
              {formatDay(project.startDate, today)}
            </li>
          )}
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
        {project.desc && (
          <Markdown
            text={project.desc}
            people={state.people}
            className="max-w-prose pt-2"
          />
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
              {tasks.open.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="press mt-1 h-11 text-xs desk:h-8"
                  onClick={() =>
                    newTemplate({
                      name: `${project.name} kickoff`,
                      defaultTags: project.tags,
                      tasks: tasks.open.map((t) => ({
                        title: t.title,
                        priority: t.priority,
                        tags: t.tags,
                      })),
                    })
                  }
                >
                  <CopySimpleIcon />
                  Save as template
                </Button>
              )}
            </div>
          </Section>
          <Section
            title="Meetings"
            count={meetings.filter((e) => e.date >= today).length}
            storageKey={key('meetings')}
            actions={
              <Button
                variant="outline"
                className="press h-11 desk:h-8"
                onClick={() =>
                  newMeeting({ projectId: id, fixedProject: true })
                }
              >
                <PlusIcon />
                Add meeting
              </Button>
            }
          >
            <div className="pt-2">
              <MeetingList
                meetings={meetings}
                state={state}
                today={today}
                showProject={false}
                headingLevel={3}
                empty="Nothing coming up on this project."
              />
            </div>
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Notes" count={notes.length} storageKey={key('notes')}>
            <div className="flex flex-col gap-3 pt-2">
              <NoteForm projectId={id} people={state.people} />
              <div ref={notesList} className="flex flex-col gap-2">
                {notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No notes on this project yet.
                  </p>
                ) : (
                  notes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      state={state}
                      showProject={false}
                      when="day"
                    />
                  ))
                )}
              </div>
            </div>
          </Section>
          <Section
            title="Decisions"
            count={decisions.length}
            storageKey={key('decisions')}
            actions={
              <a
                {...linkProps({ name: 'decisions' }, `project=${id}`)}
                className="press inline-flex h-11 items-center px-2 text-xs underline-offset-4 hover:underline desk:h-8"
              >
                All decisions
              </a>
            }
          >
            <div className="flex flex-col gap-3 pt-2">
              <QuickAdd
                label="Add a decision"
                main={false}
                onAdd={(title) =>
                  actions.addDecision({
                    projectId: id,
                    title: title.trim(),
                  }) !== null
                }
              />
              <DecisionList
                decisions={decisions}
                people={state.people}
                today={today}
                label={`Decisions in ${project.name}`}
                empty="No decisions recorded yet."
              />
            </div>
          </Section>
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
