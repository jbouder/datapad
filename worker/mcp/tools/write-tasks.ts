import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import type { BaseOp } from '#shared/protocol';
import { PRIORITIES, type Task } from '#shared/types';
import {
  defineTool,
  SpaceArg,
  ToolError,
  WRITE,
  WRITE_IDEMPOTENT,
} from '../tool';
import {
  MeetingArg,
  PersonArg,
  ProjectArg,
  readSpace,
  resolveMeeting,
  resolvePerson,
  resolveProject,
  TodayArg,
  taskOut,
} from './read';
import {
  AssigneeArg,
  DayOrNoneText,
  day,
  MarkdownArg,
  newId,
  resolveAssignee,
  resolveTask,
  TagsArg,
  TaskArg,
  TitleArg,
  tokens,
  type Written,
  write,
} from './write';

/** The task after a write, and what the write logged. */
function taskResult(space: string, written: Written, id: string) {
  const task = written.state.tasks[id];
  if (!task) throw new ToolError('That task is gone.');
  return {
    space,
    task: taskOut(written.state, task),
    activity: written.activity,
  };
}

export const addTask = defineTool({
  name: 'add_task',
  title: 'Add a task',
  description:
    'Add an open task to a project, or to General (no project). With `meeting` it is an action item of that meeting and goes in the meeting’s project. Logs "Added task …" (or "Added action item …") in the project’s activity.',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    title: TitleArg,
    project: ProjectArg.optional().describe(
      'A project id or name, or "general" (the default) for no project.',
    ),
    meeting: MeetingArg.optional().describe(
      'A meeting id or title: the task is its action item, in its project (`project` is then ignored).',
    ),
    assignee: AssigneeArg.optional(),
    due: DayOrNoneText.optional(),
    priority: z.enum(PRIORITIES).optional().describe('Defaults to "none".'),
    desc: MarkdownArg.optional(),
    tags: TagsArg.optional(),
    today: TodayArg,
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const meetingId = args.meeting ? resolveMeeting(state, args.meeting) : null;
    const projectId = meetingId
      ? (state.meetings[meetingId]?.projectId ?? null)
      : args.project === undefined
        ? null
        : resolveProject(state, args.project);
    const id = newId();
    const written = await write(ctx, space, [
      {
        type: 'addTask',
        id,
        projectId,
        title: args.title,
        ...(args.priority ? { priority: args.priority } : {}),
        ...(args.due !== undefined
          ? { due: day(args.due, today, 'a due date') }
          : {}),
        ...(args.desc !== undefined ? { desc: tokens(state, args.desc) } : {}),
        ...(args.tags ? { tags: args.tags } : {}),
        ...(args.assignee !== undefined
          ? { assignee: resolveAssignee(state, args.assignee) }
          : {}),
        ...(meetingId ? { meetingId } : {}),
      },
    ]);
    return taskResult(space, written, id);
  },
});

function toggleTool(done: boolean) {
  return defineTool({
    name: done ? 'complete_task' : 'reopen_task',
    title: done ? 'Complete a task' : 'Reopen a task',
    description: done
      ? 'Close a task (mark it done). Closing one already done changes nothing. Logs "Closed …".'
      : 'Reopen a done task. Reopening one already open changes nothing. Logs "Reopened …".',
    scope: 'write',
    input: z.object({ space: SpaceArg, task: TaskArg }),
    annotations: WRITE_IDEMPOTENT,
    async run(args, ctx) {
      const { space, state } = await readSpace(ctx, args.space);
      const task = resolveTask(state, args.task);
      const written = await write(ctx, space, [
        { type: 'toggleTask', id: task.id, done },
      ]);
      return taskResult(space, written, task.id);
    },
  });
}

export const completeTask = toggleTool(true);
export const reopenTask = toggleTool(false);

export const editTask = defineTool({
  name: 'edit_task',
  title: 'Edit a task',
  description:
    'Change a task’s title, due date, priority, assignee, details or tags; only the fields given change (`tags` replaces the list). Logs "Edited task …". To close or reopen it use complete_task or reopen_task; to mark it waiting use set_blocked.',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    task: TaskArg,
    title: TitleArg.optional(),
    due: DayOrNoneText.optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignee: AssigneeArg.optional(),
    desc: MarkdownArg.optional().describe(
      'Replaces the details. Markdown; mentions as @Name.',
    ),
    tags: TagsArg.optional(),
    today: TodayArg,
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const task = resolveTask(state, args.task);
    const patch: Partial<
      Pick<Task, 'title' | 'due' | 'priority' | 'assignee' | 'desc' | 'tags'>
    > = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.due !== undefined
        ? { due: day(args.due, today, 'a due date') }
        : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      ...(args.assignee !== undefined
        ? { assignee: resolveAssignee(state, args.assignee) }
        : {}),
      ...(args.desc !== undefined ? { desc: tokens(state, args.desc) } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
    };
    if (Object.keys(patch).length === 0) {
      throw new ToolError(
        'Nothing to change: give a title, due, priority, assignee, desc or tags.',
      );
    }
    const op: BaseOp = { type: 'editTask', id: task.id, patch };
    const written = await write(ctx, space, [op]);
    return taskResult(space, written, task.id);
  },
});

export const setBlocked = defineTool({
  name: 'set_blocked',
  title: 'Mark a task waiting, or not',
  description:
    'Mark a task as waiting on someone (or on something, with no person), with a one-line note of what it waits for; or, with blocked: false, no longer waiting. Logs "Blocked … on <name>" or "Unblocked …".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    task: TaskArg,
    blocked: z
      .boolean()
      .optional()
      .describe('false: no longer waiting. Defaults to true.'),
    on: PersonArg.optional().describe(
      'Who it waits on: a person id or name. Leave out for "waiting, not on anyone listed".',
    ),
    note: z
      .string()
      .trim()
      .max(LIMITS.blockedNoteMax)
      .optional()
      .describe('One line: what it waits for.'),
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const task = resolveTask(state, args.task);
    const blocked =
      args.blocked === false
        ? null
        : {
            on: args.on ? resolvePerson(state, args.on) : null,
            note: args.note ?? '',
          };
    const written = await write(ctx, space, [
      { type: 'setBlocked', id: task.id, blocked },
    ]);
    return taskResult(space, written, task.id);
  },
});
