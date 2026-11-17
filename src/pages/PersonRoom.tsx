import { CalendarPlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { waitingCount } from '#shared/loops';
import { PROJECT_PARAM, type Room } from '#shared/rooms';
import { meId } from '#shared/select';
import {
  personLanes,
  personOrgs,
  personProjects,
  personStateLine,
  personStream,
  personTopics,
  splitStream,
  streamNow,
} from '#shared/stream';
import type { SummaryTarget } from '#shared/summaries';
import { localTime, nextMeeting } from '#shared/today';
import { type Snapshot, settingsOf } from '#shared/types';
import { CaptureLine } from '@/components/capture/CaptureLine';
import { DetailActions, type MenuAction } from '@/components/DetailActions';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { useNotes } from '@/components/notes/NotesProvider';
import { PinButton } from '@/components/PinButton';
import { PersonForm } from '@/components/people/PersonForm';
import { RemovePersonDialog } from '@/components/people/RemovePersonDialog';
import { YouTag } from '@/components/people/YouTag';
import {
  NextMeeting,
  ProjectFilter,
  RoomColumns,
  RoomFrame,
  RoomHeader,
} from '@/components/rooms/RoomFrame';
import { RoomStream } from '@/components/rooms/RoomStream';
import { SummarizeButton, SummaryCard } from '@/components/summary/SummaryCard';
import { type LaneLabels, LoopLanes } from '@/components/today/LoopLanes';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useNow, useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps, navigate, useQuery } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

/** The lanes' names: the owner's from Settings → Rooms (#343), or the room's own. */
function laneLabels(state: Snapshot): LaneLabels {
  const names = settingsOf(state).laneLabels;
  return {
    mine: names.youOwe,
    waiting: names.theyOwe,
    decide: names.discuss,
    mineEmpty: 'You owe them nothing.',
    waitingEmpty: 'They owe you nothing.',
    decideEmpty: 'Nothing to discuss.',
  };
}

/**
 * A person's room (#335), the person's page and the 1:1 prep. The header
 * has the orgs of their projects, their name and the state line (role,
 * how many projects, how many loops are open), with Pin, Schedule
 * meeting, Edit (name, role, This is me) and Remove. Under it, their
 * projects to narrow the room to (`?project=`, pinnable as the same pair
 * the project's room pins), the Next meeting card, then the lanes (You
 * owe, They owe you, To discuss with the open topics of their meetings
 * ahead) beside the stream, with the capture line on top: a note
 * mentions them, a task is theirs, and narrowed, both file to the
 * project.
 */
