import { z } from 'zod';
import { orgProjects } from '#shared/orgs';
import { peopleStats, statsFor } from '#shared/select';
import { defineTool, READ_ONLY, SpaceArg } from '../tool';
import { cap, peopleRefs, readSpace, taskOut, text } from './read';

/** People and orgs (#153), with what the People and Orgs pages show. */

export const listPeople = defineTool({
  name: 'list_people',
  title: 'List people',
  description:
    'Everyone in People, by name: role, whether they are you, the projects they are a member of, their open tasks (outside the archive) and the open tasks waiting on them.',
  scope: 'read',
  input: z.object({ space: SpaceArg }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const stats = peopleStats(state.projects, state.tasks);
    const people = Object.values(state.people).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      space,
      people: cap(
        people.map((p) => {
          const s = statsFor(stats, p.id);
          return {
            id: p.id,
            name: p.name,
            role: p.role,
            me: p.me,
            projects: s.projects.map((x) => ({
              id: x.id,
              name: x.name,
              archived: x.archived,
            })),
            openTasks: cap(
              s.open.map((t) => taskOut(state, t)),
              25,
            ),
            waitingOnThem: cap(
              s.waiting.map((t) => taskOut(state, t)),
              25,
            ),
          };
        }),
      ),
    };
  },
});

export const listOrgs = defineTool({
  name: 'list_orgs',
  title: 'List orgs',
  description:
    'Orgs (clients, internal teams, vendors, partners) by name, with their contacts, links, notes and projects. Archived orgs only with archived: true.',
  scope: 'read',
  input: z.object({
    space: SpaceArg,
    archived: z.boolean().optional().describe('true: include archived orgs.'),
  }),
  annotations: READ_ONLY,
  async run(args, ctx) {
    const { space, state } = await readSpace(ctx, args.space);
    const projects = orgProjects(state.projects, state.orgs);
    const orgs = Object.values(state.orgs)
      .filter((o) => args.archived || !o.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      space,
      orgs: cap(
        orgs.map((o) => ({
          id: o.id,
          name: o.name,
          kind: o.kind,
          archived: o.archived,
          contacts: peopleRefs(state, o.contacts),
          links: o.links,
          notes: text(state, o.notes),
          projects: (projects.get(o.id) ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            archived: p.archived,
          })),
        })),
      ),
    };
  },
});
