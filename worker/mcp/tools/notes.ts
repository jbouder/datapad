import { z } from 'zod';
import { selectMeetings } from '#shared/meetings';
import { selectNotes } from '#shared/notes';
import { notesOfMeeting, tasksOfMeeting } from '#shared/select';
import { defineTool, READ_ONLY, SpaceArg, ToolError } from '../tool';
import {
  cap,
  DayArg,
  LimitArg,
  MeetingArg,
  meetingOut,
  noteOut,
  ProjectArg,
  readSpace,
  resolveMeeting,
  resolveProject,
} from './read';

/** Notes and meetings (#153), selected as the Notes and Meetings pages do. */

const DEFAULT_NOTES = 50;

export const listNotes = defineTool({
  name: 'list_notes',
  title: 'List notes',
  description:
    'Notes as the Notes page selects them, newest first, mentions as @Name. Without a project, notes of archived projects are left out. Filter by project, meeting, pinned, or text (every word must match). 50 by default.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    project: ProjectArg.optional(),
    meeting: MeetingArg.optional().describe(
      'A meeting id or title: only its notes.',
    ),
    pinned: z.boolean().optional(),
    query: z.string().max(200).optional(),
    limit: LimitArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    let project =
      args.project === undefined ? '' : resolveProject(state, args.project);
    const meeting = args.meeting
      ? resolveMeeting(state, args.meeting)
      : undefined;
    if (meeting) {
      // Its notes are in its project, archived or not.
      project = state.meetings[meeting]?.projectId ?? null;
    }
    const selected = selectNotes(state, {
      project: project === null ? 'general' : project,
      pinned: args.pinned ?? false,
      q: args.query ?? '',
    });
    const rows = meeting
      ? selected.filter((n) => n.meetingId === meeting)
      : selected;
    return {
      space,
      notes: cap(
        rows.map((n) => noteOut(state, n)),
        args.limit ?? DEFAULT_NOTES,
      ),
    };
  },
});

export const listMeetings = defineTool({
  name: 'list_meetings',
  title: 'List meetings',
  description:
    'Meetings soonest first, with attendees, topics (covered or not, with outcomes) and counts of their notes and open action items. Filter by project and by a from/to date range (inclusive). Archived projects’ meetings are included, as on the Meetings page.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    project: ProjectArg.optional(),
    from: DayArg.optional().describe('First day, YYYY-MM-DD.'),
    to: DayArg.optional().describe('Last day, YYYY-MM-DD.'),
    limit: LimitArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    if (args.from && args.to && args.from > args.to) {
      throw new ToolError('"from" is after "to".');
    }
    const { space, state } = await readSpace(ctx, args.space);
    const project =
      args.project === undefined ? '' : resolveProject(state, args.project);
    const rows = selectMeetings(state.meetings, {
      project: project === null ? 'general' : project,
    }).filter(
      (m) =>
        (!args.from || m.date >= args.from) && (!args.to || m.date <= args.to),
    );
    return {
      space,
      meetings: cap(
        rows.map((m) => {
          const items = tasksOfMeeting(state.tasks, m.id);
          return {
            ...meetingOut(state, m),
            notes: notesOfMeeting(state.notes, m.id).length,
            actionItems: { open: items.open.length, done: items.done.length },
          };
        }),
        args.limit,
      ),
    };
  },
});
