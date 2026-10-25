import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import type { Op, ServerMessage } from '#shared/protocol';
import { MAIN_SPACE, type Snapshot } from '#shared/types';
import { DatapadObject } from '../worker/datapad';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';
import fixture from './fixtures/export.json';

const bindings = env as unknown as Bindings;

/** A handler where Access says this request is `email` (or nobody). */
function as(email: string | null) {
  return createHandler(async () => (email ? { email } : null));
}

/** Every message a socket receives, in order, awaitable one by one. */
class Inbox {
  private readonly queue: string[] = [];
  private readonly waiting: Array<(text: string) => void> = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const text = String(event.data);
      const waiter = this.waiting.shift();
      if (waiter) waiter(text);
      else this.queue.push(text);
    });
  }

  text(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async next(): Promise<ServerMessage> {
    return JSON.parse(await this.text()) as ServerMessage;
  }

  async snapshot(): Promise<Extract<ServerMessage, { type: 'snapshot' }>> {
    const message = await this.next();
    if (message.type !== 'snapshot') throw new Error(`Got ${message.type}`);
    return message;
  }

  send(op: Op, opId = crypto.randomUUID()) {
    this.ws.send(JSON.stringify({ type: 'op', opId, op }));
    return opId;
  }

  /** Nothing more arrives within a short wait. */
  async quiet(ms = 50): Promise<boolean> {
    if (this.queue.length) return false;
    await new Promise((r) => setTimeout(r, ms));
    return this.queue.length === 0;
  }
}

async function openSocket(
  handle: ReturnType<typeof as>,
  url = 'http://datapad.test/ws',
): Promise<Inbox> {
  const response = await handle(
    new Request(url, { headers: { Upgrade: 'websocket' } }),
    bindings,
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (!ws) throw new Error('No socket');
  const inbox = new Inbox(ws);
  ws.accept();
  return inbox;
}

const addTask = (id: string, title = 'Heaters'): Op => ({
  type: 'addTask',
  id,
  projectId: null,
  title,
});

function post(email: string, path: string, body: unknown, init?: RequestInit) {
  return as(email)(
    new Request(`http://datapad.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
    bindings,
  );
}

function get(email: string, path: string) {
  return as(email)(new Request(`http://datapad.test${path}`), bindings);
}

describe('DatapadObject storage', () => {
  it('creates its tables on first touch', async () => {
    const stub = bindings.DATAPAD.getByName('tables@example.com');
    await runInDurableObject(stub, async (_instance: DatapadObject, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .toArray()
        .map((r) => r.name);
      expect(tables).toEqual(
        expect.arrayContaining(['docs', 'meta', 'op_ids', 'spaces']),
      );
      const columns = state.storage.sql
        .exec<{ name: string; pk: number }>("PRAGMA table_info('docs')")
        .toArray();
      expect(columns.map((c) => c.name)).toEqual([
        'space',
        'col',
        'id',
        'json',
        'updated_at',
      ]);
      expect(
        columns
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name),
      ).toEqual(['space', 'col', 'id']);
    });
    expect(await stub.stats()).toEqual({ docs: 0, seq: 0, sockets: 0 });
  });

  it('starts with one space, Main, and lists it', async () => {
    const email = 'fresh@example.com';
    const { spaces } = await bindings.DATAPAD.getByName(email).listSpaces();
    expect(spaces).toEqual([
      {
        id: MAIN_SPACE,
        name: 'Main',
        position: 0,
        createdAt: expect.any(String),
      },
    ]);
    expect(Date.parse(spaces[0]?.createdAt ?? '')).not.toBeNaN();
    const response = await get(email, '/api/spaces');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ spaces });
    expect((await post(email, '/api/spaces', {})).status).toBe(405);
  });

  it('moves the documents from before spaces into main, with their seq', async () => {
    const stub = bindings.DATAPAD.getByName('legacy@example.com');
    await runInDurableObject(stub, async (_i: DatapadObject, state) => {
      const sql = state.storage.sql;
      // Put storage back the way it was before spaces.
      sql.exec(`
        DROP TABLE docs;
        DROP TABLE spaces;
        CREATE TABLE docs (
          col TEXT NOT NULL,
          id TEXT NOT NULL,
          json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (col, id)
        );
        DELETE FROM meta;
      `);
      const task = { ...fixture.tasks['t-1'], id: 't-1' };
      const project = Object.values(fixture.projects)[0];
      sql.exec(
        "INSERT INTO docs VALUES ('tasks', 't-1', ?, '2026-10-01')",
        JSON.stringify(task),
      );
      sql.exec(
        "INSERT INTO docs VALUES ('projects', ?, ?, '2026-10-01')",
        project?.id ?? '',
        JSON.stringify(project),
      );
      sql.exec("INSERT INTO meta VALUES ('seq', '7')");

      // Waking up runs the migration; so does every later wake, harmlessly.
      for (let i = 0; i < 2; i += 1) {
        const revived = new DatapadObject(state, bindings);
        await state.blockConcurrencyWhile(async () => {});
        const file = await revived.export(MAIN_SPACE);
        expect(file.tasks['t-1']).toEqual(task);
        expect(Object.keys(file.projects)).toEqual([project?.id]);
        expect(await revived.stats()).toMatchObject({ docs: 2, seq: 7 });
        const { spaces } = await revived.listSpaces();
        expect(spaces.map((s) => [s.id, s.name])).toEqual([
          [MAIN_SPACE, 'Main'],
        ]);
      }
      const rows = sql
        .exec<{ space: string }>('SELECT space FROM docs')
        .toArray();
      expect(rows.map((r) => r.space)).toEqual([MAIN_SPACE, MAIN_SPACE]);
      // The global seq is gone; main's row holds it now.
      expect(
        sql.exec("SELECT value FROM meta WHERE key = 'seq'").toArray(),
      ).toEqual([]);
      expect(
        sql.exec<{ seq: number }>('SELECT seq FROM spaces').one().seq,
      ).toBe(7);
    });
  });

  it('keeps each user in their own object', async () => {
    const leia = bindings.DATAPAD.getByName('leia@example.com');
    await runInDurableObject(leia, async (_i: DatapadObject, state) => {
      state.storage.sql.exec(
        "INSERT INTO docs VALUES ('main', 'task', 't1', '{}', '2026-10-23')",
      );
    });
    expect((await leia.stats()).docs).toBe(1);
    const han = bindings.DATAPAD.getByName('han@example.com');
    expect((await han.stats()).docs).toBe(0);
  });
});

