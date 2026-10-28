import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import { formatTimestamp } from '#shared/dates';
import { notesOfTask } from '#shared/select';
import { blockedOf } from '#shared/types';
import { ExternalLink } from '@/components/ExternalLink';
import { Markdown } from '@/components/Markdown';
import { LinkedNoteList } from '@/components/notes/LinkedNoteList';
import { noteLocation } from '@/components/notes/useMakeTask';
import { PRIORITY_LABELS, PriorityDot } from '@/components/PriorityDot';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { useBlocked } from '@/components/tasks/BlockedProvider';
import { DueDate } from '@/components/tasks/DueDate';
import { FromMeeting } from '@/components/tasks/TaskPanel';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTaskToggle } from '@/hooks/useTaskToggle';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useToast } from '@/providers/ToastProvider';

/**
 * One task, opened from Tasks: the header with its project (and the
 * meeting it is an action item of) and actions
 * (Close or Reopen, Summarize, Edit in the panel, Delete with Undo), its
 * status, priority, due date, assignee, blocker, tags and links, then
 * the details on the left and its running notes on the right (one column
 * below 820px). Anywhere else a task opens in its panel.
 */
export function TaskPage({ id }: { id: string }) {
  const clock = useClock();
  const { state, actions } = useDatapad();
  const { openTask } = useTaskPanels();
  const { summarize, enabled: summariesOn } = useSummaries();
  const { editBlocked } = useBlocked();
  const { show } = useToast();
  const { toggle, isDone } = useTaskToggle();
  const today = useToday();
  const task = state?.tasks[id];
  usePageTitle(task?.title ?? (state ? 'Not found' : 'Task'));

  const notes = useMemo(
    () => (state ? notesOfTask(state.notes, id) : []),
    [state, id],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!task) {
    return (
      <NotFoundPage
        what="task"
        back={{ name: 'tasks' }}
        backLabel="Back to Tasks"
      />
    );
  }

  const project = task.projectId ? state.projects[task.projectId] : null;
  const done = isDone(task);
  const assignee = task.assignee ? state.people[task.assignee] : undefined;
  const blocked = done ? null : blockedOf(task);
  const waitingOn = blocked?.on ? state.people[blocked.on] : undefined;
  const sourceNote = task.sourceNoteId
    ? state.notes[task.sourceNoteId]
    : undefined;
  const sourceLink = sourceNote ? noteLocation(sourceNote, state) : null;
  const fromMeeting = task.meetingId
    ? state.meetings[task.meetingId]
    : undefined;

  const remove = () => {
    const deleted = task;
    if (!actions.deleteTask({ id: task.id })) return;
    navigate({ name: 'tasks' }, { replace: true });
    // Undo puts the very same document back: same id, same order.
    show(`Deleted “${deleted.title}”`, () => {
      actions.put({ col: 'tasks', doc: deleted });
    });
  };

  return (
    <article
      aria-labelledby="task-page-title"
      className="enter flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {project ? (
            <a
              {...linkProps({ name: 'project', id: project.id })}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {project.name}
              {project.archived && ' (archived)'}
            </a>
          ) : (
            'General'
          )}
        </p>
        {fromMeeting && <FromMeeting meeting={fromMeeting} />}
        <div className="flex flex-wrap items-start gap-3">
          <h1
            id="task-page-title"
            className={cn(
              'text-page-title min-w-0 flex-1 basis-full desk:basis-0',
              done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </h1>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="outline"
              className="press"
              onClick={() => toggle(task)}
            >
              {done ? <ArrowCounterClockwiseIcon /> : <CheckIcon />}
              {done ? 'Reopen' : 'Close'}
            </Button>
            {summariesOn && (
              <Button
                variant="outline"
                className="press"
                onClick={() => summarize({ kind: 'task', id: task.id })}
              >
                <SparkleIcon />
                Summarize
              </Button>
            )}
            <Button
              variant="outline"
              className="press"
              onClick={() => openTask(task.id)}
            >
              <PencilSimpleIcon />
              Edit
            </Button>
            <Button
              variant="outline"
              className="press text-destructive"
              onClick={remove}
            >
              <TrashIcon />
              Delete
            </Button>
          </div>
        </div>
        <ul
          aria-label="Details"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
        >
          <li className={cn(!done && 'text-foreground')}>
            {done ? 'Done' : 'Open'}
          </li>
          {task.priority !== 'none' && (
            <li className="flex items-center gap-1.5">
              <PriorityDot priority={task.priority} labeled={false} />
              {PRIORITY_LABELS[task.priority]} priority
            </li>
          )}
          {task.due && (
            <li>
              <span className="sr-only">Due: </span>
              <DueDate due={task.due} today={today} done={done} />
            </li>
          )}
          <li>{assignee ? assignee.name : 'Unassigned'}</li>
          {blocked && (
            <li>
              <button
                type="button"
                onClick={() => editBlocked(task)}
                className="press inline-flex min-h-11 items-center gap-1 text-warn underline-offset-4 hover:underline desk:min-h-0"
              >
                <LockSimpleIcon weight="bold" aria-hidden />
                Blocked
                {waitingOn && ` on ${waitingOn.name}`}
                {blocked.note && `: ${blocked.note}`}
              </button>
            </li>
          )}
          {task.tags.map((tag) => (
            <li key={tag} className="border px-1.5 py-0.5 text-xs">
              <span className="sr-only">Tag: </span>
              {tag}
            </li>
          ))}
          {task.links.map((link, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: links are positional
            <li key={i}>
              <ExternalLink
                url={link.url}
                className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground desk:min-h-0"
              >
                {link.label || link.type}
              </ExternalLink>
            </li>
          ))}
        </ul>
      </header>

      <div className="grid grid-cols-1 gap-6 desk:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="task-page-details"
            className="flex flex-col gap-2"
          >
            <h2 id="task-page-details" className="text-xs font-medium">
              Details
            </h2>
            {task.desc ? (
              <Markdown
                text={task.desc}
                people={state.people}
                className="max-w-prose"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No details yet. Edit adds them.
              </p>
            )}
          </section>
          {task.sourceNoteId && (
            <section
              aria-labelledby="task-page-source"
              className="flex flex-col gap-1"
            >
              <h2 id="task-page-source" className="text-xs font-medium">
                From note
              </h2>
              {sourceNote && sourceLink ? (
                <>
                  <blockquote className="line-clamp-6 border-l-2 pl-3">
                    <Markdown text={sourceNote.body} people={state.people} />
                  </blockquote>
                  <a
                    {...linkProps(sourceLink.route, sourceLink.query)}
                    className="self-start text-sm underline underline-offset-4 hover:text-foreground"
                  >
                    Show the note
                  </a>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Note deleted</p>
              )}
            </section>
          )}
        </div>
        <LinkedNoteList
          notes={notes}
          fields={{ projectId: task.projectId, taskId: task.id }}
          people={state.people}
          label={`New note on “${task.title}”`}
          draftKey={`datapad:draft:note:task:${task.id}`}
          headingLevel={2}
        />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <dt>Created</dt>
        <dd>{formatTimestamp(task.createdAt, clock)}</dd>
        {task.completedAt && (
          <>
            <dt>Closed</dt>
            <dd>{formatTimestamp(task.completedAt, clock)}</dd>
          </>
        )}
      </dl>
    </article>
  );
}
