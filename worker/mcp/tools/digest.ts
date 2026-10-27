import { z } from 'zod';
import { addDays } from '#shared/dates';
import { buildDigest, type DigestRange, digestMarkdown } from '#shared/digest';
import { zonedTime } from '#shared/schedule';
import { SEARCH_KINDS, search, searchIndex } from '#shared/search';
import { defineTool, READ_ONLY, SpaceArg } from '../tool';
import { projectRef, readSpace, TodayArg } from './read';

/** The weekly digest and search (#153), from `shared/digest` and `shared/search`. */

/**
 * `weekEnding()`'s range, but in the owner's zone rather than the
 * Worker's (UTC): the seven days ending `lastDay`, from local midnight to
 * local midnight.
 */
export function zonedWeekEnding(
  lastDay: string,
  timeZone: string,
): DigestRange {
  const midnight = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(zonedTime(y, m, d, 0, timeZone)).toISOString();
  };
  const fromDay = addDays(lastDay, -6);
  return {
    from: midnight(fromDay),
    to: midnight(addDays(lastDay, 1)),
    fromDay,
    toDay: lastDay,
  };
}

export const getDigest = defineTool({
  name: 'get_digest',
  title: 'Weekly digest',
  description:
    'The weekly digest for the seven days ending a day (today by default): per project, what closed, what was added, status and health changes, meetings, milestones this week and next, and notes written; with totals and the same Markdown the Digest page copies.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    weekEnding: TodayArg.describe(
      "The last day of the week, YYYY-MM-DD. Defaults to today in the owner's zone.",
    ),
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state, today } = await readSpace(
      ctx,
      args.space,
      args.weekEnding,
    );
    const digest = buildDigest(state, zonedWeekEnding(today, ctx.timeZone));
    return {
      space,
      range: { from: digest.range.fromDay, to: digest.range.toDay },
      totals: digest.totals,
      projects: digest.projects,
      markdown: digestMarkdown(digest),
    };
  },
});

const DEFAULT_PER_KIND = 10;

export const searchTool = defineTool({
  name: 'search',
  title: 'Search',
  description:
    'Search everything as ⌘K does: projects, tasks, notes, meetings (and their topics), orgs, people and whiteboard text. Every word must match; each kind is ranked best first (title starts with the first word, then title contains it, then text; outside the archive first; then most recent). Get the full item with the matching list_ or get_ tool.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    query: z.string().trim().min(1).max(200),
    kinds: z
      .array(z.enum(SEARCH_KINDS))
      .min(1)
      .optional()
      .describe('Only these kinds. Defaults to every kind.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe(`Hits per kind, 1–25. Defaults to ${DEFAULT_PER_KIND}.`),
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const index = searchIndex(
      state.projects,
      state.tasks,
      state.notes,
      state.meetings,
      state.people,
      state.orgs,
      state.boardItems,
    );
    const per = args.limit ?? DEFAULT_PER_KIND;
    // Every match, so the counts are true; each kind is then cut to `per`.
    const results = search(index, args.query, Number.MAX_SAFE_INTEGER);
    const kinds = args.kinds ?? SEARCH_KINDS;
    return {
      space,
      query: args.query,
      counts: Object.fromEntries(
        kinds.map((kind) => [kind, results[kind].length]),
      ),
      truncated: kinds.some((kind) => results[kind].length > per),
      hits: kinds.flatMap((kind) =>
        results[kind].slice(0, per).map(({ entry, snippet }) => ({
          kind,
          id: entry.id,
          title: entry.title,
          snippet,
          project: projectRef(state, entry.projectId),
          archived: entry.archived,
        })),
      ),
    };
  },
});
