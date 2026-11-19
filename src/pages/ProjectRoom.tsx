import {
  ArchiveIcon,
  ArrowsLeftRightIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  CopySimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { lanesOf, waitingCount } from '#shared/loops';
import {
  NOTE_PARAM,
  PERSON_PARAM,
  type Room,
  roomPinnedNotes,
} from '#shared/rooms';
import { type RoomTab, roomTabRoute } from '#shared/routes';
import { meId } from '#shared/select';
import {
  projectKeep,
  projectStateLine,
  projectStream,
  roomPeople,
  splitStream,
  streamNow,
} from '#shared/stream';
import type { SummaryTarget } from '#shared/summaries';
import { localTime, nextMeeting } from '#shared/today';
import {
  GENERAL,
  milestonesOf,
  type ProjectStatus,
  SETTINGS_ID,
  type SpaceInfo,
} from '#shared/types';
import { CaptureLine } from '@/components/capture/CaptureLine';
import { DetailActions, type MenuAction } from '@/components/DetailActions';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { useNotes } from '@/components/notes/NotesProvider';
import { PinButton } from '@/components/PinButton';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { MoveProjectDialog } from '@/components/projects/MoveProjectDialog';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { ProjectPlan } from '@/components/projects/ProjectPlan';
import { PinnedNotesNav, PinnedNoteView } from '@/components/rooms/PinnedNotes';
import {
  NextMeeting,
  PersonFilter,
  RoomColumns,
  RoomFrame,
  RoomHeader,
  type RoomTabLink,
  RoomTabs,
} from '@/components/rooms/RoomFrame';
import { RoomStream } from '@/components/rooms/RoomStream';
import { SummarizeButton, SummaryCard } from '@/components/summary/SummaryCard';
import { useTemplateForm } from '@/components/templates/TemplateFormProvider';
import { LoopLanes } from '@/components/today/LoopLanes';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useNow, useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePins } from '@/hooks/usePins';
import { moveProject } from '@/lib/api';
import { navigate, useQuery } from '@/lib/router';
import { cn } from '@/lib/utils';
import { ProjectBoard, ProjectBoardMenu } from '@/pages/lazy';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useSpaces } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const TAB_LABELS: Record<RoomTab, string> = {
  stream: 'Stream',
  plan: 'Plan',
  whiteboard: 'Whiteboard',
};

const STATUS_ACTIONS: {
  status: ProjectStatus;
  label: string;
  icon: React.ReactNode;
}[] = [
  { status: 'active', label: 'Mark active', icon: <PlayCircleIcon /> },
  { status: 'paused', label: 'Pause', icon: <PauseCircleIcon /> },
  { status: 'done', label: 'Mark done', icon: <CheckCircleIcon /> },
];

/**
 * A project's room (#334), in place of the project page. The header has
 * the org, the name and the state line (health, status when not
 * active, target, next milestone, how many loops are open), with Pin,
 * Schedule meeting, Edit and a More menu (status, Move to…, Save as
 * template, Archive, Delete). Under it, the people to narrow the room
 * to (`?person=`, kept on every tab and pinnable as a pair), the Next
 * meeting card, and three tabs:
 *
 * - **Stream** (`/projects/:id`): the lanes beside the stream on
 *   desktop, above it on phones, with the capture line on top, preset
 *   to the project (and, narrowed, to the person).
 * - **Plan** (`/projects/:id/plan`): description, details and health,
 *   the timeline bar, milestones, members, links, and Activity.
 * - **Whiteboard** (`/projects/:id/whiteboard`): the board, full-bleed.
 */
