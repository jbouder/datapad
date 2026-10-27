import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { MAIN_SPACE } from '#shared/types';
import type { Bindings } from '../worker/env';
import { handleMcpPost } from '../worker/mcp/protocol';
import {
  type CallToolResult,
  callTool,
  type McpTool,
  type McpToolContext,
  toolJsonSchema,
} from '../worker/mcp/tool';
import { TOOLS } from '../worker/mcp/tools';
import { zonedWeekEnding } from '../worker/mcp/tools/digest';
import fixture from './fixtures/export.json';

/**
 * The read tools (#153), each over a real Durable Object seeded with the
 * export fixture plus a little more (an org, topics, a blocked task, a
 * second "Echo" project), called as `/mcp` calls them. The fixture sits
 * around 2026-10-23, so every call pins `today` to Tuesday 27 Oct 2026.
 */

const base = env as unknown as Bindings;
const TODAY = '2026-10-27';
const T = '2026-10-20T09:00:00.000Z';

const EXTRA = {
  orgs: {
    'o-rebel': {
      id: 'o-rebel',
      name: 'Rebel Alliance',
      kind: 'internal',
      contacts: ['u-mon'],
      notes: 'Ask @{u-mon} first.',
      createdAt: T,
      updatedAt: T,
    },
  },
  projects: {
    'p-station': {
      id: 'p-station',
      name: 'Echo Station upkeep',
      org: 'Rebel Alliance',
      status: 'active',
      priority: 'low',
      targetDate: '',
      tags: [],
      desc: '',
      state: '',
      members: [],
      links: [],
      archived: false,
      createdAt: T,
      updatedAt: T,
    },
  },
  meetings: {
    'e-1': {
      ...fixture.meetings['e-1'],
      topics: [
        { id: 'tp-1', title: 'Power budget', done: true, outcome: 'Agreed' },
        { id: 'tp-2', title: 'North ridge', done: false, outcome: '' },
      ],
    },
  },
  tasks: {
    't-2': {
      ...fixture.tasks['t-2'],
      blocked: { on: 'u-han', note: 'Needs the insulation shipment' },
    },
  },
};

let n = 0;

/** A fresh object for a fresh email, seeded, and the context /mcp gives. */
async function seeded(): Promise<McpToolContext> {
  n += 1;
  const email = `reader-${n}-${crypto.randomUUID()}@example.com`;
  const datapad = base.DATAPAD.getByName(email);
  expect((await datapad.import(MAIN_SPACE, fixture)).ok).toBe(true);
  expect((await datapad.import(MAIN_SPACE, EXTRA)).ok).toBe(true);
  return { email, scopes: ['read'], datapad, timeZone: 'UTC' };
}

