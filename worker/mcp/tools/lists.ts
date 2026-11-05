import { z } from 'zod';
import { LIST_STATES, selectLists } from '#shared/lists';
import { defineTool, READ_ONLY, SpaceArg } from '../tool';
import {
  cap,
  LimitArg,
  ListArg,
  listOut,
  listRow,
  ProjectArg,
  readSpace,
  resolveList,
  resolveProject,
} from './read';

/** Lists (#302): titled checklists, selected as `shared/lists` does. */

export const listLists = defineTool({
  name: 'list_lists',
  title: 'List lists',
  description:
    'Lists (titled checklists), most recently updated first, each with its project and progress ("3 of 8") but not its items; get_list reads one in full. Filter by project, by state (in-progress: not every item done, empty lists included; done: every item done) or by text (every word in the title or an item).',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    project: ProjectArg.optional(),
    state: z.enum(LIST_STATES).optional().describe('Defaults to "all".'),
    query: z.string().max(200).optional(),
    limit: LimitArg,
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const projectId =
      args.project === undefined
        ? undefined
        : resolveProject(state, args.project);
    const rows = selectLists(state.lists, {
      projectId,
      state: args.state ?? 'all',
      q: args.query ?? '',
    });
    return {
      space,
      lists: cap(
        rows.map((l) => listRow(state, l)),
        args.limit,
      ),
    };
  },
});

export const getList = defineTool({
  name: 'get_list',
  title: 'Get a list',
  description:
    'One list in full: its title, project, progress and every item in the order the owner chose, each done or not.',
  scope: 'read',
  input: z.object({ space: SpaceArg, list: ListArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    return { space, list: listOut(state, resolveList(state, args.list)) };
  },
});
