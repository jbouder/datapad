import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { MCP_OP_TYPES, type ServerMessage } from '#shared/protocol';
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
    // The reads here; the writes refuse it in their own test.
    for (const name of TOOLS.filter((t) => t.scope === 'read').map(
      (t) => t.name,
    )) {
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

/* ---- The write tools (#154) ---------------------------------------------- */

/** `seeded()`, with a token that may write. */
async function writer(): Promise<McpToolContext> {
  return { ...(await seeded()), scopes: ['read', 'write'] };
}

/** A socket open on the object's `main`, as a tab would have. */
async function tab(ctx: McpToolContext) {
  const response = await ctx.datapad.fetch(
    new Request('https://datapad.test/ws', {
      headers: { Upgrade: 'websocket' },
    }),
  );
  const ws = response.webSocket;
  if (!ws) throw new Error('No socket');
  const queue: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  ws.accept();
  const next = () =>
    new Promise<ServerMessage>((resolve) => {
      const queued = queue.shift();
      if (queued) resolve(queued);
      else waiting.push(resolve);
    });
  expect((await next()).type).toBe('snapshot');
  return { ws, next };
}

const lines = (out: Json) =>
  out.activity.map((a: { text: string }) => a.text) as string[];

describe('the write tools', () => {
  it('add_task: names to ids, words to dates, mentions to tokens, the activity line', async () => {
    const ctx = await writer();
    const out = await call(ctx, 'add_task', {
      title: 'Order more tauntaun feed',
      project: 'echo base',
      assignee: 'me',
      due: 'fri',
      priority: 'high',
      desc: 'Ask @Han Solo which supplier.',
      tags: ['logistics'],
      today: TODAY,
    });
    expect(out.task).toMatchObject({
      title: 'Order more tauntaun feed',
      project: { id: 'p-echo', name: 'Echo Base relocation' },
      assignee: { id: 'u-leia', name: 'Leia Organa' },
      due: '2026-10-30',
      priority: 'high',
      status: 'open',
      desc: 'Ask @Han Solo which supplier.',
      tags: ['logistics'],
    });
    expect(out.activity).toEqual([
      {
        project: { id: 'p-echo', name: 'Echo Base relocation' },
        text: 'Added task "Order more tauntaun feed"',
      },
    ]);
    const { state } = await ctx.datapad.snapshot(MAIN_SPACE);
    const stored = state.tasks[out.task.id];
    expect(stored?.desc).toBe('Ask @{u-han} which supplier.');
    expect(out.task.id).toMatch(/^[0-9a-z]{16}$/);

    const general = await call(ctx, 'add_task', { title: 'Sweep the hangar' });
    expect(general.task.project).toBeNull();
    expect(general.activity[0].project).toBeNull();

    const item = await call(ctx, 'add_task', {
      title: 'Send the power figures',
      meeting: 'Shield review',
      project: 'Falcon',
    });
    expect(item.task.project.id).toBe('p-echo');
    expect(item.task.meeting.id).toBe('e-1');
    expect(lines(item)).toEqual([
      'Added action item "Send the power figures" to "Shield review"',
    ]);

    expect(
      await fails(ctx, 'add_task', { title: 'X', due: 'someday' }),
    ).toMatch(/not a day/);
    expect(await fails(ctx, 'add_task', { title: 'X', assignee: 'Yoda' })).toBe(
      'No person matches "Yoda".',
    );
  });

  it('complete_task and reopen_task, idempotent', async () => {
    const ctx = await writer();
    const done = await call(ctx, 'complete_task', { task: 't-1' });
    expect(done.task.status).toBe('done');
    expect(done.task.completedAt).toBeTruthy();
    expect(lines(done)).toEqual(['Closed "Confirm shield generator delivery"']);
    const again = await call(ctx, 'complete_task', { task: 't-1' });
    expect(again.activity).toEqual([]);

    const open = await call(ctx, 'reopen_task', { task: 'shield generator' });
    expect(open.task.status).toBe('open');
    expect(lines(open)).toEqual([
      'Reopened "Confirm shield generator delivery"',
    ]);
  });

  it('edit_task: only the fields given, and "none" clears the due date', async () => {
    const ctx = await writer();
    const out = await call(ctx, 'edit_task', {
      task: 't-4',
      title: 'Book the tauntaun vet for Thursday',
      due: 'none',
      assignee: 'Chewbacca',
      tags: ['animals'],
    });
    expect(out.task).toMatchObject({
      title: 'Book the tauntaun vet for Thursday',
      due: '',
      assignee: { id: 'u-chewie' },
      tags: ['animals'],
    });
    expect(lines(out)).toEqual([
      'Edited task "Book the tauntaun vet for Thursday"',
    ]);
    const unassigned = await call(ctx, 'edit_task', {
      task: 't-4',
      assignee: 'unassigned',
    });
    expect(unassigned.task.assignee).toBeNull();
    expect(await fails(ctx, 'edit_task', { task: 't-4' })).toMatch(
      /Nothing to change/,
    );
  });

  it('set_blocked: on a person with a note, then unblocked', async () => {
    const ctx = await writer();
    const out = await call(ctx, 'set_blocked', {
      task: 't-1',
      on: 'Han',
      note: 'The manifest',
    });
    expect(out.task.blocked).toEqual({
      on: { id: 'u-han', name: 'Han Solo' },
      note: 'The manifest',
    });
    expect(lines(out)).toEqual([
      'Blocked "Confirm shield generator delivery" on Han Solo',
    ]);
    const off = await call(ctx, 'set_blocked', { task: 't-1', blocked: false });
    expect(off.task.blocked).toBeNull();
    expect(lines(off)).toEqual([
      'Unblocked "Confirm shield generator delivery"',
    ]);
  });

  it('add_note: in a project, on a meeting, on a task; not both', async () => {
    const ctx = await writer();
    const plain = await call(ctx, 'add_note', {
      body: 'Talked to @Mon Mothma about the budget.',
      project: 'p-falcon',
    });
    expect(plain.note).toMatchObject({
      project: { id: 'p-falcon' },
      body: 'Talked to @Mon Mothma about the budget.',
      meeting: null,
      task: null,
    });
    expect(lines(plain)).toEqual(['Added a note']);
    const { state } = await ctx.datapad.snapshot(MAIN_SPACE);
    expect(state.notes[plain.note.id]?.body).toBe(
      'Talked to @{u-mon} about the budget.',
    );
    expect(state.notes[plain.note.id]?.phase).toBeNull();

    const onMeeting = await call(ctx, 'add_note', {
      body: 'Power budget agreed.',
      meeting: 'e-1',
    });
    expect(onMeeting.note.meeting.id).toBe('e-1');
    expect(onMeeting.note.project.id).toBe('p-echo');

    const onTask = await call(ctx, 'add_note', {
      body: 'Called the depot.',
      task: 't-6',
    });
    expect(onTask.note.task.id).toBe('t-6');
    expect(onTask.note.project).toBeNull();
    expect(lines(onTask)).toEqual([
      'Added a note to "Renew the docking permit"',
    ]);

    expect(
      await fails(ctx, 'add_note', { body: 'x', meeting: 'e-1', task: 't-6' }),
    ).toMatch(/not both/);
    expect(await fails(ctx, 'add_note', { body: '   ' })).toMatch(/body/);
  });

  it('add_meeting, add_topic and cover_topic', async () => {
    const ctx = await writer();
    const out = await call(ctx, 'add_meeting', {
      title: 'Hangar walkthrough',
      date: 'tomorrow',
      time: '09:30',
      end: '10:00',
      project: 'Echo Base',
      attendees: ['Leia', 'chewbacca'],
      today: TODAY,
    });
    expect(out.meeting).toMatchObject({
      title: 'Hangar walkthrough',
      date: '2026-10-28',
      time: '09:30',
      end: '10:00',
      project: { id: 'p-echo' },
      attendees: [
        { id: 'u-leia', name: 'Leia Organa' },
        { id: 'u-chewie', name: 'Chewbacca' },
      ],
      topics: [],
    });
    expect(lines(out)).toEqual(['Added meeting "Hangar walkthrough"']);
    const id = out.meeting.id;

    const topic = await call(ctx, 'add_topic', {
      meeting: id,
      title: 'Door seals',
    });
    expect(topic.topic).toMatchObject({ title: 'Door seals', done: false });
    expect(lines(topic)).toEqual([
      'Added topic "Door seals" to "Hangar walkthrough"',
    ]);

    const covered = await call(ctx, 'cover_topic', {
      meeting: id,
      topic: 'door seals',
      outcome: 'Replace two by Friday',
    });
    expect(covered.topic).toMatchObject({
      done: true,
      outcome: 'Replace two by Friday',
    });
    expect(covered.activity).toEqual([]);
    const uncovered = await call(ctx, 'cover_topic', {
      meeting: id,
      topic: covered.topic.id,
      done: false,
    });
    expect(uncovered.topic).toMatchObject({
      done: false,
      outcome: 'Replace two by Friday',
    });

    expect(
      await fails(ctx, 'add_meeting', {
        title: 'Late',
        date: '2026-10-30',
        time: '15:00',
        end: '14:00',
      }),
    ).toMatch(/ends before/);
    expect(
      await fails(ctx, 'add_meeting', { title: 'Odd', date: '2026-02-30' }),
    ).toMatch(/not a day/);
  });

  it('create_project, set_project_status, set_project_health, add_milestone', async () => {
    const ctx = await writer();
    const out = await call(ctx, 'create_project', {
      name: 'Hoth evacuation drill',
      org: 'rebel alliance',
      priority: 'med',
      targetDate: '2026-12-01',
      members: ['Leia', 'Han'],
      tags: ['drill'],
    });
    expect(out.project).toMatchObject({
      name: 'Hoth evacuation drill',
      org: 'Rebel Alliance',
      status: 'active',
      health: 'none',
      priority: 'med',
      targetDate: '2026-12-01',
      members: [{ id: 'u-leia' }, { id: 'u-han' }],
    });
    expect(lines(out)).toEqual(['Created project']);
    const { state } = await ctx.datapad.snapshot(MAIN_SPACE);
    expect(state.projects[out.project.id]?.orgId).toBe('o-rebel');

    const free = await call(ctx, 'create_project', {
      name: 'Bespin visit',
      org: 'Cloud City',
    });
    expect(free.project.org).toBe('Cloud City');

    const paused = await call(ctx, 'set_project_status', {
      project: 'Hoth evacuation',
      status: 'paused',
    });
    expect(paused.project.status).toBe('paused');
    expect(lines(paused)).toEqual(['Status changed to paused']);

    const red = await call(ctx, 'set_project_health', {
      project: out.project.id,
      health: 'red',
    });
    expect(red.project.health).toBe('red');
    expect(lines(red)).toEqual(['Health set to red']);

    const milestone = await call(ctx, 'add_milestone', {
      project: out.project.id,
      title: 'Dry run',
      date: '+1w',
      today: TODAY,
    });
    expect(milestone.milestone).toMatchObject({
      title: 'Dry run',
      date: '2026-11-03',
    });
    expect(milestone.project.milestones).toHaveLength(1);
    expect(lines(milestone)).toEqual([
      'Added milestone "Dry run" (Tue 3 Nov 2026)',
    ]);

    expect(
      await fails(ctx, 'add_milestone', {
        project: 'general',
        title: 'x',
        date: 'today',
      }),
    ).toMatch(/General is not a project/);
    expect(
      await fails(ctx, 'create_project', {
        name: 'Backwards',
        startDate: '2026-12-01',
        targetDate: '2026-11-01',
      }),
    ).toMatch(/^Not saved: /);
  });

  it('writes to a space by name, and refuses an unknown one', async () => {
    const ctx = await writer();
    const made = await ctx.datapad.createSpace('Falcon');
    if (!made.ok) throw new Error(made.error);
    const out = await call(ctx, 'add_task', {
      space: 'falcon',
      title: 'Replace the motivator',
    });
    expect(out.space).toBe(made.value.id);
    const { state } = await ctx.datapad.snapshot(made.value.id);
    expect(state.tasks[out.task.id]?.title).toBe('Replace the motivator');
    expect(await fails(ctx, 'add_task', { space: 'nope', title: 'x' })).toMatch(
      /There is no space "nope"/,
    );
  });

  it('fans a write out to every open tab, as the op the app would send', async () => {
    const ctx = await writer();
    const { ws, next } = await tab(ctx);
    try {
      const { seq } = await ctx.datapad.snapshot(MAIN_SPACE);
      const out = await call(ctx, 'add_task', {
        title: 'Live from MCP',
        project: 'p-echo',
      });
      const message = await next();
      expect(message).toMatchObject({
        type: 'op',
        seq: seq + 1,
        op: {
          type: 'addTask',
          id: out.task.id,
          projectId: 'p-echo',
          title: 'Live from MCP',
        },
      });
      const covered = await call(ctx, 'cover_topic', {
        meeting: 'e-1',
        topic: 'North ridge',
        outcome: 'Surveyed',
      });
      expect(covered.topic.done).toBe(true);
      // Two ops, one change: one batch, one sequence number.
      const batch = await next();
      expect(batch).toMatchObject({ type: 'op', seq: seq + 2 });
      if (batch.type !== 'op') throw new Error('not an op');
      expect(batch.op.type).toBe('batch');
    } finally {
      ws.close();
    }
  });

  it('apply() refuses what OpSchema refuses, and dedupes an op id', async () => {
    const ctx = await writer();
    const bad = await ctx.datapad.apply(MAIN_SPACE, 'op-1', [
      { type: 'addTask', id: 'x', projectId: null, title: '' },
    ]);
    expect(bad).toEqual({
      ok: false,
      error: expect.stringMatching(/required/),
    });
    const unknown = await ctx.datapad.apply(MAIN_SPACE, 'op-2', [
      { type: 'eraseEverything' },
    ]);
    expect(unknown.ok).toBe(false);
    const empty = await ctx.datapad.apply(MAIN_SPACE, 'op-3', []);
    expect(empty.ok).toBe(false);
    const nested = await ctx.datapad.apply(MAIN_SPACE, 'op-4', [
      { type: 'batch', ops: [{ type: 'toggleTask', id: 't-1', done: true }] },
      { type: 'toggleTask', id: 't-2', done: true },
    ]);
    expect(nested.ok).toBe(false);
    const reduced = await ctx.datapad.apply(MAIN_SPACE, 'op-5', [
      { type: 'toggleTask', id: 'no-such-task', done: true },
    ]);
    expect(reduced).toEqual({ ok: false, error: 'That task no longer exists' });

    const op = { type: 'toggleTask', id: 't-1', done: true };
    const first = await ctx.datapad.apply(MAIN_SPACE, 'op-6', [op]);
    expect(first).toMatchObject({ ok: true, replay: false });
    const replay = await ctx.datapad.apply(MAIN_SPACE, 'op-6', [op]);
    expect(replay).toMatchObject({ ok: true, replay: true, activity: [] });
    if (!first.ok || !replay.ok) throw new Error('refused');
    expect(replay.seq).toBe(first.seq);
  });

  it('apply() refuses every op off MCP_OP_TYPES, alone or in a batch, and writes nothing', async () => {
    const ctx = await writer();
    const before = await ctx.datapad.snapshot(MAIN_SPACE);
    const task = before.state.tasks['t-1'];
    if (!task) throw new Error('no t-1');
    const barred = [
      { type: 'deleteProject', id: 'p-echo' },
      { type: 'deleteTask', id: 't-1' },
      { type: 'remove', col: 'tasks', id: 't-1' },
      { type: 'put', col: 'tasks', doc: { ...task, title: 'Overwritten' } },
      { type: 'archiveProject', id: 'p-echo' },
    ];
    for (const op of barred) {
      const alone = await ctx.datapad.apply(MAIN_SPACE, `alone-${op.type}`, [
        op,
      ]);
      expect(alone, op.type).toEqual({
        ok: false,
        error: `A connected app cannot send "${op.type}"; that change stays in the app`,
      });
      // In a batch behind an allowed op: the whole batch is refused.
      const batched = await ctx.datapad.apply(MAIN_SPACE, `batch-${op.type}`, [
        { type: 'toggleTask', id: 't-2', done: true },
        op,
      ]);
      expect(batched, op.type).toMatchObject({ ok: false });
      if (batched.ok) throw new Error('applied');
      expect(batched.error).toContain(`"${op.type}"`);
    }
    const after = await ctx.datapad.snapshot(MAIN_SPACE);
    expect(after.seq).toBe(before.seq);
    expect(after.state).toEqual(before.state);
  });

  it('every op type the write tools send is on MCP_OP_TYPES', async () => {
    const ctx = await writer();
    const sent = new Set<string>();
    const used = new Set<string>();
    const datapad = new Proxy(ctx.datapad, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop !== 'apply') return value;
        return (space: string, opId: string, ops: { type: string }[]) => {
          for (const op of ops) sent.add(op.type);
          return target.apply(space, opId, ops);
        };
      },
    });
    const rec = { ...ctx, datapad };
    const run = async (name: string, args: Record<string, unknown>) => {
      used.add(name);
      return call(rec, name, args);
    };
    await run('add_task', { title: 'Feed the tauntauns', project: 'p-echo' });
    await run('complete_task', { task: 't-1' });
    await run('reopen_task', { task: 't-1' });
    await run('edit_task', { task: 't-4', title: 'Book the vet', due: 'none' });
    await run('set_blocked', { task: 't-1', on: 'Han' });
    await run('add_note', { body: 'Power budget agreed.', meeting: 'e-1' });
    const meeting = await run('add_meeting', {
      title: 'Hangar walkthrough',
      date: 'tomorrow',
      today: TODAY,
    });
    await run('add_topic', { meeting: meeting.meeting.id, title: 'Seals' });
    await run('cover_topic', {
      meeting: meeting.meeting.id,
      topic: 'seals',
      outcome: 'Replace two',
    });
    const project = await run('create_project', { name: 'Hoth drill' });
    await run('set_project_status', {
      project: project.project.id,
      status: 'paused',
    });
    await run('set_project_health', {
      project: project.project.id,
      health: 'red',
    });
    await run('add_milestone', {
      project: project.project.id,
      title: 'Dry run',
      date: '+1w',
      today: TODAY,
    });
    // Every write tool ran, and each op it sent is on the list.
    expect([...used].sort()).toEqual(
      TOOLS.filter((t) => t.scope === 'write')
        .map((t) => t.name)
        .sort(),
    );
    expect([...sent].sort()).toEqual([...MCP_OP_TYPES].sort());
  });

  it('a read-only token neither sees nor runs a write tool', async () => {
    const ctx = await seeded();
    const post = async (body: unknown) =>
      (await (
        await handleMcpPost(
          new Request('https://datapad.test/mcp', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
          {
            tools: TOOLS,
            context: ctx,
            instructions: '',
            admit: async () => true,
            limited: '',
          },
        )
      ).json()) as Json;
    const list = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(13);
    expect(names).not.toContain('add_task');
    const refused = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'add_task', arguments: { title: 'Sneaky' } },
    });
    expect(refused.result.isError).toBe(true);
    const { state } = await ctx.datapad.snapshot(MAIN_SPACE);
    expect(Object.values(state.tasks).some((t) => t.title === 'Sneaky')).toBe(
      false,
    );
  });

  it('every write tool needs the write scope, and none is destructive', () => {
    const writes = TOOLS.filter((t) => t.scope === 'write');
    expect(writes.map((t) => t.name)).toEqual([
      'add_task',
      'complete_task',
      'reopen_task',
      'edit_task',
      'set_blocked',
      'add_note',
      'add_meeting',
      'add_topic',
      'cover_topic',
      'create_project',
      'set_project_status',
      'set_project_health',
      'add_milestone',
    ]);
    for (const t of writes) {
      expect(t.annotations.readOnlyHint, t.name).toBe(false);
      expect(t.annotations.destructiveHint, t.name).toBe(false);
      expect(t.name, t.name).not.toMatch(/delete|remove|erase|archive|import/);
    }
  });
});
