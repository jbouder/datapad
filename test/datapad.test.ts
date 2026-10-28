import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import {
  type CreatedSpace,
  type Op,
  type ServerMessage,
  SPACE_DELETED_CLOSE,
  SPACE_DELETED_REASON,
  type SpaceList,
} from '#shared/protocol';
import { MAIN_SPACE, type Snapshot, type SpaceInfo } from '#shared/types';
import { DatapadObject } from '../worker/datapad';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';
import fixture from './fixtures/export.json';
import legacy from './fixtures/legacy-export.json';

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
        // 7, plus one for the meetings migration (schema 3), once.
        expect(await revived.stats()).toMatchObject({ docs: 2, seq: 8 });
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
      ).toBe(8);
    });
  });

  it('turns events into meetings and milestones at schema 3, bumping each space once', async () => {
    const stub = bindings.DATAPAD.getByName('schema2@example.com');
    await runInDurableObject(stub, async (_i: DatapadObject, state) => {
      const sql = state.storage.sql;
      // Storage as schema 2 left it: `events` rows, notes with `eventId`.
      sql.exec('DELETE FROM docs');
      sql.exec('DELETE FROM spaces');
      sql.exec(
        "INSERT INTO spaces VALUES ('main', 'Main', 0, 5, '2026-10-01T00:00:00.000Z')",
      );
      sql.exec(
        "INSERT INTO spaces VALUES ('work', 'Work', 1, 2, '2026-10-01T00:00:00.000Z')",
      );
      sql.exec(
        "INSERT INTO spaces VALUES ('empty', 'Empty', 2, 0, '2026-10-01T00:00:00.000Z')",
      );
      sql.exec("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
      const put = (space: string, col: string, doc: { id: string } & object) =>
        sql.exec(
          "INSERT INTO docs VALUES (?, ?, ?, ?, '2026-10-01')",
          space,
          col,
          doc.id,
          JSON.stringify(doc),
        );
      for (const p of Object.values(legacy.projects))
        put('main', 'projects', p);
      for (const n of Object.values(legacy.notes)) put('main', 'notes', n);
      for (const e of Object.values(legacy.events)) put('main', 'events', e);
      for (const t of Object.values(legacy.tasks)) put('main', 'tasks', t);
      const general = { ...legacy.events['e-1'], projectId: null };
      put('work', 'events', general);

      for (let i = 0; i < 2; i += 1) {
        const revived = new DatapadObject(state, bindings);
        await state.blockConcurrencyWhile(async () => {});
        const main = await revived.export(MAIN_SPACE);
        expect(Object.keys(main.meetings).sort()).toEqual([
          'e-1',
          'e-3',
          'e-4',
        ]);
        expect(main.meetings['e-1']).not.toHaveProperty('type');
        expect(main.meetings['e-4']?.title).toBe(
          'Deadline: Quarterly planning',
        );
        expect(main.projects['p-echo']?.milestones).toEqual([
          { id: 'e-2', title: 'Base operational', date: '2026-11-14' },
        ]);
        expect(main.notes['n-2']).toMatchObject({
          meetingId: 'e-1',
          phase: 'pre',
        });
        expect(main.notes['n-2']).not.toHaveProperty('eventId');
        expect(main.tasks['t-1']).toEqual(legacy.tasks['t-1']);
        const work = await revived.export('work');
        expect(Object.keys(work.meetings)).toEqual(['e-1']);
      }
      expect(
        sql.exec("SELECT id FROM docs WHERE col = 'events'").toArray(),
      ).toEqual([]);
      const seqs = sql
        .exec<{ id: string; seq: number }>(
          'SELECT id, seq FROM spaces ORDER BY position',
        )
        .toArray()
        .map((r) => [r.id, r.seq]);
      // Once each, not once per wake; a space that never changed keeps 0.
      expect(seqs).toEqual([
        ['main', 6],
        ['work', 3],
        ['empty', 0],
      ]);
    });
  });

  it('stores meetings rows in a fresh object', async () => {
    const email = 'fresh-meetings@example.com';
    const stub = bindings.DATAPAD.getByName(email);
    expect(await stub.stats()).toMatchObject({ seq: 0 });
    const inbox = await openSocket(as(email));
    await inbox.snapshot();
    inbox.send({
      type: 'addMeeting',
      id: 'm-1',
      projectId: null,
      title: 'Standup',
      date: '2026-10-27',
    });
    expect(await inbox.next()).toMatchObject({ type: 'op' });
    await runInDurableObject(stub, async (_i: DatapadObject, state) => {
      expect(
        state.storage.sql
          .exec<{ col: string; id: string }>('SELECT col, id FROM docs')
          .toArray()
          .filter((r) => r.col !== 'activity'),
      ).toEqual([{ col: 'meetings', id: 'm-1' }]);
    });
    inbox.ws.close();
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

  it('answers /api/health with reachability and nothing else', async () => {
    const response = await as('leia@example.com')(
      new Request('http://datapad.test/api/health'),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });

    const post = await as('leia@example.com')(
      new Request('http://datapad.test/api/health', { method: 'POST' }),
      bindings,
    );
    expect(post.status).toBe(405);

    // Signed out is 401, like every route: how the app tells a lapsed
    // session from a dropped socket.
    const signedOut = await as(null)(
      new Request('http://datapad.test/api/health'),
      bindings,
    );
    expect(signedOut.status).toBe(401);
  });

  it('answers /api/health with 503 when the object cannot be reached', async () => {
    const down = {
      ...bindings,
      DATAPAD: {
        getByName: () => ({
          ping: () => Promise.reject(new Error('no object')),
        }),
      },
    } as unknown as Bindings;
    const response = await as('leia@example.com')(
      new Request('http://datapad.test/api/health'),
      down,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Datapad is not reachable',
    });
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

  it('refuses a socket opened from another site', async () => {
    for (const origin of [
      'https://evil.datapad.test',
      'http://datapad.test.evil.test',
      'null',
    ]) {
      const response = await as('leia@example.com')(
        new Request('http://datapad.test/ws', {
          headers: { Upgrade: 'websocket', Origin: origin },
        }),
        bindings,
      );
      expect(response.status, origin).toBe(403);
      expect(response.webSocket).toBeNull();
    }
  });

  it('opens a socket from its own page', async () => {
    const response = await as('origin@example.com')(
      new Request('http://datapad.test/ws', {
        headers: { Upgrade: 'websocket', Origin: 'http://datapad.test' },
      }),
      bindings,
    );
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close(1000, 'done');
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
        meetings: 3,
        people: 4,
        activity: 4,
        settings: 0,
        decisions: 0,
        orgs: 0,
        templates: 0,
        boardItems: 0,
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
      'meetings',
      'settings',
      'decisions',
      'orgs',
      'templates',
      'boardItems',
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
      boardItems: {},
    });
  });

  it('keeps decisions through import and export, though they are retired', async () => {
    const email = 'decisions-kept@example.com';
    const decisions = {
      'd-1': {
        id: 'd-1',
        projectId: 'p-echo',
        title: 'Hoth it is',
        rationale: 'Remote.',
        status: 'decided' as const,
        decidedAt: '2026-10-01',
        deciders: ['u-mon'],
        links: [],
        sourceNoteId: 'n-1',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      },
    };
    const response = await post(email, '/api/import', {
      ...fixture,
      decisions,
    });
    expect(response.status).toBe(200);
    const imported = (await response.json()) as {
      imported: Record<string, number>;
    };
    expect(imported.imported.decisions).toBe(1);
    const exported = await get(email, '/api/export.json');
    const file = (await exported.json()) as Snapshot;
    expect(file.decisions).toEqual(decisions);
    // And the exported file imports again, unchanged.
    const again = 'decisions-kept-again@example.com';
    expect((await post(again, '/api/import', file)).status).toBe(200);
    const back = (await (
      await get(again, '/api/export.json')
    ).json()) as Snapshot;
    expect(back.decisions).toEqual(decisions);
  });

  it('merges by id, so importing twice changes nothing', async () => {
    const email = 'twice@example.com';
    await post(email, '/api/import', fixture);
    await post(email, '/api/import', fixture);
    const stats = await bindings.DATAPAD.getByName(email).stats();
    expect(stats.docs).toBe(25);
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
    expect((await stub.stats()).docs).toBe(25);

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
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(25);
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
    expect((await stub.stats()).docs).toBe(50);

    // A token issued for main cannot erase hoth.
    const issued = (await (await get(email, '/api/erase-token')).json()) as {
      token: string;
    };
    const wrong = await post(email, '/api/erase?space=hoth', {
      token: issued.token,
    });
    expect(wrong.status).toBe(403);
    expect((await stub.stats()).docs).toBe(50);

    const { token } = (await (
      await get(email, '/api/erase-token?space=hoth')
    ).json()) as { token: string };
    const erased = await post(email, '/api/erase?space=hoth', { token });
    expect(erased.status).toBe(200);
    expect((await stub.stats()).docs).toBe(25);
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

/** A socket's close code and reason, once the server closes it. */
function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.addEventListener('close', (event) =>
      resolve({ code: event.code, reason: event.reason }),
    ),
  );
}

async function createSpace(email: string, name: string): Promise<SpaceInfo> {
  const response = await post(email, '/api/spaces/create', { name });
  expect(response.status).toBe(200);
  return ((await response.json()) as CreatedSpace).space;
}

async function deleteToken(email: string, space: string): Promise<string> {
  const response = await get(email, `/api/erase-token?space=${space}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

/** `GET /api/spaces`, as names in switcher order. */
async function listed(email: string): Promise<string[]> {
  const { spaces } = (await (
    await get(email, '/api/spaces')
  ).json()) as SpaceList;
  return spaces.map((s) => s.name);
}

describe('the list of spaces', () => {
  it('creates, renames and reorders, and tells every socket', async () => {
    const email = 'space-list@example.com';
    const stub = await addSpace(email, 'hoth');
    const listener = await openSocket(
      as(email),
      'http://datapad.test/ws?space=hoth',
    );
    await listener.snapshot();

    const dagobah = await createSpace(email, '  Dagobah ');
    expect(dagobah).toMatchObject({ name: 'Dagobah', position: 2 });
    expect(dagobah.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await listed(email)).toEqual(['Main', 'Space hoth', 'Dagobah']);
    expect(await listener.next()).toMatchObject({
      type: 'spaces',
      spaces: [{ id: MAIN_SPACE }, { id: 'hoth' }, { id: dagobah.id }],
    });

    const renamed = await post(email, '/api/spaces/rename', {
      id: 'hoth',
      name: 'Hoth',
    });
    expect(renamed.status).toBe(200);
    expect(
      ((await renamed.json()) as SpaceList).spaces.map((s) => s.name),
    ).toEqual(['Main', 'Hoth', 'Dagobah']);
    expect(await listener.next()).toMatchObject({
      type: 'spaces',
      spaces: [{ name: 'Main' }, { name: 'Hoth' }, { name: 'Dagobah' }],
    });
    // Recasing its own name is fine.
    const recased = await post(email, '/api/spaces/rename', {
      id: 'hoth',
      name: 'HOTH',
    });
    expect(recased.status).toBe(200);
    await listener.next();

    const reordered = await post(email, '/api/spaces/reorder', {
      ids: [dagobah.id, MAIN_SPACE, 'hoth'],
    });
    expect(reordered.status).toBe(200);
    expect((await reordered.json()) as SpaceList).toMatchObject({
      spaces: [
        { id: dagobah.id, position: 0 },
        { id: MAIN_SPACE, position: 1 },
        { id: 'hoth', position: 2 },
      ],
    });
    expect(await listener.next()).toMatchObject({
      type: 'spaces',
      spaces: [{ id: dagobah.id }, { id: MAIN_SPACE }, { id: 'hoth' }],
    });
    expect(await listed(email)).toEqual(['Dagobah', 'Main', 'HOTH']);

    // It is all in storage: a wake reads the same list.
    await runInDurableObject(stub, async (o: DatapadObject) => {
      (o as unknown as { load: () => void }).load();
    });
    expect(await listed(email)).toEqual(['Dagobah', 'Main', 'HOTH']);
    listener.ws.close(1000);
  });

  it('refuses a taken name, a bad one, and one space too many', async () => {
    const email = 'space-names@example.com';
    await createSpace(email, 'Endor');
    const refusals: Array<[string, unknown, string]> = [
      [
        '/api/spaces/create',
        { name: 'endor' },
        'There is already a space called endor',
      ],
      [
        '/api/spaces/rename',
        { id: MAIN_SPACE, name: 'ENDOR' },
        'There is already a space called ENDOR',
      ],
      ['/api/spaces/create', { name: '   ' }, 'Name is required'],
      ['/api/spaces/create', {}, 'Name is required'],
      ['/api/spaces/create', '{nope', 'That file is not JSON'],
    ];
    for (const [path, body, error] of refusals) {
      const response = await post(email, path, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
    }
    const long = await post(email, '/api/spaces/create', {
      name: 'x'.repeat(LIMITS.spaceNameMax + 1),
    });
    expect(long.status).toBe(400);
    expect(await long.json()).toHaveProperty('error');

    for (let i = 2; i < LIMITS.spacesMax; i += 1) {
      await createSpace(email, `Moon ${i}`);
    }
    const over = await post(email, '/api/spaces/create', { name: 'One more' });
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({
      error: `You can have ${LIMITS.spacesMax} spaces at most`,
    });
    expect(await listed(email)).toHaveLength(LIMITS.spacesMax);
  });

  it('reorders only by every current space, once each', async () => {
    const email = 'space-reorder@example.com';
    await addSpace(email, 'hoth');
    for (const ids of [
      [MAIN_SPACE],
      ['hoth', MAIN_SPACE, 'bespin'],
      ['hoth', 'bespin'],
      ['hoth', 'hoth'],
      [],
    ]) {
      const response = await post(email, '/api/spaces/reorder', { ids });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error');
    }
    expect(await listed(email)).toEqual(['Main', 'Space hoth']);
  });

  it('opens a new space empty and keeps its ops to itself', async () => {
    const email = 'space-new@example.com';
    const main = await openSocket(as(email));
    await main.snapshot();
    const { id } = await createSpace(email, 'Bespin');
    expect(await main.next()).toMatchObject({ type: 'spaces' });

    const fresh = await openSocket(
      as(email),
      `http://datapad.test/ws?space=${id}`,
    );
    const snapshot = await fresh.snapshot();
    expect(snapshot).toMatchObject({ space: id, seq: 0 });
    expect(snapshot.state.tasks).toEqual({});
    fresh.send(addTask('t1'));
    expect(await fresh.next()).toMatchObject({ type: 'op', seq: 1 });
    expect(await main.quiet()).toBe(true);
    const stub = bindings.DATAPAD.getByName(email);
    expect((await stub.export(id)).tasks.t1).toBeDefined();
    expect((await stub.export(MAIN_SPACE)).tasks).toEqual({});
    main.ws.close(1000);
    fresh.ws.close(1000);
  });

  it('deletes a space only with a fresh token issued for it', async () => {
    const email = 'space-delete@example.com';
    const stub = bindings.DATAPAD.getByName(email);
    const { id } = await createSpace(email, 'Kessel');
    await post(email, '/api/import', fixture);
    await post(email, `/api/import?space=${id}`, fixture);
    expect((await stub.stats()).docs).toBe(50);
    const { exportedAt: _before, ...mainBefore } =
      await stub.export(MAIN_SPACE);

    // A token for main cannot delete Kessel, and is used up trying.
    const forMain = await deleteToken(email, MAIN_SPACE);
    const crossed = await post(email, '/api/spaces/delete', {
      id,
      token: forMain,
    });
    expect(crossed.status).toBe(403);
    expect(await crossed.json()).toEqual({
      error: 'That confirmation has expired. Ask for a new one.',
    });
    expect((await post(email, '/api/erase', { token: forMain })).status).toBe(
      403,
    );

    // A wrong guess uses the right token up.
    const guessed = await deleteToken(email, id);
    const guess = await post(email, '/api/spaces/delete', { id, token: 'x' });
    expect(guess.status).toBe(403);
    const late = await post(email, '/api/spaces/delete', {
      id,
      token: guessed,
    });
    expect(late.status).toBe(403);
    expect((await stub.stats()).docs).toBe(50);

    const onKessel = await openSocket(
      as(email),
      `http://datapad.test/ws?space=${id}`,
    );
    await onKessel.snapshot();
    const onMain = await openSocket(as(email));
    await onMain.snapshot();
    const closing = closed(onKessel.ws);

    const token = await deleteToken(email, id);
    const deleted = await post(email, '/api/spaces/delete', { id, token });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(await closing).toEqual({
      code: SPACE_DELETED_CLOSE,
      reason: SPACE_DELETED_REASON,
    });
    // Closed before anything else: it never heard the new list.
    expect(await onKessel.quiet()).toBe(true);
    expect(await onMain.next()).toEqual({
      type: 'spaces',
      spaces: (await stub.listSpaces()).spaces,
    });

    expect(await listed(email)).toEqual(['Main']);
    expect(await stub.hasSpace(id)).toBe(false);
    expect((await stub.stats()).docs).toBe(25);
    const { exportedAt: _after, ...mainAfter } = await stub.export(MAIN_SPACE);
    expect(mainAfter).toEqual(mainBefore);
    await runInDurableObject(stub, async (_o: DatapadObject, state) => {
      const left = state.storage.sql
        .exec<{ n: number }>(
          'SELECT (SELECT COUNT(*) FROM docs WHERE space = ?) + (SELECT COUNT(*) FROM spaces WHERE id = ?) AS n',
          id,
          id,
        )
        .one().n;
      expect(left).toBe(0);
    });
    // The space is gone, and the token with it.
    const again = await post(email, '/api/spaces/delete', { id, token });
    expect(again.status).toBe(404);
    expect((await get(email, `/api/export.json?space=${id}`)).status).toBe(404);
    onMain.ws.close(1000);
  });

  it('refuses to delete the last space, main or not', async () => {
    const email = 'space-last@example.com';
    const { id } = await createSpace(email, 'Yavin');
    await post(email, '/api/import', fixture);
    // Main can go like any space but the last.
    const deleted = await post(email, '/api/spaces/delete', {
      id: MAIN_SPACE,
      token: await deleteToken(email, MAIN_SPACE),
    });
    expect(deleted.status).toBe(200);
    expect(await listed(email)).toEqual(['Yavin']);
    expect((await bindings.DATAPAD.getByName(email).stats()).docs).toBe(0);

    const token = await deleteToken(email, id);
    const last = await post(email, '/api/spaces/delete', { id, token });
    expect(last.status).toBe(400);
    expect(await last.json()).toEqual({
      error: 'This is your only space, so it cannot be deleted',
    });
    // Used up all the same.
    const erase = await post(email, `/api/erase?space=${id}`, { token });
    expect(erase.status).toBe(403);
    expect(await listed(email)).toEqual(['Yavin']);
  });

  it('refuses cross-site writes and unknown spaces', async () => {
    const email = 'space-routes@example.com';
    const routes: Array<[string, unknown]> = [
      ['/api/spaces/create', { name: 'Tatooine' }],
      ['/api/spaces/rename', { id: MAIN_SPACE, name: 'Tatooine' }],
      ['/api/spaces/reorder', { ids: [MAIN_SPACE] }],
      ['/api/spaces/delete', { id: MAIN_SPACE, token: 'x' }],
    ];
    for (const [path, body] of routes) {
      const foreign = await post(email, path, body, {
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        },
      });
      expect(foreign.status).toBe(403);
      const form = await post(email, path, JSON.stringify(body), {
        headers: { 'content-type': 'text/plain' },
      });
      expect(form.status).toBe(415);
      expect((await get(email, path)).status).toBe(405);
    }
    expect(await listed(email)).toEqual(['Main']);

    for (const response of [
      await post(email, '/api/spaces/rename', { id: 'nowhere', name: 'X' }),
      await post(email, '/api/spaces/delete', { id: 'nowhere', token: 'x' }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'No such space' });
    }
  });
});

