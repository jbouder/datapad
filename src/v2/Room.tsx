/**
 * Prototype: a room. A project and a person get the same page: one line
 * of state, the open loops in three lanes, then one stream of everything
 * attached, newest first. A person's room is the 1:1 prep.
 */
import { useMemo } from 'react';
import { formatDay, formatTime, formatTimestamp } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { mentionedIds } from '#shared/mentions';
import { meId } from '#shared/select';
import {
  healthOf,
  type List,
  type Meeting,
  milestonesOf,
  type Note,
  type Snapshot,
  type Task,
} from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useNow, useToday } from '@/hooks/useNow';
import { Capture } from './Capture';
import {
  type Lanes,
  lanesOf,
  localTime,
  nextMeetingFrom,
  taskTouches,
  waitingOn,
} from './model';
import {
  Chip,
  Go,
  LanesPanel,
  personName,
  RoomHeader,
  SectionTitle,
} from './parts';

type StreamItem =
  | { kind: 'note'; at: string; note: Note }
  | { kind: 'task'; at: string; task: Task }
  | { kind: 'meeting'; at: string; meeting: Meeting }
  | { kind: 'list'; at: string; list: List };

const HEALTH_WORDS = {
  none: '',
  green: 'On track',
  yellow: 'At risk',
  red: 'Off track',
};

export function ProjectRoom({ id }: { id: string }) {
  const { state } = useDatapad();
  const today = useToday();
  const now = useNow();
  const me = state ? meId(state.people) : null;
  const lanes = useMemo(
    () => (state ? lanesOf(state, me, (t) => t.projectId === id) : null),
    [state, me, id],
  );
  const project = state?.projects[id];
  if (!state || !lanes) return null;
  if (!project) return <Missing what="project" />;

  const meetings = Object.values(state.meetings).filter(
    (m) => m.projectId === id,
  );
  const next = nextMeetingFrom(
    meetings,
    today,
    localTime(new Date(now).toISOString()),
  );
  const milestone = milestonesOf(project).find((m) => m.date >= today);
  const health = HEALTH_WORDS[healthOf(project)];
  const stateLine = [
    health,
    project.status !== 'active' &&
      (project.status === 'paused' ? 'Paused' : 'Done'),
    project.targetDate && `target ${formatDay(project.targetDate, today)}`,
    milestone &&
      `next: ${milestone.title}, ${formatDay(milestone.date, today)}`,
    loopsLine(lanes),
  ]
    .filter(Boolean)
    .join(' · ');

  const stream: StreamItem[] = [
    ...Object.values(state.notes)
      .filter((n) => n.projectId === id && !n.scratch)
      .map((note) => ({ kind: 'note' as const, at: note.createdAt, note })),
    ...Object.values(state.tasks)
      .filter((t) => t.projectId === id)
      .map((task) => ({
        kind: 'task' as const,
        at: task.completedAt ?? task.createdAt,
        task,
      })),
    ...meetings.map((meeting) => ({
      kind: 'meeting' as const,
      at: `${meeting.date}T${meeting.time || '00:00'}`,
      meeting,
    })),
    ...Object.values(state.lists)
      .filter((l) => l.projectId === id)
      .map((list) => ({ kind: 'list' as const, at: list.updatedAt, list })),
  ];

  return (
    <Room
      header={
        <RoomHeader
          kicker={project.org || 'Project'}
          title={project.name}
          state={stateLine}
          actions={
            <a
              href={`/projects/${encodeURIComponent(id)}/whiteboard`}
              className="inline-flex h-11 items-center border border-border px-3 text-xs hover:bg-muted desk:h-8"
            >
              Whiteboard
            </a>
          }
        />
      }
      next={next}
      lanes={<LanesPanel lanes={lanes} showProject={false} />}
      stream={stream}
      context={{ projectId: id }}
      placeholder={`Capture into ${project.name}…`}
    />
  );
}

export function PersonRoom({ id }: { id: string }) {
  const { state } = useDatapad();
  const today = useToday();
  const now = useNow();
  const me = state ? meId(state.people) : null;
  const person = state?.people[id];
  const lanes = useMemo<Lanes | null>(() => {
    if (!state) return null;
    const touches = lanesOf(state, me, (t) => taskTouches(t, id));
    // They owe you: what waits on them. You owe: yours that mention them.
    const theyOwe = touches.waiting.filter((g) => g.personId === id);
    return {
      mine: touches.mine,
      waiting: theyOwe,
      decide: touches.decide,
    };
  }, [state, me, id]);
  if (!state || !lanes) return null;
  if (!person) return <Missing what="person" />;

  const meetings = Object.values(state.meetings).filter((m) =>
    m.attendees.includes(id),
  );
  const next = nextMeetingFrom(
    meetings,
    today,
    localTime(new Date(now).toISOString()),
  );
  const projects = Object.values(state.projects).filter(
    (p) => !p.archived && p.members.includes(id),
  );
  const stateLine = [
    person.role,
    projects.length > 0 && projects.map((p) => p.name).join(', '),
    loopsLine(lanes),
  ]
    .filter(Boolean)
    .join(' · ');

  const stream: StreamItem[] = [
    ...Object.values(state.notes)
      .filter((n) => mentionedIds(n.body).includes(id))
      .map((note) => ({ kind: 'note' as const, at: note.createdAt, note })),
    ...Object.values(state.tasks)
      .filter((t) => taskTouches(t, id))
      .map((task) => ({
        kind: 'task' as const,
        at: task.completedAt ?? task.createdAt,
        task,
      })),
    ...meetings.map((meeting) => ({
      kind: 'meeting' as const,
      at: `${meeting.date}T${meeting.time || '00:00'}`,
      meeting,
    })),
  ];

  return (
    <Room
      header={
        <RoomHeader
          kicker={person.me ? 'You' : 'Person'}
          title={person.name}
          state={stateLine}
        />
      }
      next={next}
      lanes={
        <>
          <LanesPanel
            lanes={lanes}
            labels={['You owe', 'They owe you', 'To discuss']}
            groupWaiting={false}
          />
          <OpenTopics meetings={meetings} />
        </>
      }
      stream={stream}
      context={{ personId: id }}
      placeholder={`Capture about ${person.name}…`}
    />
  );
}