describe('Worker routes', () => {
  it('answers /api/config with the signed-in email', async () => {
    const response = await as('leia@example.com')(
      new Request('http://datapad.test/api/config'),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'leia@example.com' });
  });

  it('answers unknown API paths with 404 JSON', async () => {
    const response = await as('leia@example.com')(
      new Request('http://datapad.test/api/nope'),
      bindings,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('json');
  });

  it('refuses everything without a verified identity', async () => {
    const handle = as(null);
    const page = await handle(new Request('http://datapad.test/'), bindings);
    expect(page.status).toBe(401);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Sign in required');

    const deep = await handle(
      new Request('http://datapad.test/projects/abc'),
      bindings,
    );
    expect(deep.status).toBe(401);

    const api = await handle(
      new Request('http://datapad.test/api/config'),
      bindings,
    );
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'Sign in required' });

    const socket = await handle(
      new Request('http://datapad.test/ws', {
        headers: { Upgrade: 'websocket' },
      }),
      bindings,
    );
    expect(socket.status).toBe(401);
    expect(socket.webSocket).toBeNull();
  });

  it('wants an upgrade on /ws', async () => {
    const response = await as('leia@example.com')(
      new Request('http://datapad.test/ws'),
      bindings,
    );
    expect(response.status).toBe(426);
  });

  it('opens a socket on the signed-in user’s object that answers ping', async () => {
    const email = 'socket@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    inbox.ws.send('ping');
    expect(await inbox.text()).toBe('pong');
    expect((await bindings.DATAPAD.getByName(email).stats()).sockets).toBe(1);
    inbox.ws.close(1000, 'done');
  });

  it('never lets the request choose another object', async () => {
    const owner = 'owner@example.com';
    const { ws } = await openSocket(
      as(owner),
      'http://datapad.test/ws?name=victim@example.com&email=victim@example.com',
    );
    expect((await bindings.DATAPAD.getByName(owner).stats()).sockets).toBe(1);
    expect(
      (await bindings.DATAPAD.getByName('victim@example.com').stats()).sockets,
    ).toBe(0);
    ws.close(1000, 'done');
  });
});

