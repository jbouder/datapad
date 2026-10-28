import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import { orgByName } from '#shared/orgs';
import {
  milestonesOf,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
} from '#shared/types';
import {
  defineTool,
  SpaceArg,
  ToolError,
  WRITE,
  WRITE_IDEMPOTENT,
} from '../tool';
import { PersonArg, readSpace, TodayArg } from './read';
import {
  DayOrNoneText,
  DayText,
  day,
  docId,
  MarkdownArg,
  projectOut,
  RequestIdArg,
  requiredDay,
  resolvePeople,
  resolveRealProject,
  TagsArg,
  TitleArg,
  tokens,
  type Written,
  write,
} from './write';

const RealProjectArg = z
  .string()
  .min(1)
  .max(200)
  .describe('A project id or name (ignoring case, or a unique part of it).');

/** A project after a write, and what the write logged. */
function projectResult(space: string, written: Written, id: string) {
  const p = written.state.projects[id];
  if (!p) throw new ToolError('That project is gone.');
  return {
    space,
    project: projectOut(written.state, p),
    activity: written.activity,
  };
}

export const createProject = defineTool({
  name: 'create_project',
  title: 'Create a project',
  description:
    'Create a project, active by default. `org` names an Org record when one matches (ignoring case), else it is kept as text. Logs "Created project".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    name: z.string().trim().min(1).max(LIMITS.nameMax),
    org: z.string().trim().max(LIMITS.nameMax).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    health: z.enum(PROJECT_HEALTHS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    startDate: DayOrNoneText.optional(),
    targetDate: DayOrNoneText.optional(),
    desc: MarkdownArg.optional(),
    tags: TagsArg.optional(),
    members: z
      .array(PersonArg)
      .max(LIMITS.peopleMax)
      .optional()
      .describe('People by id or name.'),
    today: TodayArg,
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const org = args.org ? orgByName(state.orgs, args.org) : undefined;
    const id = await docId(args.requestId);
    const written = await write(
      ctx,
      space,
      [
        {
          type: 'createProject',
          id,
          name: args.name,
          ...(org
            ? { org: org.name, orgId: org.id }
            : args.org
              ? { org: args.org }
              : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.health ? { health: args.health } : {}),
          ...(args.priority ? { priority: args.priority } : {}),
          ...(args.startDate !== undefined
            ? { startDate: day(args.startDate, today, 'a start date') }
            : {}),
          ...(args.targetDate !== undefined
            ? { targetDate: day(args.targetDate, today, 'a target date') }
            : {}),
          ...(args.desc !== undefined
            ? { desc: tokens(state, args.desc) }
            : {}),
          ...(args.tags ? { tags: args.tags } : {}),
          ...(args.members
            ? { members: resolvePeople(state, args.members) }
            : {}),
        },
      ],
      args.requestId,
    );
    return projectResult(space, written, id);
  },
});

export const setProjectStatus = defineTool({
  name: 'set_project_status',
  title: 'Set a project’s status',
  description:
    'Set a project active, paused or done. Logs "Status changed to …". (Archiving is not available here.)',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    project: RealProjectArg,
    status: z.enum(PROJECT_STATUSES),
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const p = resolveRealProject(state, args.project);
    const written = await write(
      ctx,
      space,
      [{ type: 'setStatus', id: p.id, status: args.status }],
      args.requestId,
    );
    return projectResult(space, written, p.id);
  },
});

export const setProjectHealth = defineTool({
  name: 'set_project_health',
  title: 'Set a project’s health',
  description:
    'Judge a project green, yellow or red, or "none" for not judged. Logs "Health set to …".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    project: RealProjectArg,
    health: z.enum(PROJECT_HEALTHS),
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const p = resolveRealProject(state, args.project);
    const written = await write(
      ctx,
      space,
      [{ type: 'setHealth', id: p.id, health: args.health }],
      args.requestId,
    );
    return projectResult(space, written, p.id);
  },
});

export const addMilestone = defineTool({
  name: 'add_milestone',
  title: 'Add a milestone',
  description: `A dated marker on a project (a launch, a review, a handover; ${LIMITS.milestonesMax} per project at most). Its deadline is the project's target date, not a milestone. Logs "Added milestone …".`,
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    project: RealProjectArg,
    title: TitleArg,
    date: DayText,
    today: TodayArg,
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const p = resolveRealProject(state, args.project);
    const id = await docId(args.requestId);
    const written = await write(
      ctx,
      space,
      [
        {
          type: 'addMilestone',
          projectId: p.id,
          id,
          title: args.title,
          date: requiredDay(args.date, today, 'The milestone'),
        },
      ],
      args.requestId,
    );
    const result = projectResult(space, written, p.id);
    const milestone = milestonesOf(written.state.projects[p.id] ?? p).find(
      (m) => m.id === id,
    );
    return { ...result, milestone };
  },
});
