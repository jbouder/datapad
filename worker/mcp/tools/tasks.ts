import { z } from 'zod';
import {
  type AssigneeFilter,
  agenda,
  attention,
  attentionLine,
  focusBuckets,
  followUps,
  meId,
  prepLine,
  prepOf,
  waitingOn,
} from '#shared/select';
import {
  DEFAULT_TASK_FILTERS,
  DUE_BUCKETS,
  type DueBucket,
  dueBucket,
  selectTasks,
  TASK_SORTS,
} from '#shared/tasks';
import { healthOf, type Snapshot } from '#shared/types';
import { defineTool, READ_ONLY, SpaceArg, ToolError } from '../tool';
import {
  cap,
  LimitArg,
  MeetingArg,
  meetingOut,
  PersonArg,
  ProjectArg,
  personRef,
  projectRef,
  readSpace,
  resolveMeeting,
  resolvePerson,
  resolveProject,
  TodayArg,
  taskOut,
} from './read';

/** Focus's buckets, in its order (`DUE_BUCKETS`). */
const DUE_IDS = DUE_BUCKETS.map((b) => b.id) as [DueBucket, ...DueBucket[]];

const AssigneeArg = PersonArg.describe(
  'A person id or name (ignoring case), "me" for the person marked as you, or "unassigned".',
);

/** The assignee filter Focus and Tasks use, from an id, a name or a word. */
function assigneeFilter(
  state: Snapshot,
  asked: string | undefined,
): AssigneeFilter {
  if (!asked) return { kind: 'anyone' };
  const word = asked.trim().toLowerCase();
  if (word === 'unassigned') return { kind: 'unassigned' };
  if (word === 'me' || word === 'mine') {
    if (!meId(state.people)) {
      throw new ToolError(
        'Nobody is marked as you in People, so "me" matches no one. Name the person instead.',
      );
    }
    return { kind: 'mine' };
  }
  return { kind: 'person', id: resolvePerson(state, asked) };
}

export const listTasks = defineTool({
  name: 'list_tasks',
  title: 'List tasks',
  description:
    'Tasks as the Tasks page selects them, soonest due first (undated last). Open tasks by default. Filter by project, assignee, due bucket (overdue, today, week = after today to Sunday, later, none = no date), blocked, a meeting (its action items) or text.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    project: ProjectArg.optional(),
    status: z
      .enum(['open', 'done', 'all'])
      .optional()
      .describe('Defaults to "open".'),
    assignee: AssigneeArg.optional(),
    due: z.enum(DUE_IDS).optional(),
    blocked: z
      .boolean()
      .optional()
      .describe('true: only tasks waiting on someone.'),
    meeting: MeetingArg.optional().describe(
      'A meeting id or title: only its action items.',
    ),
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Text in the title, details or tags.'),
    sort: z.enum(TASK_SORTS).optional().describe('Defaults to "due".'),
    limit: LimitArg,
    today: TodayArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const project =
      args.project === undefined
        ? undefined
        : resolveProject(state, args.project);
    const meeting = args.meeting
      ? resolveMeeting(state, args.meeting)
      : undefined;
    const [all] = selectTasks(
      state,
      {
        ...DEFAULT_TASK_FILTERS,
        status: args.status ?? 'open',
        group: 'none',
        who: assigneeFilter(state, args.assignee),
        q: args.query ?? '',
        blocked: args.blocked ?? false,
        sort: args.sort ?? 'due',
      },
      today,
      meId(state.people),
    );
    const rows = (all?.rows ?? []).filter(
      (t) =>
        (project === undefined || t.projectId === project) &&
        (meeting === undefined || t.meetingId === meeting) &&
        (args.due === undefined || dueBucket(t, today) === args.due),
    );
    return {
      space,
      today,
      tasks: cap(
        rows.map((t) => ({
          ...taskOut(state, t),
          dueBucket: dueBucket(t, today),
        })),
        args.limit,
      ),
    };
  },
});

export const getFocus = defineTool({
  name: 'get_focus',
  title: 'Focus',
  description:
    "The Focus page for a day: open tasks outside the archive by when they are due (overdue, today, this week; later and undated as counts), what is waiting on whom, open action items from the last week's meetings, active projects that need attention, and the seven-day agenda of meetings and milestones.",
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    assignee: AssigneeArg.optional(),
    today: TodayArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const me = meId(state.people);
    const who = assigneeFilter(state, args.assignee);
    const buckets = focusBuckets(state.tasks, state.projects, today, me, who);
    const tasks = (list: typeof buckets.today) =>
      cap(list.map((t) => taskOut(state, t)));
    return {
      space,
      today,
      due: {
        overdue: tasks(buckets.overdue),
        today: tasks(buckets.today),
        thisWeek: tasks(buckets.thisWeek),
        later: buckets.later.length,
        noDate: buckets.noDate.length,
      },
      waitingOn: waitingOn(
        state.tasks,
        state.projects,
        state.people,
        me,
        who,
      ).map((g) => ({
        person: g.person ? { id: g.person.id, name: g.person.name } : null,
        since: g.since,
        tasks: tasks(g.tasks),
      })),
      followUps: followUps(
        state.meetings,
        state.tasks,
        state.projects,
        today,
        me,
        who,
      ).map((f) => ({
        meeting: {
          id: f.meeting.id,
          title: f.meeting.title,
          date: f.meeting.date,
          project: projectRef(state, f.meeting.projectId),
        },
        tasks: tasks(f.tasks),
      })),
      attention: attention(state.projects, today).map((a) => ({
        project: { id: a.project.id, name: a.project.name },
        health: healthOf(a.project),
        targetDate: a.project.targetDate,
        reasons: attentionLine(a.reasons),
      })),
      agenda: cap(
        agenda(state.meetings, state.projects, today).map((item) =>
          item.kind === 'meeting'
            ? {
                kind: 'meeting' as const,
                ...meetingOut(state, item.meeting),
                prep: prepLine(prepOf(item.meeting, state), today),
              }
            : {
                kind: 'milestone' as const,
                date: item.date,
                id: item.milestone.id,
                title: item.milestone.title,
                project: { id: item.project.id, name: item.project.name },
              },
        ),
      ),
      me: personRef(state, me),
    };
  },
});