export function ProjectRoom({ id, tab }: { id: string; tab: RoomTab }) {
  const { state, actions } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const { newTemplate } = useTemplateForm();
  const { newMeeting } = useMeetingForm();
  const { hidden } = useNotes();
  const rail = usePins();
  const { show } = useToast();
  const { active } = useMotion();
  const clock = useClock();
  const today = useToday();
  const nowMs = useNow();
  const query = useQuery();
  const project = state?.projects[id];
  usePageTitle(project?.name ?? (state ? 'Not found' : 'Project'));
  const { spaces, current, openInSpace } = useSpaces();
  const elsewhere = useMemo(
    () => spaces.filter((s) => s.id !== current.id),
    [spaces, current.id],
  );
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** Moved away or deleted just now: on the way to All. */
  const [leaving, setLeaving] = useState(false);
  const lanesRoot = useRef<HTMLDivElement>(null);
  useFlip(lanesRoot, active);

  const asked = query.get(PERSON_PARAM);
  const person = asked && state?.people[asked] ? asked : null;
  const me = state ? meId(state.people) : null;

  const lanes = useMemo(
    () => (state ? lanesOf(state, me, projectKeep(id, person)) : null),
    [state, me, id, person],
  );
  const stream = useMemo(
    () => (state ? projectStream(state, id, person, hidden) : []),
    [state, id, person, hidden],
  );
  const people = useMemo(
    () => (state ? roomPeople(state, id) : []),
    [state, id],
  );
  const pinned = useMemo(
    () =>
      state ? roomPinnedNotes(state, { kind: 'project', id }, hidden) : [],
    [state, id, hidden],
  );
  const asking = query.get(NOTE_PARAM);
  const openPin = pinned.find((n) => n.id === asking) ?? null;

  // A link to a milestone (`?milestone=`) opens the Plan, where it is.
  const milestoneLink = query.get('milestone');
  useEffect(() => {
    if (milestoneLink && tab === 'stream') {
      navigate(roomTabRoute(id, 'plan'), {
        replace: true,
        query: query.toString(),
      });
    }
  }, [milestoneLink, tab, id, query]);

  if (!state || !lanes) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!project && leaving) return null;
  if (!project || id === GENERAL) {
    return (
      <div className={cn(tab === 'whiteboard' && 'px-4 pt-6 sm:px-6')}>
        <NotFoundPage
          what="project"
          back={{ name: 'all', kinds: ['project'] }}
          backLabel="Go to All"
        />
      </div>
    );
  }

  const split = splitStream(stream, streamNow(nowMs));
  const open = lanes.mine.length + waitingCount(lanes) + lanes.decide.length;
  const stateLine = projectStateLine(project, open, today, (d) =>
    formatDay(d, today),
  );
  const personName = person ? state.people[person]?.name : undefined;
  const room: Room = person
    ? { kind: 'pair', project: project.id, person }
    : { kind: 'project', id: project.id };
  const keepPerson = person
    ? `${PERSON_PARAM}=${encodeURIComponent(person)}`
    : '';

  const meetings = Object.values(state.meetings).filter(
    (m) => m.projectId === id && (!person || m.attendees.includes(person)),
  );
  const next = nextMeeting(
    {
      meetings: Object.fromEntries(meetings.map((m) => [m.id, m])),
      projects: state.projects,
    },
    today,
    localTime(nowMs),
  );

  const openTasks = Object.values(state.tasks).filter(
    (t) => t.projectId === id && t.status === 'open',
  );

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

  const setStatus = (status: ProjectStatus) => {
    const was = project.status;
    if (!actions.setStatus({ id: project.id, status })) return;
    show(`${project.name} is ${status === 'paused' ? 'paused' : status}`, () =>
      actions.setStatus({ id: project.id, status: was }),
    );
  };

  /** Off the rail's list (and unpinned), or back on it, with Undo. */
  const offRail = rail.hidden(project.id);
  const toggleRail = () => {
    const before = state.settings[SETTINGS_ID];
    if (!rail.setHidden(project.id, !offRail)) return;
    show(
      offRail
        ? `${project.name} is back on the rail`
        : `Hid ${project.name} from the rail`,
      () =>
        actions.setSettings({
          patch: {
            hiddenRooms: before?.hiddenRooms ?? null,
            pinned: before?.pinned ?? null,
          },
        }),
    );
  };

  /** A kickoff template from the open tasks, in the template panel. */
  const saveAsTemplate = () =>
    newTemplate({
      name: `${project.name} kickoff`,
      defaultTags: project.tags,
      tasks: openTasks
        .sort((a, b) => a.order - b.order)
        .map((t) => ({ title: t.title, priority: t.priority, tags: t.tags })),
    });

  /**
   * Move it to another space, on the server (it spans two spaces, so it
   * is not an op). It is gone from this one after, so on to All; the
   * toast's Open follows it there.
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
    navigate({ name: 'all', kinds: ['project'] });
    show(`Moved ${project.name} to ${to.name}`, undefined, {
      label: 'Open',
      run: () => openInSpace(to.id, { name: 'project', id }),
    });
    return true;
  };

  const remove = () => {
    setLeaving(true);
    if (!actions.deleteProject({ id: project.id })) {
      setLeaving(false);
      return;
    }
    setDeleteOpen(false);
    show(`Deleted ${project.name}`);
    navigate({ name: 'all', kinds: ['project'] });
  };

  /** Summarize's target: the room as narrowed, as of when it is asked. */
  const summaryTarget = (): SummaryTarget => ({
    kind: 'room',
    room: { kind: 'project', id: project.id, person },
    today,
    now: localTime(Date.now()),
  });

  const menu: MenuAction[] = [
    ...STATUS_ACTIONS.map((a) => ({
      label: a.label,
      icon: a.icon,
      onSelect: () => setStatus(a.status),
      hidden: project.status === a.status,
    })),
    {
      label: 'Move to…',
      icon: <ArrowsLeftRightIcon />,
      onSelect: () => setMoveOpen(true),
      hidden: elsewhere.length === 0,
    },
    {
      label: offRail ? 'Show on rail' : 'Hide from rail',
      icon: offRail ? <EyeIcon /> : <EyeSlashIcon />,
      onSelect: toggleRail,
    },
    {
      label: 'Save as template',
      icon: <CopySimpleIcon />,
      onSelect: saveAsTemplate,
      hidden: openTasks.length === 0,
    },
    {
      label: project.archived ? 'Unarchive' : 'Archive',
      icon: <ArchiveIcon />,
      onSelect: toggleArchive,
      end: true,
    },
    {
      label: 'Delete',
      icon: <TrashIcon />,
      onSelect: () => setDeleteOpen(true),
      destructive: true,
    },
  ];

  const tabs: RoomTabLink<RoomTab>[] = (
    ['stream', 'plan', 'whiteboard'] as const
  ).map((key) => ({
    key,
    label: TAB_LABELS[key],
    route: roomTabRoute(id, key),
    query: keepPerson,
  }));

  const board = tab === 'whiteboard';
  /** On the board, the page has no padding of its own: the room adds it. */
  const pad = board ? 'px-4 sm:px-6' : '';
  const here = roomTabRoute(id, tab);
  const openNote = openPin ? state.notes[openPin.id] : undefined;

  const header = (
    <div className={cn(pad, board && 'pt-4')}>
      <RoomHeader
        titleId="project-title"
        kicker={project.org || 'No org'}
        title={project.name}
        stateLine={
          personName ? [...stateLine, `Narrowed to ${personName}`] : stateLine
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
                  projectId: id,
                  fixedProject: true,
                  ...(person ? { attendees: [person] } : {}),
                })
              }
            >
              <CalendarPlusIcon />
              Schedule meeting
            </Button>
            <SummarizeButton target={summaryTarget} />
            <DetailActions
              onEdit={() => openProjectForm(project.id)}
              menu={menu}
            />
          </>
        }
      />
      <MoveProjectDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        projectName={project.name}
        spaces={elsewhere}
        onMove={move}
      />
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={project.name}
        tasks={
          Object.values(state.tasks).filter((t) => t.projectId === id).length
        }
        notes={
          Object.values(state.notes).filter((n) => n.projectId === id).length
        }
        milestones={milestonesOf(project).length}
        onDelete={remove}
      />
    </div>
  );

  return (
    <RoomFrame
      titleId="project-title"
      className={cn(board && 'min-h-0 flex-1 gap-3')}
      header={header}
      filter={
        !board && (
          <PersonFilter
            people={people}
            selected={person}
            hrefFor={(p) => ({
              route: roomTabRoute(id, tab),
              query: p ? `${PERSON_PARAM}=${encodeURIComponent(p)}` : '',
            })}
          />
        )
      }
      next={
        !board &&
        next && (
          <NextMeeting
            meeting={next}
            today={today}
            clock={clock}
            people={state.people}
          />
        )
      }
      tabs={
        <div className={pad}>
          <RoomTabs
            tabs={tabs}
            current={tab}
            label={`${project.name} room`}
            pinned={
              pinned.length > 0 && (
                <PinnedNotesNav
                  notes={pinned}
                  open={openPin?.id ?? null}
                  route={here}
                  query={query.toString()}
                />
              )
            }
            end={
              board && (
                <Suspense fallback={null}>
                  <ProjectBoardMenu project={project} />
                </Suspense>
              )
            }
          />
        </div>
      }
    >
      {openPin && openNote && (
        <div
          className={cn(pad, board && 'max-h-[45svh] shrink-0 overflow-y-auto')}
        >
          <PinnedNoteView
            note={openNote}
            label={openPin.label}
            people={state.people}
            route={here}
            query={query.toString()}
          />
        </div>
      )}
      {tab === 'stream' && (
        <RoomColumns
          lanes={
            <div ref={lanesRoot} className="flex flex-col gap-4">
              <LoopLanes
                lanes={lanes}
                page="project"
                today={today}
                projects={{}}
                people={state.people}
              />
            </div>
          }
          stream={
            <>
              <h2 className="sr-only">Stream</h2>
              {!project.archived && (
                <CaptureLine
                  context={{ projectId: project.id, personId: person }}
                />
              )}
              <RoomStream
                key={person ?? ''}
                upcoming={split.upcoming}
                items={split.past}
                state={state}
                today={today}
                empty={
                  personName
                    ? `Nothing in ${project.name} touches ${personName} yet.`
                    : 'Nothing here yet. Capture a note or a task above.'
                }
                openAtTop={openPin?.id ?? null}
                milestoneRoute={(projectId, milestone) => ({
                  route: roomTabRoute(projectId, 'plan'),
                  query: `milestone=${encodeURIComponent(milestone)}`,
                })}
              />
            </>
          }
        />
      )}
      {tab === 'plan' && <ProjectPlan project={project} state={state} />}
      {board && (
        <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
          <ProjectBoard project={project} />
        </Suspense>
      )}
    </RoomFrame>
  );
}