function tool(name: string): McpTool {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

// biome-ignore lint/suspicious/noExplicitAny: results are JSON the test reads freely.
type Json = any;

async function call(
  ctx: McpToolContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Json> {
  const result = await callTool(tool(name), args, ctx);
  expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
  // The text block and the structured result say the same thing.
  expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(
    result.structuredContent,
  );
  return result.structuredContent;
}

async function fails(
  ctx: McpToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result: CallToolResult = await callTool(tool(name), args, ctx);
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? '';
}

const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('the read tools', () => {
  it('get_overview: counts, the week, and projects with status, health, next milestone, open and blocked', async () => {
    const ctx = await seeded();
    const out = await call(ctx, 'get_overview', { today: TODAY });
    expect(out.space).toBe('main');
    expect(out.today).toBe(TODAY);
    expect(out.counts).toMatchObject({
      projects: 3,
      archivedProjects: 1,
      openTasks: 5,
    });
    expect(out.week.line).toMatch(/closed this week/);
    expect(out.general).toEqual({ openTasks: 1, blockedTasks: 0 });
    const echo = out.projects.items.find(
      (p: { id: string }) => p.id === 'p-echo',
    );
    expect(echo).toMatchObject({
      name: 'Echo Base relocation',
      org: 'Rebel Alliance',
      status: 'active',
      health: 'none',
      openTasks: 3,
      blockedTasks: 1,
      nextMilestone: { title: 'Base operational', date: '2026-11-14' },
    });
    // The archive stays out.
    expect(ids(out.projects.items)).not.toContain('p-yavin');
    expect(out.projects).toMatchObject({ count: 3, truncated: false });
  });

  it('list_projects: status, archived and org filters', async () => {
    const ctx = await seeded();
    const all = await call(ctx, 'list_projects', { today: TODAY });
    expect(ids(all.projects.items).sort()).toEqual([
      'p-echo',
      'p-falcon',
      'p-station',
    ]);
    const paused = await call(ctx, 'list_projects', { status: 'paused' });
    expect(ids(paused.projects.items)).toEqual(['p-falcon']);
    const archived = await call(ctx, 'list_projects', { archived: true });
    expect(ids(archived.projects.items)).toEqual(['p-yavin']);
    // By the org record's name, any case, or by an org text with no record.
    const rebels = await call(ctx, 'list_projects', {
      org: 'rebel alliance',
      sort: 'name',
    });
    expect(ids(rebels.projects.items)).toEqual(['p-echo', 'p-station']);
    const corellian = await call(ctx, 'list_projects', {
      org: 'Corellian Engineering',
    });
    expect(ids(corellian.projects.items)).toEqual(['p-falcon']);
    expect(await fails(ctx, 'list_projects', { org: 'Empire' })).toMatch(
      /No org matches "Empire"/,
    );
  });

  it('get_project: the project with open tasks, milestones, notes, meetings with topics and activity', async () => {
    const ctx = await seeded();
    const out = await call(ctx, 'get_project', {
      project: 'echo base',
      today: TODAY,
    });
    expect(out.project).toMatchObject({
      id: 'p-echo',
      name: 'Echo Base relocation',
      milestones: [{ id: 'e-2', title: 'Base operational' }],
    });
    expect(out.tasks).toEqual({ open: 3, done: 1, blocked: 1 });
    expect(ids(out.openTasks.items)).toEqual(['t-1', 't-2', 't-4']);
    const t1 = out.openTasks.items[0];
    // Mentions read as names; people as id and name.
    expect(t1.desc).toBe('Ask @Han Solo for the manifest.');
    expect(t1.assignee).toEqual({ id: 'u-leia', name: 'Leia Organa' });
    expect(out.openTasks.items[1].blocked).toEqual({
      on: { id: 'u-han', name: 'Han Solo' },
      note: 'Needs the insulation shipment',
    });
    expect(ids(out.recentNotes.items).sort()).toEqual(['n-1', 'n-2']);
    expect(out.upcomingMeetings.items[0]).toMatchObject({
      id: 'e-1',
      date: TODAY,
      attendees: [
        { id: 'u-leia', name: 'Leia Organa' },
        { id: 'u-han', name: 'Han Solo' },
      ],
      topics: [
        { id: 'tp-1', title: 'Power budget', done: true, outcome: 'Agreed' },
        { id: 'tp-2', title: 'North ridge', done: false },
      ],
    });
    expect(out.recentMeetings.count).toBe(0);
    expect(out.activity.items[0]).toEqual({
      t: '2026-10-22T16:30:00.000Z',
      text: 'Added a note',
    });
    expect(out.activity.items.length).toBeLessThanOrEqual(25);

    const general = await call(ctx, 'get_project', {
      project: 'general',
      today: TODAY,
    });
    expect(general.project).toEqual({ id: 'general', name: 'General' });
    expect(ids(general.openTasks.items)).toEqual(['t-6']);
    expect(ids(general.upcomingMeetings.items)).toEqual(['e-4']);
  });

  it('list_tasks: project, status, assignee, due bucket and blocked', async () => {
    const ctx = await seeded();
    const list = async (args: Record<string, unknown>) =>
      ids(
        (await call(ctx, 'list_tasks', { today: TODAY, ...args })).tasks.items,
      );
    expect(await list({ due: 'overdue' })).toEqual(['t-1']);
    expect(await list({ due: 'week' })).toEqual(['t-5', 't-4']);
    expect((await list({ due: 'none' })).sort()).toEqual(['t-2', 't-6']);
    expect(await list({ due: 'today' })).toEqual([]);
    expect(await list({ assignee: 'me' })).toEqual(['t-1']);
    expect(await list({ assignee: 'han solo' })).toEqual(['t-5']);
    expect((await list({ assignee: 'unassigned' })).sort()).toEqual([
      't-4',
      't-6',
    ]);
    expect(await list({ blocked: true })).toEqual(['t-2']);
    expect(await list({ project: 'general' })).toEqual(['t-6']);
    expect(await list({ project: 'p-falcon' })).toEqual(['t-5']);
    expect((await list({ status: 'done' })).sort()).toEqual(['t-3', 't-7']);
    expect(await list({ query: 'manifest' })).toEqual(['t-1']);
    const one = await call(ctx, 'list_tasks', { today: TODAY, due: 'overdue' });
    expect(one.tasks.items[0].dueBucket).toBe('overdue');
    // A bucket the schema does not know is an argument error.
    expect(await fails(ctx, 'list_tasks', { due: 'soon' })).toMatch(
      /^Invalid arguments: due:/,
    );
  });

  it('get_focus: the due buckets, waiting on, attention and the seven-day agenda', async () => {
    const ctx = await seeded();
    const out = await call(ctx, 'get_focus', { today: TODAY });
    expect(ids(out.due.overdue.items)).toEqual(['t-1']);
    expect(ids(out.due.thisWeek.items)).toEqual(['t-5', 't-4']);
    expect(out.due.noDate).toBe(1);
    expect(out.waitingOn).toHaveLength(1);
    expect(out.waitingOn[0].person).toEqual({ id: 'u-han', name: 'Han Solo' });
    expect(out.me).toEqual({ id: 'u-leia', name: 'Leia Organa' });
    // Shield review today; Quarterly planning (1 Dec) is past the week.
    expect(
      out.agenda.items.map((i: { kind: string; id: string }) => [i.kind, i.id]),
    ).toEqual([['meeting', 'e-1']]);
    expect(out.agenda.items[0].prep).toMatch(/1 of 2 topics left/);
    // Only the assignee's work with a filter.
    const han = await call(ctx, 'get_focus', {
      today: TODAY,
      assignee: 'Han Solo',
    });
    expect(ids(han.due.overdue.items)).toEqual([]);
    expect(ids(han.due.thisWeek.items)).toEqual(['t-5']);
  });

  it('list_notes: project, meeting, query and limit, mentions as names', async () => {
    const ctx = await seeded();
    const all = await call(ctx, 'list_notes', {});
    // Yavin is archived: its notes stay out without a project filter.
    expect(ids(all.notes.items)).toEqual(['n-2', 'n-1', 'n-3']);
    const yavin = await call(ctx, 'list_notes', { project: 'Yavin' });
    expect(ids(yavin.notes.items)).toEqual(['n-4']);
    const meeting = await call(ctx, 'list_notes', {
      meeting: 'Shield review',
    });
    expect(ids(meeting.notes.items)).toEqual(['n-2']);
    expect(meeting.notes.items[0].meeting).toMatchObject({ id: 'e-1' });
    const found = await call(ctx, 'list_notes', { query: 'heaters check' });
    expect(ids(found.notes.items)).toEqual(['n-1']);
    expect(found.notes.items[0].body).toContain(
      '@Chewbacca has the hangar keys.',
    );
    const one = await call(ctx, 'list_notes', { limit: 1 });
    expect(one.notes).toMatchObject({ count: 3, truncated: true });
    expect(one.notes.items).toHaveLength(1);
  });

  it('list_meetings: a date range and a project, with topics and outcomes', async () => {
    const ctx = await seeded();
    const all = await call(ctx, 'list_meetings', {});
    expect(ids(all.meetings.items)).toEqual(['e-3', 'e-1', 'e-4']);
    const october = await call(ctx, 'list_meetings', {
      from: '2026-10-10',
      to: '2026-10-31',
    });
    expect(ids(october.meetings.items)).toEqual(['e-1']);
    expect(october.meetings.items[0]).toMatchObject({
      project: { id: 'p-echo', name: 'Echo Base relocation' },
      notes: 1,
      actionItems: { open: 0, done: 0 },
    });
    expect(october.meetings.items[0].topics[0].outcome).toBe('Agreed');
    const general = await call(ctx, 'list_meetings', { project: 'general' });
    expect(ids(general.meetings.items)).toEqual(['e-4']);
    expect(
      await fails(ctx, 'list_meetings', {
        from: '2026-11-01',
        to: '2026-10-01',
      }),
    ).toMatch(/after/);
  });

  it('list_people and list_orgs', async () => {
    const ctx = await seeded();
    const people = await call(ctx, 'list_people', {});
    expect(people.people.items.map((p: { name: string }) => p.name)).toEqual([
      'Chewbacca',
      'Han Solo',
      'Leia Organa',
      'Mon Mothma',
    ]);
    const han = people.people.items[1];
    expect(ids(han.openTasks.items)).toEqual(['t-5']);
    expect(ids(han.waitingOnThem.items)).toEqual(['t-2']);
    const orgs = await call(ctx, 'list_orgs', {});
    expect(orgs.orgs.items).toHaveLength(1);
    expect(orgs.orgs.items[0]).toMatchObject({
      id: 'o-rebel',
      kind: 'internal',
      notes: 'Ask @Mon Mothma first.',
      contacts: [{ id: 'u-mon', name: 'Mon Mothma' }],
    });
    expect(ids(orgs.orgs.items[0].projects)).toEqual([
      'p-echo',
      'p-station',
      'p-yavin',
    ]);
  });

  it('get_digest: the week ending a day, as data and as Markdown', async () => {
    const ctx = await seeded();
    const out = await call(ctx, 'get_digest', { weekEnding: '2026-10-23' });
    expect(out.range).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    const falcon = out.projects.find(
      (p: { id: string }) => p.id === 'p-falcon',
    );
    expect(falcon.changes).toEqual(['Status changed to paused']);
    expect(out.markdown).toMatch(/^## Week of /);
    expect(out.markdown).toContain('### Falcon hyperdrive refit');
  });

  it('get_digest counts the week in the owner’s zone, not the Worker’s', () => {
    expect(zonedWeekEnding('2026-10-23', 'America/New_York')).toEqual({
      from: '2026-10-17T04:00:00.000Z',
      to: '2026-10-24T04:00:00.000Z',
      fromDay: '2026-10-17',
      toDay: '2026-10-23',
    });
  });

  it('search: the ⌘K index, ranked, with counts', async () => {
    const ctx = await seeded();
    const out = await call(ctx, 'search', { query: 'shield' });
    const hits = out.hits.map((h: { kind: string; id: string }) => [
      h.kind,
      h.id,
    ]);
    expect(hits).toContainEqual(['task', 't-1']);
    expect(hits).toContainEqual(['meeting', 'e-1']);
    expect(out.counts.task).toBe(1);
    // A topic is found through its meeting.
    const topic = await call(ctx, 'search', {
      query: 'north ridge',
      kinds: ['meeting'],
    });
    expect(topic.hits.map((h: { id: string }) => h.id)).toEqual(['e-1']);
    expect(await fails(ctx, 'search', { query: '  ' })).toMatch(/query/);
  });
});

describe('the conventions', () => {
  it('resolves an exact name, a unique part, and lists the candidates for an ambiguous one', async () => {
    const ctx = await seeded();
    const exact = await call(ctx, 'get_project', {
      project: 'ECHO STATION UPKEEP',
      today: TODAY,
    });
    expect(exact.project.id).toBe('p-station');
    const message = await fails(ctx, 'get_project', { project: 'echo' });
    expect(message).toMatch(/"echo" matches 2 projects/);
    expect(message).toContain('p-echo (Echo Base relocation)');
    expect(message).toContain('p-station (Echo Station upkeep)');
    expect(await fails(ctx, 'get_project', { project: 'Death Star' })).toBe(
      'No project matches "Death Star".',
    );
    expect(await fails(ctx, 'list_tasks', { assignee: 'Vader' })).toBe(
      'No person matches "Vader".',
    );
  });

  it('caps a list at 200 with count and truncated', async () => {
    const ctx = await seeded();
    const tasks = Object.fromEntries(
      Array.from({ length: 205 }, (_, i) => {
        const id = `bulk-${String(i).padStart(3, '0')}`;
        return [
          id,
          {
            id,
            title: `Bulk task ${i}`,
            projectId: null,
            order: i,
            createdAt: T,
            updatedAt: T,
          },
        ];
      }),
    );
    expect((await ctx.datapad.import(MAIN_SPACE, { tasks })).ok).toBe(true);
    const out = await call(ctx, 'list_tasks', { project: 'general' });
    expect(out.tasks.count).toBe(206);
    expect(out.tasks.truncated).toBe(true);
    expect(out.tasks.items).toHaveLength(200);
    const few = await call(ctx, 'list_tasks', {
      project: 'general',
      limit: 5,
    });
    expect(few.tasks).toMatchObject({ count: 206, truncated: true });
    expect(few.tasks.items).toHaveLength(5);
    expect(await fails(ctx, 'list_tasks', { limit: 500 })).toMatch(/limit/);
  });

  it('takes a space by id or name, and refuses an unknown one', async () => {
    const ctx = await seeded();
    const made = await ctx.datapad.createSpace('Hoth');
    if (!made.ok) throw new Error(made.error);
    const hoth = made.value.id;
    expect(
      (
        await ctx.datapad.import(hoth, {
          projects: {
            'p-cold': {
              ...EXTRA.projects['p-station'],
              id: 'p-cold',
              name: 'Cold',
            },
          },
        })
      ).ok,
    ).toBe(true);
    const byName = await call(ctx, 'list_projects', { space: 'hoth' });
    expect(byName.space).toBe(hoth);
    expect(ids(byName.projects.items)).toEqual(['p-cold']);
    const byId = await call(ctx, 'get_overview', { space: hoth });
    expect(byId.counts.projects).toBe(1);
    for (const name of TOOLS.map((t) => t.name)) {
      if (name === 'whoami' || name === 'list_spaces') continue;
      const args: Record<string, unknown> = { space: 'dagobah' };
      if (name === 'get_project') args.project = 'p-echo';
      if (name === 'search') args.query = 'x';
      expect(await fails(ctx, name, args), name).toBe(
        'There is no space "dagobah". Call list_spaces for the ids.',
      );
    }
  });

  it('every read tool is read-only and needs only the read scope', () => {
    const reads = TOOLS.filter((t) => t.scope === 'read');
    expect(reads).toHaveLength(13);
    for (const t of reads) {
      expect(t.scope, t.name).toBe('read');
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
      expect(t.annotations.destructiveHint, t.name).toBe(false);
    }
  });

  it('shows in tools/list the schemas the same zod validates with', async () => {
    const ctx = await seeded();
    const response = await handleMcpPost(
      new Request('https://datapad.test/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      {
        tools: TOOLS,
        context: ctx,
        instructions: '',
        admit: async () => true,
        limited: '',
      },
    );
    const { result } = (await response.json()) as {
      result: {
        tools: { name: string; inputSchema: Record<string, unknown> }[];
      };
    };
    for (const listed of result.tools) {
      const t = tool(listed.name);
      expect(listed.inputSchema, t.name).toEqual(toolJsonSchema(t.input));
    }
    const listed = result.tools.find((t) => t.name === 'list_tasks');
    const properties = (listed?.inputSchema.properties ?? {}) as Record<
      string,
      { enum?: string[] }
    >;
    expect(properties.due?.enum).toEqual([
      'overdue',
      'today',
      'week',
      'later',
      'none',
    ]);
    // What the schema shows as refused, the call refuses.
    expect(tool('list_tasks').input.safeParse({ due: 'soon' }).success).toBe(
      false,
    );
  });
});