describe('live sync', () => {
  it('sends a snapshot on connect', async () => {
    const inbox = await openSocket(as('snap@example.com'));
    const message = await inbox.snapshot();
    expect(message.seq).toBe(0);
    expect(message.state.tasks).toEqual({});
    inbox.ws.close(1000);
  });

  it('applies an op, persists it and echoes it with increasing seq', async () => {
    const email = 'ops@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const first = inbox.send(addTask('t1'));
    const echo1 = await inbox.next();
    expect(echo1).toMatchObject({ type: 'op', seq: 1, opId: first });
    if (echo1.type !== 'op') throw new Error();
    expect(echo1.op).toEqual(addTask('t1'));
    expect(Date.parse(echo1.at)).not.toBeNaN();

    inbox.send({ type: 'toggleTask', id: 't1', done: true });
    expect(await inbox.next()).toMatchObject({ type: 'op', seq: 2 });

    const stub = bindings.DATAPAD.getByName(email);
    // The task and the General activity log.
    expect(await stub.stats()).toMatchObject({ docs: 2, seq: 2 });
    await runInDurableObject(stub, async (_i: DatapadObject, state) => {
      const row = state.storage.sql
        .exec<{ json: string }>(
          "SELECT json FROM docs WHERE col = 'tasks' AND id = 't1'",
        )
        .one();
      expect(JSON.parse(row.json)).toMatchObject({
        title: 'Heaters',
        status: 'done',
      });
    });
    inbox.ws.close(1000);
  });

  it('rejects an impossible op and leaves storage untouched', async () => {
    const email = 'reject@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const opId = inbox.send({ type: 'deleteTask', id: 'ghost' });
    expect(await inbox.next()).toEqual({
      type: 'rejected',
      opId,
      reason: 'That task no longer exists',
    });
    const invalid = inbox.send({
      type: 'addTask',
      id: 't1',
      projectId: null,
      title: 'x'.repeat(LIMITS.titleMax + 1),
    });
    expect(await inbox.next()).toEqual({
      type: 'rejected',
      opId: invalid,
      reason: `Title is too long (${LIMITS.titleMax} characters at most)`,
    });
    expect(await bindings.DATAPAD.getByName(email).stats()).toMatchObject({
      docs: 0,
      seq: 0,
    });
    inbox.ws.close(1000);
  });

  it('refuses a message over the size limit with a readable reason', async () => {
    const email = 'huge@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const opId = inbox.send({
      type: 'addNote',
      id: 'n1',
      projectId: null,
      body: 'x'.repeat(LIMITS.messageBytes),
    });
    expect(await inbox.next()).toEqual({
      type: 'rejected',
      opId,
      reason: 'That change is too large to save',
    });
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(0);
    inbox.ws.close(1000);
  });

  it('sends every op to every socket, the sender’s included', async () => {
    const email = 'fanout@example.com';
    const a = await openSocket(as(email));
    const b = await openSocket(as(email));
    await a.snapshot();
    await b.snapshot();
    const opId = a.send(addTask('t1'));
    for (const inbox of [a, b]) {
      expect(await inbox.next()).toMatchObject({ type: 'op', seq: 1, opId });
    }
    b.send(addTask('t2', 'Doors'));
    for (const inbox of [a, b]) {
      expect(await inbox.next()).toMatchObject({ type: 'op', seq: 2 });
    }
    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('answers sync with a fresh snapshot', async () => {
    const inbox = await openSocket(as('resync@example.com'));
    await inbox.snapshot();
    const opId = inbox.send(addTask('t1'));
    await inbox.next();
    inbox.ws.send(JSON.stringify({ type: 'sync' }));
    const snapshot = await inbox.snapshot();
    expect(snapshot.seq).toBe(1);
    expect(Object.keys(snapshot.state.tasks)).toEqual(['t1']);
    // So a client whose echo got lost drops the op instead of resending it.
    expect(snapshot.recent).toEqual([opId]);
    inbox.ws.close(1000);
  });

  it('acknowledges a replayed op id without applying it twice', async () => {
    const email = 'replay@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const opId = inbox.send(addTask('t1'));
    expect(await inbox.next()).toMatchObject({ type: 'op', seq: 1, opId });
    // The same op again, as an offline queue would resend it after a lost
    // echo, from this socket and from a new one.
    inbox.send(addTask('t1'), opId);
    expect(await inbox.next()).toEqual({ type: 'ack', opId });
    const other = await openSocket(as(email));
    await other.snapshot();
    other.send(addTask('t1'), opId);
    expect(await other.next()).toEqual({ type: 'ack', opId });
    expect(await inbox.quiet()).toBe(true);
    const stub = bindings.DATAPAD.getByName(email);
    expect((await stub.stats()).seq).toBe(1);
    expect(Object.keys((await stub.export(MAIN_SPACE)).tasks)).toEqual(['t1']);
    inbox.ws.close(1000);
    other.ws.close(1000);
  });

  it('remembers the last 1 000 op ids across a restart', async () => {
    const email = 'kept@example.com';
    const stub = bindings.DATAPAD.getByName(email);
    const ids = await runInDurableObject(stub, async (o, state) => {
      const commit = (
        o as unknown as {
          commit: (
            space: string,
            n: Snapshot,
            c: [],
            at: string,
            opId: string,
          ) => void;
        }
      ).commit.bind(o);
      const now = new Date().toISOString();
      for (let i = 0; i < LIMITS.opIdsKept + 5; i += 1) {
        commit(
          MAIN_SPACE,
          (await o.export(MAIN_SPACE)) as unknown as Snapshot,
          [],
          now,
          `op-${i}`,
        );
      }
      return state.storage.sql
        .exec<{ op_id: string }>('SELECT op_id FROM op_ids ORDER BY seq')
        .toArray()
        .map((r) => r.op_id);
    });
    expect(ids).toHaveLength(LIMITS.opIdsKept);
    expect(ids[0]).toBe('op-5');
    expect(ids.at(-1)).toBe(`op-${LIMITS.opIdsKept + 4}`);
  });

  it('refuses a flood and does not persist it', async () => {
    const email = 'flood@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const total = LIMITS.opsPerSecond + 5;
    for (let i = 0; i < total; i += 1) {
      inbox.send(addTask(`t${i}`, `Task ${i}`));
    }
    let applied = 0;
    let refused = 0;
    for (let i = 0; i < total; i += 1) {
      const message = await inbox.next();
      if (message.type === 'op') applied += 1;
      if (message.type === 'rejected') {
        refused += 1;
        expect(message.reason).toBe(
          'Too many changes at once. Try that again.',
        );
      }
    }
    expect(applied).toBe(LIMITS.opsPerSecond);
    expect(refused).toBe(5);
    const stub = bindings.DATAPAD.getByName(email);
    expect((await stub.stats()).seq).toBe(LIMITS.opsPerSecond);
    const tasks = Object.keys((await stub.export(MAIN_SPACE)).tasks);
    expect(tasks).toHaveLength(LIMITS.opsPerSecond);
    inbox.ws.close(1000);
  });

  it('keeps its state when the object is evicted', async () => {
    const email = 'evict@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    inbox.send({ type: 'createProject', id: 'p1', name: 'Echo Base' });
    inbox.send({
      type: 'addTask',
      id: 't1',
      projectId: 'p1',
      title: 'Heaters',
    });
    await inbox.next();
    await inbox.next();
    inbox.ws.close(1000);

    const before = await bindings.DATAPAD.getByName(email).export(MAIN_SPACE);
    // A new instance over the same storage is what waking up looks like.
    await runInDurableObject(
      bindings.DATAPAD.getByName(email),
      async (_i: DatapadObject, state) => {
        const revived = new DatapadObject(state, bindings);
        await state.blockConcurrencyWhile(async () => {});
        const after = await revived.export(MAIN_SPACE);
        expect({ ...after, exportedAt: '' }).toEqual({
          ...before,
          exportedAt: '',
        });
        expect((await revived.stats()).seq).toBe(2);
      },
    );
    // And a new stub with the same name reaches the same data.
    const again = await openSocket(as(email));
    const snapshot = await again.snapshot();
    expect(snapshot.seq).toBe(2);
    expect(snapshot.state.tasks.t1?.title).toBe('Heaters');
    again.ws.close(1000);
  });
});

