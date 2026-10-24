import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { DatapadObject } from '../worker/datapad';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';

const bindings = env as unknown as Bindings;

/** A handler where Access says this request is `email` (or nobody). */
function as(email: string | null) {
  return createHandler(async () => (email ? { email } : null));
}

async function openSocket(
  handle: ReturnType<typeof as>,
  url = 'http://datapad.test/ws',
): Promise<WebSocket> {
  const response = await handle(
    new Request(url, { headers: { Upgrade: 'websocket' } }),
    bindings,
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (!ws) throw new Error('No socket');
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => resolve(String(event.data)), {
      once: true,
    });
  });
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
      expect(tables).toEqual(expect.arrayContaining(['docs', 'meta']));
      const columns = state.storage.sql
        .exec<{ name: string; pk: number }>("PRAGMA table_info('docs')")
        .toArray();
      expect(columns.map((c) => c.name)).toEqual([
        'col',
        'id',
        'json',
        'updated_at',
      ]);
      expect(columns.filter((c) => c.pk > 0).map((c) => c.name)).toEqual([
        'col',
        'id',
      ]);
    });
    expect(await stub.stats()).toEqual({ docs: 0, seq: 0, sockets: 0 });
  });

  it('keeps each user in their own object', async () => {
    const leia = bindings.DATAPAD.getByName('leia@example.com');
    await runInDurableObject(leia, async (_i: DatapadObject, state) => {
      state.storage.sql.exec(
        "INSERT INTO docs VALUES ('task', 't1', '{}', '2026-10-23')",
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
    const ws = await openSocket(as(email));
    const reply = nextMessage(ws);
    ws.send('ping');
    expect(await reply).toBe('pong');
    expect((await bindings.DATAPAD.getByName(email).stats()).sockets).toBe(1);
    ws.close(1000, 'done');
  });

  it('never lets the request choose another object', async () => {
    const owner = 'owner@example.com';
    const ws = await openSocket(
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