function loopsLine(lanes: Lanes): string {
  const waiting = lanes.waiting.reduce((n, g) => n + g.tasks.length, 0);
  const open = lanes.mine.length + waiting + lanes.decide.length;
  return open === 0 ? 'nothing open' : `${open} open`;
}

function Room({
  header,
  next,
  lanes,
  stream,
  context,
  placeholder,
}: {
  header: React.ReactNode;
  next: Meeting | null;
  lanes: React.ReactNode;
  stream: StreamItem[];
  context: { projectId?: string; personId?: string };
  placeholder: string;
}) {
  const today = useToday();
  const clock = useClock();
  const sorted = [...stream].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div>
      {header}
      {next && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-primary/50 bg-primary/5 p-3">
          <p className="text-sm">
            <span className="text-primary">Next: </span>
            {next.title},{' '}
            {next.date === today ? 'today' : formatDay(next.date, today)}
            {next.time && ` ${formatTime(next.time, clock)}`}
          </p>
          <Go
            to={{ name: 'meeting', id: next.id }}
            className="inline-flex h-11 items-center bg-primary px-3 font-medium text-primary-foreground text-xs desk:h-8"
          >
            Enter meeting
          </Go>
        </div>
      )}
      <div className="grid gap-8 desk:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="desk:order-first">{lanes}</div>
        <section aria-label="Stream" className="min-w-0">
          <SectionTitle count={sorted.length}>Stream</SectionTitle>
          <Capture
            context={context}
            placeholder={placeholder}
            className="mb-4"
          />
          <ol className="flex flex-col divide-y divide-border">
            {sorted.slice(0, 80).map((item) => (
              <li key={`${item.kind}-${keyOf(item)}`} className="py-3">
                <StreamRow item={item} />
              </li>
            ))}
          </ol>
          {sorted.length > 80 && (
            <p className="text-muted-foreground text-xs">
              Older items are under All.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function keyOf(item: StreamItem): string {
  switch (item.kind) {
    case 'note':
      return item.note.id;
    case 'task':
      return item.task.id;
    case 'meeting':
      return item.meeting.id;
    case 'list':
      return item.list.id;
  }
}

function StreamRow({ item }: { item: StreamItem }) {
  const { state, actions } = useDatapad();
  const today = useToday();
  const clock = useClock();
  if (!state) return null;
  const when =
    item.kind === 'meeting'
      ? formatDay(item.meeting.date, today)
      : formatTimestamp(item.at, clock);
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 pt-0.5 text-muted-foreground text-xs">
        {when}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {item.kind === 'note' && (
          <>
            <Markdown
              text={item.note.body}
              people={state.people}
              onToggle={(line) =>
                actions.editNote({
                  id: item.note.id,
                  body: toggleCheck(item.note.body, line),
                })
              }
            />
            {item.note.meetingId && (
              <Chip>
                from {state.meetings[item.note.meetingId]?.title ?? 'a meeting'}
              </Chip>
            )}
          </>
        )}
        {item.kind === 'task' && (
          <TaskStreamRow task={item.task} state={state} />
        )}
        {item.kind === 'meeting' && (
          <Go
            to={{ name: 'meeting', id: item.meeting.id }}
            className="hover:underline"
          >
            <span className="text-muted-foreground">Meeting: </span>
            {item.meeting.title}
          </Go>
        )}
        {item.kind === 'list' && (
          <a
            href={`/lists/${encodeURIComponent(item.list.id)}`}
            className="hover:underline"
          >
            <span className="text-muted-foreground">List: </span>
            {item.list.title}{' '}
            <span className="text-muted-foreground">
              ({item.list.items.filter((i) => i.done).length}/
              {item.list.items.length})
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

function TaskStreamRow({ task, state }: { task: Task; state: Snapshot }) {
  const me = meId(state.people);
  const on = task.status === 'open' ? waitingOn(task, me) : null;
  return (
    <p>
      <span className="text-muted-foreground">
        {task.status === 'done' ? 'Done: ' : 'Task: '}
      </span>
      <a
        href={`/tasks/${encodeURIComponent(task.id)}`}
        className="hover:underline"
      >
        {task.title}
      </a>{' '}
      {on !== null && (
        <Chip tone="warn">waiting on {personName(state, on)}</Chip>
      )}
    </p>
  );
}

/** Topics still open in this person's meetings: the 1:1 agenda. */
function OpenTopics({ meetings }: { meetings: Meeting[] }) {
  const today = useToday();
  const open = meetings
    .filter((m) => m.date >= today)
    .flatMap((m) =>
      (m.topics ?? []).filter((t) => !t.done).map((t) => ({ m, t })),
    );
  if (open.length === 0) return null;
  return (
    <section aria-label="Agenda" className="mt-6">
      <SectionTitle count={open.length}>On the agenda</SectionTitle>
      <ul className="flex flex-col gap-1 text-sm">
        {open.slice(0, 8).map(({ m, t }) => (
          <li key={t.id}>
            {t.title}{' '}
            <span className="text-muted-foreground text-xs">
              {formatDay(m.date, today)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <div>
      <p className="mb-2">That {what} is not in this space.</p>
      <Go to={{ name: 'today' }} className="underline">
        Back to Today
      </Go>
    </div>
  );
}