describe('export and import', () => {
  const { exportedAt: _, ...documents } = fixture;

  it('imports the artifact’s export and exports the same documents', async () => {
    const email = 'roundtrip@example.com';
    const response = await post(email, '/api/import', fixture);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: {
        projects: 3,
        tasks: 7,
        notes: 4,
        events: 4,
        people: 4,
        activity: 4,
        settings: 0,
        decisions: 0,
        orgs: 0,
        templates: 0,
      },
    });
    const exported = await get(email, '/api/export.json');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toMatch(
      /^attachment; filename="datapad-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const file = (await exported.json()) as Snapshot & { exportedAt: string };
    expect(Object.keys(file)).toEqual([
      'exportedAt',
      'projects',
      'tasks',
      'notes',
      'people',
      'activity',
      'events',
      'settings',
      'decisions',
      'orgs',
      'templates',
    ]);
    const { exportedAt, ...back } = file;
    expect(Date.parse(exportedAt)).not.toBeNaN();
    // The artifact's documents unchanged, plus Datapad's (empty) settings and decisions.
    expect(back).toEqual({
      ...documents,
      settings: {},
      decisions: {},
      orgs: {},
      templates: {},
    });
  });

  it('merges by id, so importing twice changes nothing', async () => {
    const email = 'twice@example.com';
    await post(email, '/api/import', fixture);
    await post(email, '/api/import', fixture);
    const stats = await bindings.DATAPAD.getByName(email).stats();
    expect(stats.docs).toBe(26);
  });

  it('sends open sockets a fresh snapshot after an import', async () => {
    const email = 'import-live@example.com';
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    await post(email, '/api/import', fixture);
    const snapshot = await inbox.snapshot();
    expect(Object.keys(snapshot.state.projects)).toHaveLength(3);
    inbox.ws.close(1000);
  });

  it('refuses a malformed file with the first problem and writes nothing', async () => {
    const email = 'malformed@example.com';
    const broken = {
      ...fixture,
      tasks: {
        ...fixture.tasks,
        't-2': { ...fixture.tasks['t-2'], title: '' },
      },
    };
    const response = await post(email, '/api/import', broken);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'tasks › t-2 › title: Title is required',
    });
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(0);

    const notJson = await post(email, '/api/import', '{nope');
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'That file is not JSON' });
  });

  it('refuses cross-site writes', async () => {
    const email = 'csrf@example.com';
    const foreign = await post(email, '/api/import', fixture, {
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
    });
    expect(foreign.status).toBe(403);
    const form = await post(email, '/api/import', JSON.stringify(fixture), {
      headers: { 'content-type': 'text/plain' },
    });
    expect(form.status).toBe(415);
    const wrongMethod = await get(email, '/api/import');
    expect(wrongMethod.status).toBe(405);
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(0);
  });

  it('imports 2 000 tasks quickly, in one transaction', async () => {
    const email = 'bulk@example.com';
    const tasks: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i += 1) {
      tasks[`t-${i}`] = {
        ...fixture.tasks['t-1'],
        id: `t-${i}`,
        title: `Task ${i}`,
        order: i + 1,
      };
    }
    const started = Date.now();
    const response = await post(email, '/api/import', { tasks });
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
    // One transaction: one sequence number for the whole file.
    expect(await bindings.DATAPAD.getByName(email).stats()).toMatchObject({
      docs: 2000,
      seq: 1,
    });
  });
});