describe('moving a project', () => {
  it('carries everything in it and copies its people', async () => {
    const email = 'move@example.com';
    await post(email, '/api/import', fixture);
    // Personal already has someone who is `me`.
    const personal = await createSpace(email, 'Personal');
    const op = await openSocket(
      as(email),
      `http://datapad.test/ws?space=${personal.id}`,
    );
    await op.snapshot();
    op.send({ type: 'addPerson', id: 'u-luke', name: 'Luke', me: true });
    expect(await op.next()).toMatchObject({ type: 'op', seq: 1 });

    const onMain = await openSocket(as(email));
    const mainBefore = await onMain.snapshot();
    const response = await post(email, '/api/spaces/move-project', {
      from: MAIN_SPACE,
      to: personal.id,
      id: 'p-echo',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ moved: true });

    // Both spaces' sockets get a fresh snapshot, one change each.
    const main = await onMain.snapshot();
    const there = await op.snapshot();
    expect(main.seq).toBe(mainBefore.seq + 1);
    expect(there.seq).toBe(2);
    expect(there.space).toBe(personal.id);

    // The target has the project and everything in it.
    const moved = there.state;
    expect(moved.projects['p-echo']?.name).toBe('Echo Base relocation');
    expect(Object.keys(moved.tasks).sort()).toEqual([
      't-1',
      't-2',
      't-3',
      't-4',
    ]);
    expect(Object.keys(moved.notes).sort()).toEqual(['n-1', 'n-2']);
    expect(Object.keys(moved.meetings)).toEqual(['e-1']);
    // Its milestones travel inside the project.
    expect(moved.projects['p-echo']?.milestones?.map((m) => m.id)).toEqual([
      'e-2',
    ]);
    expect(moved.activity['p-echo']?.events[0]?.text).toBe('Moved from Main');
    expect(moved.activity['p-echo']?.events.slice(1)).toEqual(
      fixture.activity['p-echo'].events,
    );
    // Its people, copied; Luke stays the only `me`.
    expect(Object.keys(moved.people).sort()).toEqual([
      'u-chewie',
      'u-han',
      'u-leia',
      'u-luke',
    ]);
    expect(
      Object.values(moved.people)
        .filter((p) => p.me)
        .map((p) => p.id),
    ).toEqual(['u-luke']);

    // The source lost the project and kept its people.
    expect(main.state.projects['p-echo']).toBeUndefined();
    expect(Object.keys(main.state.tasks).sort()).toEqual(['t-5', 't-6', 't-7']);
    expect(Object.keys(main.state.notes).sort()).toEqual(['n-3', 'n-4']);
    expect(Object.keys(main.state.meetings).sort()).toEqual(['e-3', 'e-4']);
    expect(main.state.activity['p-echo']).toBeUndefined();
    expect(Object.keys(main.state.people)).toHaveLength(4);
    expect(main.state.people['u-leia']?.me).toBe(true);

    // And so does storage, after a wake.
    const stub = bindings.DATAPAD.getByName(email);
    await runInDurableObject(stub, async (o: DatapadObject) => {
      (o as unknown as { load: () => void }).load();
    });
    expect((await stub.export(personal.id)).tasks['t-1']).toBeDefined();
    expect((await stub.export(MAIN_SPACE)).projects['p-echo']).toBeUndefined();
    op.ws.close(1000);
    onMain.ws.close(1000);
  });

  it('carries a meeting’s topics, intact, through export, import and a move', async () => {
    const email = 'move-topics@example.com';
    const topics = [
      { id: 'tp-1', title: 'Shield power', done: true, outcome: 'Holding' },
      { id: 'tp-2', title: 'North ridge', done: false, outcome: '' },
    ];
    const withTopics = {
      ...fixture,
      meetings: {
        ...fixture.meetings,
        'e-1': { ...fixture.meetings['e-1'], topics },
      },
    };
    expect((await post(email, '/api/import', withTopics)).status).toBe(200);

    // Export, then import that file elsewhere: the same meeting.
    const file = (await (await get(email, '/api/export.json')).json()) as {
      meetings: Snapshot['meetings'];
    };
    expect(file.meetings['e-1']).toEqual(withTopics.meetings['e-1']);
    const copy = 'move-topics-copy@example.com';
    expect((await post(copy, '/api/import', file)).status).toBe(200);
    expect(
      (await bindings.DATAPAD.getByName(copy).export(MAIN_SPACE)).meetings[
        'e-1'
      ],
    ).toEqual(withTopics.meetings['e-1']);

    // Move the project to another space: the topics go with the meeting.
    const personal = await createSpace(email, 'Personal');
    const response = await post(email, '/api/spaces/move-project', {
      from: MAIN_SPACE,
      to: personal.id,
      id: 'p-echo',
    });
    expect(response.status).toBe(200);
    const stub = bindings.DATAPAD.getByName(email);
    expect((await stub.export(personal.id)).meetings['e-1']).toEqual(
      withTopics.meetings['e-1'],
    );
    expect((await stub.export(MAIN_SPACE)).meetings['e-1']).toBeUndefined();
  });

  it('carries a project’s whiteboard through export, import and a move', async () => {
    const email = 'move-board@example.com';
    const sticky = {
      id: 'b-1',
      boardId: 'p-echo',
      kind: 'sticky' as const,
      x: 40,
      y: -80,
      w: 200,
      h: 200,
      z: 2,
      color: 'warn' as const,
      text: 'Shield generator',
      points: [],
    };
    const ink = {
      id: 'b-2',
      boardId: 'p-echo',
      kind: 'ink' as const,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      z: 3,
      color: 'accent' as const,
      text: '',
      points: [0, 0, 12.5, 4, 30, 9],
    };
    const fleet = { ...sticky, id: 'b-3', boardId: 'general', text: 'Fleet' };
    const boardItems = { 'b-1': sticky, 'b-2': ink, 'b-3': fleet };
    const response = await post(email, '/api/import', {
      ...fixture,
      boardItems,
    });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { imported: Record<string, number> }).imported
        .boardItems,
    ).toBe(3);

    // Export, then import that file elsewhere: the same items.
    const file = (await (await get(email, '/api/export.json')).json()) as {
      boardItems: Snapshot['boardItems'];
    };
    expect(file.boardItems).toEqual(boardItems);
    const copy = 'move-board-copy@example.com';
    expect((await post(copy, '/api/import', file)).status).toBe(200);
    expect(
      (await bindings.DATAPAD.getByName(copy).export(MAIN_SPACE)).boardItems,
    ).toEqual(boardItems);

    // Move the project: its board goes, the space board stays.
    const personal = await createSpace(email, 'Personal');
    expect(
      (
        await post(email, '/api/spaces/move-project', {
          from: MAIN_SPACE,
          to: personal.id,
          id: 'p-echo',
        })
      ).status,
    ).toBe(200);
    const stub = bindings.DATAPAD.getByName(email);
    expect((await stub.export(personal.id)).boardItems).toEqual({
      'b-1': sticky,
      'b-2': ink,
    });
    expect((await stub.export(MAIN_SPACE)).boardItems).toEqual({
      'b-3': fleet,
    });
  });

  it('carries decisions and copies the org and its contacts', async () => {
    const email = 'move-org@example.com';
    const personal = await createSpace(email, 'Personal');
    await post(email, '/api/import', {
      ...fixture,
      people: {
        ...fixture.people,
        'u-ackbar': { id: 'u-ackbar', name: 'Ackbar', role: '', me: false },
      },
      orgs: {
        'o-rebels': {
          id: 'o-rebels',
          name: 'Rebel Alliance',
          kind: 'client',
          links: [],
          notes: '',
          contacts: ['u-ackbar'],
          archived: false,
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-01T09:00:00.000Z',
        },
      },
      decisions: {
        'd-1': {
          id: 'd-1',
          projectId: 'p-echo',
          title: 'Hoth it is',
          rationale: 'Remote.',
          status: 'decided',
          decidedAt: '2026-10-01',
          deciders: ['u-mon'],
          links: [],
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-01T09:00:00.000Z',
        },
      },
    });
    const response = await post(email, '/api/spaces/move-project', {
      from: MAIN_SPACE,
      to: personal.id,
      id: 'p-echo',
    });
    expect(response.status).toBe(200);
    const stub = bindings.DATAPAD.getByName(email);
    const there = await stub.export(personal.id);
    expect(Object.keys(there.decisions)).toEqual(['d-1']);
    expect(Object.keys(there.orgs)).toEqual(['o-rebels']);
    expect(there.projects['p-echo']?.orgId).toBe('o-rebels');
    expect(there.people['u-ackbar']).toBeDefined();
    expect(there.people['u-mon']).toBeDefined();
    const main = await stub.export(MAIN_SPACE);
    expect(main.decisions).toEqual({});
    expect(Object.keys(main.orgs)).toEqual(['o-rebels']);
  });

  it('refuses an unknown space, a missing project, the same space and cross-site', async () => {
    const email = 'move-refused@example.com';
    await post(email, '/api/import', fixture);
    const personal = await createSpace(email, 'Personal');
    const stub = bindings.DATAPAD.getByName(email);
    const before = await stub.stats();

    for (const body of [
      { from: MAIN_SPACE, to: 'nowhere', id: 'p-echo' },
      { from: 'nowhere', to: personal.id, id: 'p-echo' },
    ]) {
      const response = await post(email, '/api/spaces/move-project', body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'No such space' });
    }

    const missing = await post(email, '/api/spaces/move-project', {
      from: MAIN_SPACE,
      to: personal.id,
      id: 'p-gone',
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: 'That project no longer exists',
    });

    const same = await post(email, '/api/spaces/move-project', {
      from: MAIN_SPACE,
      to: MAIN_SPACE,
      id: 'p-echo',
    });
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: 'To: Pick another space' });
    // The object refuses it too, should anything call it directly.
    expect(await stub.moveProject(MAIN_SPACE, MAIN_SPACE, 'p-echo')).toEqual({
      ok: false,
      error: 'Pick another space',
    });

    const body = { from: MAIN_SPACE, to: personal.id, id: 'p-echo' };
    const foreign = await post(email, '/api/spaces/move-project', body, {
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
    });
    expect(foreign.status).toBe(403);
    const form = await post(
      email,
      '/api/spaces/move-project',
      JSON.stringify(body),
      { headers: { 'content-type': 'text/plain' } },
    );
    expect(form.status).toBe(415);
    expect((await get(email, '/api/spaces/move-project')).status).toBe(405);

    // Nothing moved.
    expect(await stub.stats()).toEqual(before);
    expect((await stub.export(MAIN_SPACE)).projects['p-echo']).toBeDefined();
  });
});

