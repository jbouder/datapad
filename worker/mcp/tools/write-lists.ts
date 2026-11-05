import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import type { List, ListItem } from '#shared/types';
import {
  defineTool,
  SpaceArg,
  ToolError,
  WRITE,
  WRITE_IDEMPOTENT,
} from '../tool';
import {
  ListArg,
  listOut,
  ProjectArg,
  readSpace,
  resolveByName,
  resolveList,
  resolveProject,
} from './read';
import { docId, RequestIdArg, TitleArg, type Written, write } from './write';

/**
 * Lists (#302): add a list, add an item, check one off. Never an edit, a
 * delete or a reorder: those stay in the app (`MCP_OP_TYPES`).
 */

/** A list after a write, and what the write logged. */
function listResult(space: string, written: Written, id: string) {
  const l = written.state.lists[id];
  if (!l) throw new ToolError('That list is gone.');
  return {
    space,
    list: listOut(written.state, l),
    activity: written.activity,
  };
}

/** An item once the write has landed. */
function itemOf(written: Written, listId: string, itemId: string): ListItem {
  const i = written.state.lists[listId]?.items.find((x) => x.id === itemId);
  if (!i) throw new ToolError('That item is gone.');
  return i;
}

/** An item of a list by id, or its text (ignoring case, or a unique part). */
function resolveItem(list: List, asked: string): ListItem {
  const byId = Object.fromEntries(list.items.map((i) => [i.id, i]));
  return resolveByName(byId, asked, 'item', (i) => i.text);
}

export const addList = defineTool({
  name: 'add_list',
  title: 'Add a list',
  description:
    'Start a list (a titled checklist of one-line items) in a project or General. Add its items with add_list_item. Logs "Added the list …".',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    title: TitleArg,
    project: ProjectArg.optional().describe(
      'A project id or name, or "general" (the default).',
    ),
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const projectId =
      args.project === undefined ? null : resolveProject(state, args.project);
    const id = await docId(args.requestId);
    const written = await write(
      ctx,
      space,
      [{ type: 'addList', id, title: args.title, projectId }],
      args.requestId,
    );
    return listResult(space, written, id);
  },
});

export const addListItem = defineTool({
  name: 'add_list_item',
  title: 'Add an item to a list',
  description: `Add one line to the end of a list (${LIMITS.listItemsMax} items at most). Silent in the activity log, as in the app.`,
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    list: ListArg,
    text: TitleArg.describe('The item: one line.'),
  }),
  annotations: WRITE,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const listId = resolveList(state, args.list).id;
    const id = await docId(args.requestId);
    const written = await write(
      ctx,
      space,
      [{ type: 'addListItem', listId, id, text: args.text }],
      args.requestId,
    );
    return {
      ...listResult(space, written, listId),
      item: itemOf(written, listId, id),
    };
  },
});

export const checkListItem = defineTool({
  name: 'check_list_item',
  title: 'Check off a list item',
  description:
    'Mark an item of a list done (or, with done: false, not done). Silent in the activity log, as in the app.',
  scope: 'write',
  input: z.object({
    space: SpaceArg,
    requestId: RequestIdArg,
    list: ListArg,
    item: z
      .string()
      .min(1)
      .max(LIMITS.titleMax)
      .describe(
        'The item’s id, or its text (ignoring case, or a unique part of it) in that list.',
      ),
    done: z.boolean().optional().describe('Defaults to true.'),
  }),
  annotations: WRITE_IDEMPOTENT,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const list = resolveList(state, args.list);
    const item = resolveItem(list, args.item);
    const written = await write(
      ctx,
      space,
      [
        {
          type: 'setListItemDone',
          listId: list.id,
          id: item.id,
          done: args.done ?? true,
        },
      ],
      args.requestId,
    );
    return {
      ...listResult(space, written, list.id),
      item: itemOf(written, list.id, item.id),
    };
  },
});