describe('erase', () => {
  it('deletes everything only with a fresh token', async () => {
    const email = 'erase@example.com';
    await post(email, '/api/import', fixture);
    const stub = bindings.DATAPAD.getByName(email);

    expect((await post(email, '/api/erase', {})).status).toBe(403);
    expect((await post(email, '/api/erase', { token: 'guess' })).status).toBe(
      403,
    );
    expect((await stub.stats()).docs).toBe(26);

    const { token } = (await (await get(email, '/api/erase-token')).json()) as {
      token: string;
    };
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    const response = await post(email, '/api/erase', { token });
    expect(response.status).toBe(200);
    expect((await stub.stats()).docs).toBe(0);
    expect((await inbox.snapshot()).state.projects).toEqual({});
    // Used up.
    expect((await post(email, '/api/erase', { token })).status).toBe(403);
    inbox.ws.close(1000);
  });

  it('a wrong guess uses the token up', async () => {
    const email = 'erase-guess@example.com';
    await post(email, '/api/import', fixture);
    const { token } = (await (await get(email, '/api/erase-token')).json()) as {
      token: string;
    };
    expect((await post(email, '/api/erase', { token: 'x' })).status).toBe(403);
    expect((await post(email, '/api/erase', { token })).status).toBe(403);
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(26);
  });
});