export function PersonRoom({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { newMeeting } = useMeetingForm();
  const { hidden } = useNotes();
  const { show } = useToast();
  const { active } = useMotion();
  const clock = useClock();
  const today = useToday();
  const nowMs = useNow();
  const query = useQuery();
  const person = state?.people[id];
  usePageTitle(person?.name ?? (state ? 'Not found' : 'Person'));
  const [editing, setEditing] = useState<{ key: number; open: boolean }>();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const lanesRoot = useRef<HTMLDivElement>(null);
  useFlip(lanesRoot, active);
  const topicsId = useId();

  const asked = query.get(PROJECT_PARAM);
  const project = asked && state?.projects[asked] ? asked : null;
  const me = state ? meId(state.people) : null;
  const now = localTime(nowMs);

  const lanes = useMemo(
    () => (state ? personLanes(state, me, id, project) : null),
    [state, me, id, project],
  );
  const topics = useMemo(
    () => (state ? personTopics(state, id, today, now, project) : []),
    [state, id, today, now, project],
  );
  const stream = useMemo(
    () => (state ? personStream(state, id, project, hidden) : []),
    [state, id, project, hidden],
  );
  const projects = useMemo(
    () => (state ? personProjects(state, id) : []),
    [state, id],
  );

  if (!state || !lanes) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!person && leaving) return null;
  if (!person) {
    return (
      <NotFoundPage
        what="person"
        back={{ name: 'people' }}
        backLabel="Go to People"
      />
    );
  }

  const split = splitStream(stream, streamNow(nowMs));
  const open = lanes.mine.length + waitingCount(lanes) + lanes.decide.length;
  const projectName = project ? state.projects[project]?.name : undefined;
  const stateLine = personStateLine(person, projects.length, open);
  const orgs = personOrgs(projects);
  const room: Room = project
    ? { kind: 'pair', project, person: person.id }
    : { kind: 'person', id: person.id };

  const meetings = Object.values(state.meetings).filter(
    (m) =>
      m.attendees.includes(person.id) && (!project || m.projectId === project),
  );
  const next = nextMeeting(
    {
      meetings: Object.fromEntries(meetings.map((m) => [m.id, m])),
      projects: state.projects,
    },
    today,
    now,
  );
  const assigned = Object.values(state.tasks).filter(
    (t) => t.assignee === person.id,
  ).length;

  const remove = () => {
    setLeaving(true);
    if (!actions.removePerson({ id: person.id })) {
      setLeaving(false);
      return;
    }
    setRemoveOpen(false);
    show(`Removed ${person.name}`);
    navigate({ name: 'people' }, { replace: true });
  };

  /** Summarize's target: the room as narrowed, as of when it is asked. */
  const summaryTarget = (): SummaryTarget => ({
    kind: 'room',
    room: { kind: 'person', id: person.id, project },
    today,
    now: localTime(Date.now()),
  });

  const menu: MenuAction[] = [
    {
      label: 'Remove',
      icon: <TrashIcon />,
      onSelect: () => setRemoveOpen(true),
      destructive: true,
    },
  ];

  const discuss = {
    count: topics.length,
    node: (
      <section aria-labelledby={topicsId} className="flex flex-col">
        <h3
          id={topicsId}
          className="flex min-h-11 items-center pt-1 text-sm font-medium desk:min-h-8"
        >
          Topics
        </h3>
        <ul aria-label="Open topics" className="flex flex-col border-t">
          {topics.map(({ meeting, topic }) => (
            <li
              key={`${meeting.id}:${topic.id}`}
              data-topic={topic.id}
              className="flex flex-col border-b text-sm desk:py-0.5"
            >
              <a
                {...linkProps({ name: 'meeting', id: meeting.id })}
                className="flex min-h-11 items-center text-left outline-ring/50 hover:underline focus-visible:outline-2 desk:min-h-7"
              >
                {topic.title}
              </a>
              <span className="pb-1 text-xs text-muted-foreground">
                {meeting.title}, {formatDay(meeting.date, today)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
  };

  const header = (
    <>
      <RoomHeader
        titleId="person-title"
        kicker={orgs.length > 0 ? orgs.join(' · ') : 'No org'}
        title={person.name}
        titleEnd={person.me ? <YouTag /> : undefined}
        stateLine={
          projectName ? [...stateLine, `Narrowed to ${projectName}`] : stateLine
        }
        summary={
          <SummaryCard
            target={summaryTarget}
            footnote="Written on this device by a small model from what this room shows. Check it before you rely on it."
            className="mt-2"
          />
        }
        actions={
          <>
            <PinButton room={room} />
            <Button
              variant="outline"
              className="press h-11 desk:h-8"
              onClick={() =>
                newMeeting({
                  attendees: [person.id],
                  projectId: project,
                })
              }
            >
              <CalendarPlusIcon />
              Schedule meeting
            </Button>
            <SummarizeButton target={summaryTarget} />
            <DetailActions
              onEdit={() => setEditing({ key: Date.now(), open: true })}
              menu={menu}
            />
          </>
        }
      />
      {editing && (
        <PersonForm
          key={editing.key}
          person={person}
          open={editing.open}
          onClose={() => setEditing((e) => (e ? { ...e, open: false } : e))}
          onExited={() => setEditing((e) => (e?.open ? e : undefined))}
          onRemoved={() => {
            setLeaving(true);
            navigate({ name: 'people' }, { replace: true });
          }}
        />
      )}
      <RemovePersonDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        name={person.name}
        assigned={assigned}
        onRemove={remove}
      />
    </>
  );

  return (
    <RoomFrame
      titleId="person-title"
      header={header}
      filter={
        <ProjectFilter
          projects={projects}
          selected={project}
          hrefFor={(p) => ({
            route: { name: 'person', id: person.id },
            query: p ? `${PROJECT_PARAM}=${encodeURIComponent(p)}` : '',
          })}
        />
      }
      next={
        next && (
          <NextMeeting
            meeting={next}
            today={today}
            clock={clock}
            people={state.people}
          />
        )
      }
    >
      <RoomColumns
        lanes={
          <div ref={lanesRoot} className="flex flex-col gap-4">
            <LoopLanes
              lanes={lanes}
              page="person"
              today={today}
              projects={project ? {} : state.projects}
              people={state.people}
              labels={laneLabels(state)}
              discuss={discuss}
            />
          </div>
        }
        stream={
          <>
            <h2 className="sr-only">Stream</h2>
            <CaptureLine
              context={{ personId: person.id, projectId: project }}
            />
            <RoomStream
              key={project ?? ''}
              upcoming={split.upcoming}
              items={split.past}
              state={state}
              today={today}
              empty={
                projectName
                  ? `Nothing in ${projectName} touches ${person.name} yet.`
                  : `Nothing touches ${person.name} yet. Capture a note or a task above.`
              }
            />
          </>
        }
      />
    </RoomFrame>
  );
}
