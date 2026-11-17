import { z } from 'zod';
import { lanesOf, todayLanes, waitingCount } from '#shared/loops';
import { unfiledNotes } from '#shared/notes';
import { savedFocusOptions } from '#shared/pages';
import { meId } from '#shared/select';
import {
  personKeep,
  personLanes,
  personProjects,
  personStateLine,
  personStream,
  personTopics,
  projectKeep,
  projectStateLine,
  projectStream,
  roomPeople,
  type StreamItem,
  splitStream,
} from '#shared/stream';
import { dayEntries, dayLine, dueOn, nextMeeting } from '#shared/today';
import { GENERAL, type Project, type Snapshot, type Task } from '#shared/types';
import { defineTool, READ_ONLY, SpaceArg, ToolError } from '../tool';
import { projectPage } from './projects';
import {
  cap,
  LimitArg,
  lanesOut,
  meetingOut,
  noteOut,
  PersonArg,
  ProjectArg,
  personRef,
  projectRef,
  RoomArg,
  readSpace,
  resolvePerson,
  resolveProject,
  resolveRoom,
  type SpaceRead,
  streamItemOut,
  TodayArg,
  taskOut,
} from './read';

/**
 * v2's reads (#340): Today, the open loops, Unfiled and the rooms, each
 * selected by `shared/today.ts`, `shared/loops.ts`, `shared/notes.ts` and
 * `shared/stream.ts` as the app's pages select them.
 */

/** How many stream items a room returns unless `limit` says otherwise. */
const STREAM_ITEMS = 50;

/**
 * Today for one day, as its page shows it: the header's line, the day's
 * meetings in time order, what is due (and late, on today), the meeting
 * coming up and the three lanes, Mine narrowed by Tasks for.
 */
function todayOut({ space, state, today, now }: SpaceRead) {
  const me = meId(state.people);
  const options = savedFocusOptions(state);
  const lanes = todayLanes(state, me, options.who);
  const meetings = dayEntries(state, today).flatMap((e) =>
    e.kind === 'meeting' ? [e.meeting] : [],
  );
  const due = dueOn(state, today, today);
  const next = nextMeeting(state, today, now, options.days);
  return {
    space,
    today,
    line: dayLine({
      meetings: meetings.length,
      due: due.length,
      waiting: waitingCount(lanes),
      decide: lanes.decide.length,
    }),
    meetings: cap(meetings.map((m) => meetingOut(state, m))),
    due: cap(due.map((t) => taskOut(state, t))),
    nextMeeting: next ? meetingOut(state, next) : null,
    lanes: lanesOut(state, lanes),
    unfiled: unfiledNotes(state.notes).length,
    me: personRef(state, me),
  };
}

const TODAY_DESCRIPTION =
  'Today, as its page shows it: the day’s one line ("2 meetings, 3 due, 4 waiting on others, 1 to decide"), its meetings in time order, the open tasks due (overdue ones too), the next meeting (within the days Settings → Pages sets, seven unless set), the three lanes of open loops (Mine, Waiting on by person, To decide; Mine holds only the owner’s tasks when Tasks for is set to Mine) and how many notes sit in Unfiled. Projects in the archive are left out.';

