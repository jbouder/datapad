import { z } from 'zod';
import type { Scope } from '../oauth';
import {
  defineTool,
  type McpTool,
  READ_ONLY,
  SpaceArg,
  ToolError,
  WRITE,
} from '../tool';

/**
 * The list tools (#302), retired with Lists in v2 (#328, #340): every list
 * became a checklist note. Each stays listed for one release and answers
 * with an error pointing to notes, changing nothing; then it goes. They
 * accept what they used to (unknown arguments are dropped) so an old
 * client gets the pointer, not a schema error.
 */

const POINTER =
  'Lists are retired: every list is now a checklist note, a note with a "- [ ] item" line per item ("- [x]" when done).';

const HOW: Record<string, string> = {
  list_lists:
    'Find checklists with list_notes or search (the words of the title or an item).',
  get_list: 'Read one with list_notes or search.',
  add_list:
    'Start one with add_note, its title on the first line and an item a line.',
  add_list_item:
    'Add the item to the checklist note in the app; notes are not edited from here.',
  check_list_item: 'Tick the item in the app.',
};

function retired(name: string, title: string, scope: Scope): McpTool {
  return defineTool({
    name,
    title: `${title} (retired)`,
    description: `Retired: returns an error pointing to notes and changes nothing; it goes in the next release. ${POINTER}`,
    scope,
    input: z.object({ space: SpaceArg }),
    annotations: scope === 'read' ? READ_ONLY : WRITE,
    async run() {
      throw new ToolError(`${name} is retired. ${POINTER} ${HOW[name] ?? ''}`);
    },
  });
}

export const listLists = retired('list_lists', 'List lists', 'read');
export const getList = retired('get_list', 'Get a list', 'read');
export const addList = retired('add_list', 'Add a list', 'write');
export const addListItem = retired(
  'add_list_item',
  'Add an item to a list',
  'write',
);
export const checkListItem = retired(
  'check_list_item',
  'Check off a list item',
  'write',
);

/** The retired tools' names: `test/mcp-tools.test.ts` holds them apart. */
export const RETIRED: ReadonlySet<string> = new Set([
  'list_lists',
  'get_list',
  'add_list',
  'add_list_item',
  'check_list_item',
]);
