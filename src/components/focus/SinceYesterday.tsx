import type { ReactNode } from 'react';
import { formatDay } from '#shared/dates';
import { noteTitle } from '#shared/notes';
import {
  RECAP_ADDED_TITLES,
  type Recap,
  type RecapGroup,
  recapLine,
  recapMeetingLine,
  recapTitle,
} from '#shared/recap';
import type { Person, Project, Task } from '#shared/types';
import { Section } from '@/components/Section';
import { linkProps } from '@/lib/router';

const LINK =
  'outline-ring/50 underline-offset-2 hover:underline focus-visible:outline-2';
/** A row: 44px on touch, one line, never wider than the page. */
const ROW =
  'flex min-h-11 min-w-0 items-center gap-2 border-b py-1 text-sm desk:min-h-9';
const SUBHEAD =
  'flex min-h-11 items-center gap-1.5 pt-1 text-sm font-medium desk:min-h-8';
const PROJECT =
  'flex min-h-11 items-center pt-1 text-xs text-muted-foreground desk:min-h-7';

/**
 * Focus's Since yesterday (#258): what happened on the last working day
 * (`buildRecap`), the first section, collapsible and remembered with the
 * page. Its line counts it; then Closed and Added (narrowed by the
 * assignee filter), Meetings held, Notes written and the activity the
 * rest does not already say, each only when it has something. Tasks open
 * their panel; meetings, notes and projects link to their pages.
 */
export function SinceYesterday({
  recap,
  projects,
  people,
  today,
  onOpenTask,
}: {
  recap: Recap;
  projects: Record<string, Project>;
  people: Record<string, Person>;
  today: string;
  onOpenTask: (task: Task) => void;
}) {
  const oneDay = recap.window.from === recap.window.to;
  const taskRow = (task: Task, withProject: boolean) => {
    const project = task.projectId ? projects[task.projectId] : undefined;
    return (
      <li key={task.id} data-recap-task={task.id} className={ROW}>
        <button
          type="button"
          onClick={() => onOpenTask(task)}
          className={`${LINK} min-h-11 min-w-0 flex-1 truncate text-left desk:min-h-0`}
        >
          {task.title}
        </button>
        {withProject && (
          <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
            {project?.name ?? 'General'}
          </span>
        )}
      </li>
    );
  };
  const projectLabel = (project: Project | null) =>
    project ? (
      <a
        {...linkProps({ name: 'project', id: project.id })}
        className={`${LINK} truncate`}
      >
        {project.name}
      </a>
    ) : (
      <span>General</span>
    );
  const grouped = <T,>(
    groups: RecapGroup<T>[],
    label: string,
    row: (item: T) => ReactNode,
  ) =>
    groups.map((group) => {
      const name = group.project?.name ?? 'General';
      return (
        <div key={group.project?.id ?? ''} className="flex flex-col">
          <p className={PROJECT}>{projectLabel(group.project)}</p>
          <ul
            aria-label={`${label}: ${name}`}
            className="flex flex-col border-t"
          >
            {group.items.map(row)}
          </ul>
        </div>
      );
    });
  const closedCount = recap.closed.reduce((n, g) => n + g.items.length, 0);
  const notesCount = recap.notes.reduce((n, g) => n + g.items.length, 0);

  return (
    <Section
      title={recapTitle(recap.window)}
      remember={{ page: 'focus', key: 'recap' }}
    >
      <div data-recap className="flex flex-col gap-3">
        <p
          data-recap-line
          className="text-sm text-muted-foreground tabular-nums"
        >
          {recapLine(recap)}
        </p>

        {closedCount > 0 && (
          <section aria-labelledby="recap-closed" className="flex flex-col">
            <h3 id="recap-closed" className={SUBHEAD}>
              Closed
              <span className="count text-xs font-normal text-muted-foreground tabular-nums">
                {closedCount}
              </span>
            </h3>
            {grouped(recap.closed, 'Closed', (t) => taskRow(t, false))}
          </section>
        )}

        {recap.added.length > 0 && (
          <section aria-labelledby="recap-added" className="flex flex-col">
            <h3 id="recap-added" className={SUBHEAD}>
              Added
              <span className="count text-xs font-normal text-muted-foreground tabular-nums">
                {recap.added.length}
              </span>
            </h3>
            {recap.added.length <= RECAP_ADDED_TITLES ? (
              <ul aria-label="Added" className="flex flex-col border-t">
                {recap.added.map((t) => taskRow(t, true))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {recap.added.length} tasks added; they are on Tasks.
              </p>
            )}
          </section>
        )}

        {recap.meetings.length > 0 && (
          <section aria-labelledby="recap-meetings" className="flex flex-col">
            <h3 id="recap-meetings" className={SUBHEAD}>
              Meetings held
              <span className="count text-xs font-normal text-muted-foreground tabular-nums">
                {recap.meetings.length}
              </span>
            </h3>
            <ul aria-label="Meetings held" className="flex flex-col border-t">
              {recap.meetings.map((m) => {
                const line = recapMeetingLine(m);
                return (
                  <li
                    key={m.meeting.id}
                    data-recap-meeting={m.meeting.id}
                    className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 border-b py-1.5 desk:min-h-9"
                  >
                    <span className="flex min-w-0 items-baseline gap-2 text-sm">
                      <a
                        {...linkProps({ name: 'meeting', id: m.meeting.id })}
                        className={`${LINK} truncate`}
                      >
                        {m.meeting.title}
                      </a>
                      {!oneDay && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDay(m.meeting.date, today)}
                        </span>
                      )}
                    </span>
                    {line && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {line}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {notesCount > 0 && (
          <section aria-labelledby="recap-notes" className="flex flex-col">
            <h3 id="recap-notes" className={SUBHEAD}>
              Notes written
              <span className="count text-xs font-normal text-muted-foreground tabular-nums">
                {notesCount}
              </span>
            </h3>
            {grouped(recap.notes, 'Notes written', (n) => (
              <li key={n.id} data-recap-note={n.id} className={ROW}>
                <a
                  {...linkProps({ name: 'notes' }, `note=${n.id}`)}
                  className={`${LINK} flex min-h-11 min-w-0 flex-1 items-center desk:min-h-0`}
                >
                  <span className="truncate">
                    {noteTitle(n, people) || 'Untitled note'}
                  </span>
                </a>
              </li>
            ))}
          </section>
        )}

        {recap.activity.length > 0 && (
          <section aria-labelledby="recap-activity" className="flex flex-col">
            <h3 id="recap-activity" className={SUBHEAD}>
              Activity
            </h3>
            {recap.activity.map((group) => {
              const name = group.project?.name ?? 'General';
              return (
                <div key={group.project?.id ?? ''} className="flex flex-col">
                  <p className={PROJECT}>{projectLabel(group.project)}</p>
                  <ul
                    aria-label={`Activity: ${name}`}
                    data-recap-activity={group.project?.id ?? ''}
                    className="flex flex-col border-t"
                  >
                    {group.items.map((e) => (
                      <li
                        key={`${e.t} ${e.text}`}
                        className="min-w-0 border-b py-1.5 text-sm break-words"
                      >
                        {e.text}
                      </li>
                    ))}
                    {group.more > 0 && (
                      <li className="py-1.5 text-xs text-muted-foreground tabular-nums">
                        and {group.more} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </Section>
  );
}