describe('MCP support (#152)', () => {
  it('summarises every space with its counts, in order', async () => {
    const stub = bindings.DATAPAD.getByName('summaries@example.com');
    expect((await stub.import(MAIN_SPACE, fixture)).ok).toBe(true);
    const created = await stub.createSpace('Side');
    expect(created.ok).toBe(true);
    const summaries = await stub.spaceSummaries();
    expect(summaries.map((s) => s.name)).toEqual(['Main', 'Side']);
    expect(summaries[0]?.counts).toMatchObject({ projects: 2, tasks: 7 });
    expect(summaries[1]?.counts).toMatchObject({ projects: 0, tasks: 0 });
  });

  it('admits mcpCallsPerMinute calls per token key, then refuses until the minute passes', async () => {
    const stub = bindings.DATAPAD.getByName('ratelimit@example.com');
    const t0 = 1_000_000;
    for (let i = 0; i < LIMITS.mcpCallsPerMinute; i++) {
      expect(await stub.admitMcpCall('a', t0 + i)).toBe(true);
    }
    expect(await stub.admitMcpCall('a', t0 + 100)).toBe(false);
    expect(await stub.admitMcpCall('b', t0 + 100)).toBe(true);
    expect(await stub.admitMcpCall('a', t0 + 60_001)).toBe(true);
  });
});
