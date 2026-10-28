import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import { topicsOf } from '#shared/types';
import {
  defineTool,
  SpaceArg,
  ToolError,
  WRITE,
  WRITE_IDEMPOTENT,
} from '../tool';
import {
  MeetingArg,
  meetingOut,
  noteOut,
  PersonArg,
  ProjectArg,
  readSpace,
  resolveMeeting,
  resolveProject,
  TodayArg,
} from './read';
import {
  DayText,
  MarkdownArg,
  newId,
  requiredDay,
  resolvePeople,
  resolveTask,
  resolveTopic,
  TaskArg,
  TitleArg,
  tokens,
  topicOf,
  type Written,
  write,
} from './write';

const TimeArg = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A 24-hour time like 14:30')
  .describe('HH:MM, 24-hour, in the owner’s day.');

/** A meeting after a write, and what the write logged. */
function meetingResult(space: string, written: Written, id: string) {
  const m = written.state.meetings[id];
  if (!m) throw new ToolError('That meeting is gone.');
  return {
    space,
    meeting: meetingOut(written.state, m),
    activity: written.activity,
  };
}

export const addNote = defineTool({
  name: 'add_note',
  title: 'Write a note',
  description:
    'Write a Markdown note in a project or General. With `meeting` it is a note on that meeting (in its project); with `task`, a running note on that task (in its project). Not both. Mentions as @Name become links to the person. Logs "Added a note" (or "Added a note to …").',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    body: z
      .string()
      .trim()
      .min(1)
      .max(LIMITS.bodyMax)
      .describe(MarkdownArg.description ?? ''),
    project: ProjectArg.optional().describe(
      'A project id or name, or "general" (the default). Ignored with `meeting` or `task`.',
    ),
    meeting: MeetingArg.optional(),
    task: TaskArg.optional(),
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    if (args.meeting && args.task) {
      throw new ToolError('A note goes on a meeting or a task, not both.');
    }
    const meetingId = args.meeting ? resolveMeeting(state, args.meeting) : null;
    const task = args.task ? resolveTask(state, args.task) : null;
    const projectId = meetingId
      ? (state.meetings[meetingId]?.projectId ?? null)
      : task
        ? task.projectId
        : args.project === undefined
          ? null
          : resolveProject(state, args.project);
    const id = newId();
    const written = await write(ctx, space, [
      {
        type: 'addNote',
        id,
        projectId,
        body: tokens(state, args.body),
        ...(meetingId ? { meetingId } : {}),
        ...(task ? { taskId: task.id } : {}),
      },
    ]);
    const note = written.state.notes[id];
    if (!note) throw new ToolError('That note is gone.');
    return {
      space,
      note: noteOut(written.state, note),
      activity: written.activity,
    };
  },
});

export const addMeeting = defineTool({
  name: 'add_meeting',
  title: 'Add a meeting',
  description:
    'Add a meeting on a day, in a project or General, with optional times, attendees, a link and a short agenda note. Add its topics with add_topic. Logs "Added meeting …".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    title: TitleArg,
    date: DayText,
    time: TimeArg.optional().describe('Start, HH:MM 24-hour.'),
    end: TimeArg.optional().describe('End, HH:MM 24-hour.'),
    project: ProjectArg.optional().describe(
      'A project id or name, or "general" (the default).',
    ),
    attendees: z
      .array(PersonArg)
      .max(LIMITS.peopleMax)
      .optional()
      .describe('People by id or name.'),
    link: z.string().trim().max(LIMITS.urlMax).optional(),
    note: z
      .string()
      .max(LIMITS.meetingNoteMax)
      .optional()
      .describe('Short agenda or context, plain text.'),
    today: TodayArg,
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const projectId =
      args.project === undefined ? null : resolveProject(state, args.project);
    if (args.time && args.end && args.end < args.time) {
      throw new ToolError('The meeting ends before it starts.');
    }
    const id = newId();
    const written = await write(ctx, space, [
      {
        type: 'addMeeting',
        id,
        projectId,
        title: args.title,
        date: requiredDay(args.date, today, 'The meeting'),
        ...(args.time ? { time: args.time } : {}),
        ...(args.end ? { end: args.end } : {}),
        ...(args.attendees
          ? { attendees: resolvePeople(state, args.attendees) }
          : {}),
        ...(args.link ? { link: args.link } : {}),
        ...(args.note ? { note: args.note } : {}),
      },
    ]);
    return meetingResult(space, written, id);
  },
});

export const addTopic = defineTool({
  name: 'add_topic',
  title: 'Add a topic to a meeting',
  description:
    'Add a topic (one thing to raise) to the end of a meeting’s agenda. Logs "Added topic … to …".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    meeting: MeetingArg,
    title: TitleArg,
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const meetingId = resolveMeeting(state, args.meeting);
    const id = newId();
    const written = await write(ctx, space, [
      { type: 'addTopic', meetingId, id, title: args.title },
    ]);
    return {
      ...meetingResult(space, written, meetingId),
      topic: topicOf(written.state, meetingId, id),
    };
  },
});

export const coverTopic = defineTool({
  name: 'cover_topic',
  title: 'Cover a meeting topic',
  description:
    'Mark a meeting’s topic covered (or, with done: false, not covered), and optionally record one line on what came of it. Silent in the activity log, as in the app.',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    meeting: MeetingArg,
    topic: z
      .string()
      .min(1)
      .max(LIMITS.titleMax)
      .describe('The topic’s id or title (ignoring case) in that meeting.'),
    done: z.boolean().optional().describe('Defaults to true.'),
    outcome: z
      .string()
      .trim()
      .max(LIMITS.topicOutcomeMax)
      .optional()
      .describe('One line on what came of it; "" clears it.'),
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const meetingId = resolveMeeting(state, args.meeting);
    const m = state.meetings[meetingId];
    const topic = resolveTopic(m ? topicsOf(m) : [], args.topic);
    const ops: BaseOp[] = [
      {
        type: 'toggleTopic',
        meetingId,
        id: topic.id,
        done: args.done ?? true,
      },
    ];
    if (args.outcome !== undefined && args.outcome !== topic.outcome) {
      ops.push({
        type: 'editTopic',
        meetingId,
        id: topic.id,
        patch: { outcome: args.outcome },
      });
    }
    const written = await write(ctx, space, ops);
    return {
      ...meetingResult(space, written, meetingId),
      topic: topicOf(written.state, meetingId, topic.id),
    };
  },
});
