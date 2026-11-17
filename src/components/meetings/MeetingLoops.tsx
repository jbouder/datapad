import { useId, useMemo } from 'react';
import { lanesOf } from '#shared/loops';
import { oneOnOneWith } from '#shared/meetings';
import { meId } from '#shared/select';
import { personLanes } from '#shared/stream';
import type { Meeting, Snapshot } from '#shared/types';
import { LoopLanes } from '@/components/today/LoopLanes';
import { linkProps } from '@/lib/router';

/**
 * Meeting mode's right column (#336): what is open with the people in
 * the room. For a 1:1 (one attendee besides you), that person's open
 * loops, as their room has them (`personLanes`); otherwise the meeting's project's; with
 * neither, a line that says so. The lanes are Today's (`LoopLanes`), in
 * the order Today keeps them.
 */
export function MeetingLoops({
  meeting,
  state,
  today,
}: {
  meeting: Meeting;
  state: Snapshot;
  today: string;
}) {
  const headingId = useId();
  const me = meId(state.people);
  const personId = oneOnOneWith(meeting, me);
  const person = personId ? state.people[personId] : undefined;
  const project = meeting.projectId
    ? state.projects[meeting.projectId]
    : undefined;
  const { tasks, projects, people } = state;
  const lanes = useMemo(() => {
    const scope = { tasks, projects, people };
    if (personId) return personLanes(scope, me, personId);
    if (project) return lanesOf(scope, me, (t) => t.projectId === project.id);
    return null;
  }, [tasks, projects, people, me, personId, project]);

  const room = person
    ? { route: { name: 'person' as const, id: person.id }, name: person.name }
    : project
      ? {
          route: { name: 'project' as const, id: project.id },
          name: project.name,
        }
      : null;

  return (
    <aside
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2 desk:col-start-2 xl:col-start-auto"
    >
      <h2 id={headingId} className="text-xs font-medium">
        Open loops
        {room && (
          <>
            {' '}
            with{' '}
            <a
              {...linkProps(room.route)}
              className="underline-offset-2 outline-ring/50 hover:underline focus-visible:outline-2"
            >
              {room.name}
            </a>
          </>
        )}
      </h2>
      {lanes ? (
        <LoopLanes
          lanes={lanes}
          page="focus"
          today={today}
          projects={state.projects}
          people={state.people}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No project, and not a 1:1, so no open loops to show.
        </p>
      )}
    </aside>
  );
}