export const getToday = defineTool({
  name: 'get_today',
  title: 'Today',
  description: TODAY_DESCRIPTION,
  scope: 'read',
  input: z.object({ space: SpaceArg, today: TodayArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    return todayOut(await readSpace(ctx, args.space, args.today));
  },
});

/** Focus became Today (#340): the same read under its old name. */
export const getFocus = defineTool({
  name: 'get_focus',
  title: 'Focus (Today)',
  description: `The same as get_today, under the name it had before Today replaced Focus. ${TODAY_DESCRIPTION}`,
  scope: 'read',
  input: z.object({ space: SpaceArg, today: TodayArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    return todayOut(await readSpace(ctx, args.space, args.today));
  },
});

export const getLoops = defineTool({
  name: 'get_loops',
  title: 'Open loops',
  description:
    'The open tasks outside the archive in three lanes: Mine (yours to do), Waiting on (blocked, or assigned to someone other than you; grouped by person, most first) and To decide. Each lane is due first, undated last. With a project, only its tasks; with a person, only the tasks that touch them (assigned to them, blocked on them or mentioning them); with both, the project’s tasks that touch the person. With neither, the lanes as Today shows them.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    project: ProjectArg.optional(),
    person: PersonArg.optional(),
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const me = meId(state.people);
    const project =
      args.project === undefined
        ? undefined
        : resolveProject(state, args.project);
    const person =
      args.person === undefined ? undefined : resolvePerson(state, args.person);
    const lanes =
      project === null
        ? lanesOf(state, me, generalKeep(person))
        : person !== undefined
          ? personLanes(state, me, person, project)
          : project === undefined
            ? todayLanes(state, me, savedFocusOptions(state).who)
            : lanesOf(state, me, projectKeep(project));
    return {
      space,
      ...(project === undefined
        ? {}
        : {
            project:
              project === null
                ? { id: GENERAL, name: 'General' }
                : projectRef(state, project),
          }),
      ...(person === undefined ? {} : { person: personRef(state, person) }),
      ...lanesOut(state, lanes),
    };
  },
});

/**
 * General's tasks (no project), and with a person only those that touch
 * them (`personKeep`). `projectKeep` and `personLanes` take a project id,
 * and General has none.
 */
function generalKeep(person: string | undefined): (task: Task) => boolean {
  const touches = person === undefined ? null : personKeep(person);
  return (task) => task.projectId === null && (!touches || touches(task));
}

export const listUnfiled = defineTool({
  name: 'list_unfiled',
  title: 'List Unfiled',
  description:
    'Unfiled: the notes with no home (no project, meeting or task, and no one mentioned), newest first. file_note files one to a project.',
  scope: 'read',
  input: z.object({ space: SpaceArg, limit: LimitArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    return {
      space,
      notes: cap(
        unfiledNotes(state.notes).map((n) => noteOut(state, n)),
        args.limit,
      ),
    };
  },
});

/** A stream split at now: what is coming up, soonest first, and the rest. */
function streamOut(
  state: Snapshot,
  items: StreamItem[],
  read: SpaceRead,
  limit = STREAM_ITEMS,
) {
  const { upcoming, past } = splitStream(items, `${read.today}T${read.now}`);
  return {
    upcoming: cap(
      upcoming.map((i) => streamItemOut(state, i)),
      limit,
    ),
    stream: cap(
      past.map((i) => streamItemOut(state, i)),
      limit,
    ),
  };
}

export const getRoom = defineTool({
  name: 'get_room',
  title: 'Get a room',
  description:
    'One room: a project or a person, by id or name. A project’s room is get_project plus its state line, the people it can be narrowed to, its open loops in three lanes and its stream (notes, tasks added and done, meetings and milestones), with `upcoming` (meetings and milestones still ahead, soonest first) split from `stream` (newest first). With `person`, a project’s room keeps only what touches them. A person’s room is the person with their state line and projects, the open loops that touch them (assigned, blocked on them, mentioning them; Mine is what you owe them, Waiting on what they owe you), the open topics of meetings ahead they attend (`toDiscuss`), and the stream of notes that mention them, their tasks and the meetings they attend. With `project`, a person’s room keeps only that project’s.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    room: RoomArg,
    person: PersonArg.optional().describe(
      'In a project’s room: only what touches this person.',
    ),
    project: ProjectArg.optional().describe(
      'In a person’s room: only this project (a project id or name).',
    ),
    limit: LimitArg.describe(
      `At most this many items in upcoming and in stream (default ${STREAM_ITEMS}).`,
    ),
    today: TodayArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const read = await readSpace(ctx, args.space, args.today);
    const { space, state, today } = read;
    const room = resolveRoom(state, args.room);
    const me = meId(state.people);
    if (room.kind === 'project') {
      if (args.project) {
        throw new ToolError(
          '`project` narrows a person’s room; this room is a project’s (narrow it with `person`).',
        );
      }
      const project = state.projects[room.id] as Project;
      const person = args.person ? resolvePerson(state, args.person) : null;
      const lanes = lanesOf(state, me, projectKeep(project.id, person));
      const open =
        lanes.mine.length + waitingCount(lanes) + lanes.decide.length;
      return {
        space,
        today,
        kind: 'project' as const,
        ...projectPage(state, project, today),
        stateLine: projectStateLine(project, open, today, (d) => d).join(' · '),
        narrowedTo: personRef(state, person),
        people: roomPeople(state, project.id).map((p) => ({
          id: p.id,
          name: p.name,
        })),
        lanes: lanesOut(state, lanes),
        ...streamOut(
          state,
          projectStream(state, project.id, person),
          read,
          args.limit,
        ),
      };
    }
    if (args.person) {
      throw new ToolError(
        '`person` narrows a project’s room; this room is a person’s (narrow it with `project`).',
      );
    }
    const person = state.people[room.id];
    if (!person) throw new ToolError('That person is gone.');
    const project =
      args.project === undefined ? null : resolveProject(state, args.project);
    const lanes = personLanes(state, me, person.id, project);
    const open = lanes.mine.length + waitingCount(lanes) + lanes.decide.length;
    const projects = personProjects(state, person.id);
    return {
      space,
      today,
      kind: 'person' as const,
      person: {
        id: person.id,
        name: person.name,
        role: person.role,
        me: person.me,
      },
      stateLine: personStateLine(person, projects.length, open).join(' · '),
      narrowedTo: projectRef(state, project),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      lanes: lanesOut(state, lanes),
      toDiscuss: cap(
        personTopics(state, person.id, today, read.now, project).map(
          ({ meeting, topic }) => ({
            meeting: {
              id: meeting.id,
              title: meeting.title,
              date: meeting.date,
            },
            topic: { id: topic.id, title: topic.title },
          }),
        ),
      ),
      ...streamOut(
        state,
        personStream(state, person.id, project),
        read,
        args.limit,
      ),
    };
  },
});