/**
 * A second space, written straight into storage (creating one over the API
 * comes later), then reloaded the way a wake would.
 */
async function addSpace(email: string, id: string, position = 1) {
  const stub = bindings.DATAPAD.getByName(email);
  await runInDurableObject(stub, async (o: DatapadObject, state) => {
    state.storage.sql.exec(
      'INSERT INTO spaces (id, name, position, seq, created_at) VALUES (?, ?, ?, 0, ?)',
      id,
      `Space ${id}`,
      position,
      '2026-10-01T00:00:00.000Z',
    );
    (o as unknown as { load: () => void }).load();
  });
  return stub;
}

describe('spaces', () => {
  it('keeps ops, seq and snapshots to their own space', async () => {
    const email = 'two-spaces@example.com';
    await addSpace(email, 'hoth');
    const a = await openSocket(as(email));
    const b = await openSocket(as(email), 'http://datapad.test/ws?space=hoth');
    const first = await a.snapshot();
    expect(first.space).toBe(MAIN_SPACE);
    expect(first.spaces.map((s) => s.id)).toEqual([MAIN_SPACE, 'hoth']);
    expect((await b.snapshot()).space).toBe('hoth');

    const opId = a.send(addTask('t1'));
    expect(await a.next()).toMatchObject({ type: 'op', seq: 1, opId });
    expect(await b.quiet()).toBe(true);
    a.send(addTask('t2', 'Doors'));
    expect(await a.next()).toMatchObject({ type: 'op', seq: 2 });

    // Each space counts its own changes from zero.
    b.send(addTask('t9', 'Scanners'));
    expect(await b.next()).toMatchObject({ type: 'op', seq: 1 });
    expect(await a.quiet()).toBe(true);

    b.ws.send(JSON.stringify({ type: 'sync' }));
    const hoth = await b.snapshot();
    expect(hoth.space).toBe('hoth');
    expect(hoth.seq).toBe(1);
    expect(Object.keys(hoth.state.tasks)).toEqual(['t9']);

    const stub = bindings.DATAPAD.getByName(email);
    expect(Object.keys((await stub.export(MAIN_SPACE)).tasks).sort()).toEqual([
      't1',
      't2',
    ]);
    expect((await stub.stats()).seq).toBe(3);
    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('keeps a socket on its space across a wake', async () => {
    const email = 'space-wake@example.com';
    const stub = await addSpace(email, 'hoth');
    const b = await openSocket(as(email), 'http://datapad.test/ws?space=hoth');
    await b.snapshot();
    // The attachment is what a woken object reads the space from.
    await runInDurableObject(stub, async (o: DatapadObject, state) => {
      (o as unknown as { load: () => void }).load();
      const [socket] = state.getWebSockets();
      expect(socket?.deserializeAttachment()).toEqual({ space: 'hoth' });
    });
    b.send(addTask('t1'));
    expect(await b.next()).toMatchObject({ type: 'op', seq: 1 });
    expect((await stub.export('hoth')).tasks.t1).toBeDefined();
    expect((await stub.export(MAIN_SPACE)).tasks).toEqual({});
    b.ws.close(1000);
  });

  it('opens the first space for an unknown or missing one, and says so', async () => {
    const email = 'space-fallback@example.com';
    // Main moved after `hoth`, so `hoth` is the first space: a socket that
    // asks for nothing it has lands there.
    const stub = await addSpace(email, 'hoth', 0);
    await runInDurableObject(stub, async (o: DatapadObject, state) => {
      state.storage.sql.exec(
        'UPDATE spaces SET position = 1 WHERE id = ?',
        MAIN_SPACE,
      );
      (o as unknown as { load: () => void }).load();
    });
    for (const url of [
      'http://datapad.test/ws?space=nowhere',
      'http://datapad.test/ws',
    ]) {
      const inbox = await openSocket(as(email), url);
      const snapshot = await inbox.snapshot();
      expect(snapshot.space).toBe('hoth');
      expect(snapshot.spaces.map((s) => s.id)).toEqual(['hoth', MAIN_SPACE]);
      inbox.ws.close(1000);
    }
  });

  it('scopes export and import, and refuses an unknown space', async () => {
    const email = 'space-import@example.com';
    await addSpace(email, 'hoth');
    const listener = await openSocket(as(email));
    await listener.snapshot();
    const imported = await post(email, '/api/import?space=hoth', fixture);
    expect(imported.status).toBe(200);
    // Main's socket hears nothing of hoth's import.
    expect(await listener.quiet()).toBe(true);
    listener.ws.close(1000);

    const hoth = (await (
      await get(email, '/api/export.json?space=hoth')
    ).json()) as Snapshot;
    expect(Object.keys(hoth.projects)).toHaveLength(3);
    const main = (await (
      await get(email, '/api/export.json')
    ).json()) as Snapshot;
    expect(main.projects).toEqual({});

    for (const response of [
      await get(email, '/api/export.json?space=nowhere'),
      await post(email, '/api/import?space=nowhere', fixture),
      await get(email, '/api/backups?space=nowhere'),
      await get(email, '/api/backups/2026-01-01.json?space=nowhere'),
      await get(email, '/api/erase-token?space=nowhere'),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'No such space' });
    }
  });

  it('erases one space and leaves the others', async () => {
    const email = 'space-erase@example.com';
    const stub = await addSpace(email, 'hoth');
    await post(email, '/api/import', fixture);
    await post(email, '/api/import?space=hoth', fixture);
    expect((await stub.stats()).docs).toBe(52);

    // A token issued for main cannot erase hoth.
    const issued = (await (await get(email, '/api/erase-token')).json()) as {
      token: string;
    };
    const wrong = await post(email, '/api/erase?space=hoth', {
      token: issued.token,
    });
    expect(wrong.status).toBe(403);
    expect((await stub.stats()).docs).toBe(52);

    const { token } = (await (
      await get(email, '/api/erase-token?space=hoth')
    ).json()) as { token: string };
    const erased = await post(email, '/api/erase?space=hoth', { token });
    expect(erased.status).toBe(200);
    expect((await stub.stats()).docs).toBe(26);
    expect((await stub.export('hoth')).projects).toEqual({});
    expect(Object.keys((await stub.export(MAIN_SPACE)).projects)).toHaveLength(
      3,
    );
    // The space itself stays.
    expect((await stub.listSpaces()).spaces.map((s) => s.id)).toEqual([
      MAIN_SPACE,
      'hoth',
    ]);
  });
});
