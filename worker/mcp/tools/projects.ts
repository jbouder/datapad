import { z } from 'zod';
import { projectMeetings } from '#shared/meetings';
import { byDate, nextMilestone } from '#shared/milestones';
import { projectNotes } from '#shared/notes';
import { orgProjects } from '#shared/orgs';
import { PROJECT_SORTS, selectProjects } from '#shared/projects';
import {
  activeProjects,
  GENERAL_KEY,
  movementLine,
  openCounts,
  weekMovement,
} from '#shared/select';
import { spaceCounts } from '#shared/spaces';
import {
  blockedOf,
  type DateString,
  GENERAL,
  healthOf,
  milestonesOf,
  PROJECT_STATUSES,
  type Project,
  type Snapshot,
} from '#shared/types';
import { defineTool, READ_ONLY, SpaceArg } from '../tool';
import {
  cap,
  meetingOut,
  noteOut,
  ProjectArg,
  peopleRefs,
  projectOrg,
  readSpace,
  resolveOrg,
  resolveProject,
  TodayArg,
  taskOut,
  text,
} from './read';

/** Open tasks waiting on someone, per project id (General under ''). */
function blockedCounts(state: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of Object.values(state.tasks)) {
    if (t.status !== 'open' || !blockedOf(t)) continue;
    const k = t.projectId ?? GENERAL_KEY;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * The projects of an org: its record's (`orgProjects`, by link or name),
 * or, when no record matches, those whose org text is the name.
 */
function orgProjectIds(state: Snapshot, asked: string): string[] {
  try {
    const id = resolveOrg(state, asked);
    return (orgProjects(state.projects, state.orgs).get(id) ?? []).map(
      (p) => p.id,
    );
  } catch (error) {
    const k = asked.trim().toLowerCase();
    const named = Object.values(state.projects).filter(
      (p) => p.org.trim().toLowerCase() === k,
    );
    if (named.length === 0) throw error;
    return named.map((p) => p.id);
  }
}

/** A project as a row: what its card on Projects shows. */
function projectRow(
  state: Snapshot,
  p: Project,
  today: DateString,
  open: Map<string, number>,
  blocked: Map<string, number>,
) {
  const next = nextMilestone(p, today);
  return {
    id: p.id,
    name: p.name,
    org: projectOrg(state, p.id),
    status: p.status,
    health: healthOf(p),
    priority: p.priority,
    startDate: p.startDate ?? '',
    targetDate: p.targetDate,
    tags: p.tags,
    archived: p.archived,
    nextMilestone: next ? { title: next.title, date: next.date } : null,
    openTasks: open.get(p.id) ?? 0,
    blockedTasks: blocked.get(p.id) ?? 0,
    updatedAt: p.updatedAt,
  };
}

export const getOverview = defineTool({
  name: 'get_overview',
  title: 'Overview',
  description:
    "A space at a glance: its counts, the week's movement, and every project outside the archive (most recently updated first) with status, health, next milestone, and open and blocked task counts. Start here after list_spaces.",
  scope: 'read',
  input: z.object({ space: SpaceArg, today: TodayArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const open = openCounts(state.tasks);
    const blocked = blockedCounts(state);
    const week = weekMovement(state.tasks, state.projects, today);
    return {
      space,
      today,
      counts: spaceCounts(state),
      week: { ...week, line: movementLine(week) },
      general: {
        openTasks: open.get(GENERAL_KEY) ?? 0,
        blockedTasks: blocked.get(GENERAL_KEY) ?? 0,
      },
      projects: cap(
        activeProjects(state.projects).map((p) =>
          projectRow(state, p, today, open, blocked),
        ),
      ),
    };
  },
});

export const listProjects = defineTool({
  name: 'list_projects',
  title: 'List projects',
  description:
    'Projects as the Projects page lists them: by default those not archived, of every status, most recently updated first. Filter by status, health or org; archived: true lists the archive instead.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    status: z
      .enum([...PROJECT_STATUSES, 'all'])
      .optional()
      .describe('Defaults to "all".'),
    health: z.enum(['green', 'yellow', 'red']).optional(),
    org: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('An org id or name (ignoring case).'),
    archived: z
      .boolean()
      .optional()
      .describe('true: the archived projects (other filters ignored).'),
    sort: z.enum(PROJECT_SORTS).optional().describe('Defaults to "updated".'),
    today: TodayArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    let rows = selectProjects(
      state.projects,
      {
        status: args.status ?? 'all',
        health: args.health ?? '',
        org: '',
        sort: args.sort ?? 'updated',
      },
      args.archived ?? false,
      today,
    );
    if (args.org) {
      const ids = new Set(orgProjectIds(state, args.org));
      rows = rows.filter((p) => ids.has(p.id));
    }
    const open = openCounts(state.tasks);
    const blocked = blockedCounts(state);
    return {
      space,
      projects: cap(
        rows.map((p) => projectRow(state, p, today, open, blocked)),
      ),
    };
  },
});

const RECENT_NOTES = 10;
const MEETINGS_EACH_WAY = 5;
const ACTIVITY_LINES = 25;

export const getProject = defineTool({
  name: 'get_project',
  title: 'Get a project',
  description:
    'One project in full, as its page shows it: details, members, links and milestones; its open tasks in order; its recent notes (pinned first); its upcoming and recent meetings with topics; and the last 25 lines of its activity.',
  scope: 'read',
  input: z.object({ space: SpaceArg, project: ProjectArg, today: TodayArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.today,
    );
    const id = resolveProject(state, args.project);
    if (id === null) {
      return generalPage(space, state, today);
    }
    const p = state.projects[id] as Project;
    const tasks = Object.values(state.tasks).filter((t) => t.projectId === id);
    const open = tasks
      .filter((t) => t.status === 'open')
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    const meetings = projectMeetings(state.meetings, id);
    return {
      space,
      today,
      project: {
        id: p.id,
        name: p.name,
        org: projectOrg(state, p.id),
        status: p.status,
        health: healthOf(p),
        priority: p.priority,
        startDate: p.startDate ?? '',
        targetDate: p.targetDate,
        tags: p.tags,
        archived: p.archived,
        desc: text(state, p.desc),
        members: peopleRefs(state, p.members),
        links: p.links,
        milestones: [...milestonesOf(p)].sort(byDate),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
      tasks: {
        open: open.length,
        done: tasks.length - open.length,
        blocked: open.filter((t) => blockedOf(t)).length,
      },
      openTasks: cap(open.map((t) => taskOut(state, t))),
      recentNotes: cap(
        projectNotes(state.notes, id).map((n) => noteOut(state, n)),
        RECENT_NOTES,
      ),
      upcomingMeetings: cap(
        meetings
          .filter((m) => m.date >= today)
          .map((m) => meetingOut(state, m)),
        MEETINGS_EACH_WAY,
      ),
      recentMeetings: cap(
        meetings
          .filter((m) => m.date < today)
          .reverse()
          .map((m) => meetingOut(state, m)),
        MEETINGS_EACH_WAY,
      ),
      activity: cap(state.activity[id]?.events ?? [], ACTIVITY_LINES),
    };
  },
});

/** General's page: what belongs to no project. */
function generalPage(space: string, state: Snapshot, today: DateString) {
  const open = Object.values(state.tasks)
    .filter((t) => t.projectId === null && t.status === 'open')
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const meetings = projectMeetings(state.meetings, null);
  return {
    space,
    today,
    project: { id: GENERAL, name: 'General' },
    openTasks: cap(open.map((t) => taskOut(state, t))),
    recentNotes: cap(
      projectNotes(state.notes, null).map((n) => noteOut(state, n)),
      RECENT_NOTES,
    ),
    upcomingMeetings: cap(
      meetings.filter((m) => m.date >= today).map((m) => meetingOut(state, m)),
      MEETINGS_EACH_WAY,
    ),
    recentMeetings: cap(
      meetings
        .filter((m) => m.date < today)
        .reverse()
        .map((m) => meetingOut(state, m)),
      MEETINGS_EACH_WAY,
    ),
    activity: cap(state.activity[GENERAL]?.events ?? [], ACTIVITY_LINES),
  };
}
