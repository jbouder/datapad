import { z } from 'zod';
import { defineTool, READ_ONLY } from '../tool';

/**
 * Who the token belongs to and what is in their Datapad (#152). Neither
 * takes an argument that could reach another object: both read the one
 * the verified email named.
 */

const Space = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  createdAt: z.string(),
});

const Counts = z.object({
  projects: z.number().describe('Projects not archived'),
  archivedProjects: z.number(),
  openTasks: z.number(),
  tasks: z.number(),
  notes: z.number(),
  meetings: z.number(),
  people: z.number(),
});

export const whoami = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'The signed-in email this connection acts for, what it was granted, and each of its spaces with how much it holds.',
  scope: 'read',
  input: z.object({}),
  output: z.object({
    email: z.string(),
    scopes: z.array(z.string()),
    spaces: z.array(Space.extend({ counts: Counts })),
  }),
  annotations: READ_ONLY,
  async run(_args, { email, scopes, datapad }) {
    const spaces = await datapad.spaceSummaries();
    return { email, scopes: [...scopes], spaces };
  },
});

export const listSpaces = defineTool({
  name: 'list_spaces',
  title: 'List spaces',
  description:
    'Every space, in the order the app shows them. Each is a separate Datapad; pass its id as `space` to the other tools. "main" is the default.',
  scope: 'read',
  input: z.object({}),
  output: z.object({ spaces: z.array(Space) }),
  annotations: READ_ONLY,
  async run(_args, { datapad }) {
    const { spaces } = await datapad.listSpaces();
    return { spaces };
  },
});
