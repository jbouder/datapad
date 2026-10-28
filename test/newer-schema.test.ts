import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Op } from '#shared/protocol';
import { MAIN_SPACE } from '#shared/types';
import { DatapadObject, NEWER_SCHEMA } from '../worker/datapad';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';

/**
 * A Worker rolled back past a schema bump (#227): storage written by a
 * newer version has a `schema_version` above this code's. The object must
 * refuse to start, so it reads and writes nothing.
 */

const bindings = env as unknown as Bindings;
const NEWER = '99';

const addTask = (id: string): Op => ({
  type: 'addTask',
  id,
  projectId: null,
  title: 'Heaters',
});

/** The message a call fails with (awaited here, so never unhandled). */
async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'resolved';
}

function as(email: string) {
  return createHandler(async () => ({ email }));
}

/** Every table and row, and the alarm: what "nothing written" compares. */
function dump(state: DurableObjectState) {
  const sql = state.storage.sql;
  const tables = sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' ORDER BY name",
    )
    .toArray()
    .map((r) => r.name);
  return Object.fromEntries(
    tables.map((t) => [t, sql.exec(`SELECT * FROM "${t}"`).toArray()]),
  );
}

/** A user with one task, whose storage is then marked as from a newer version. */
async function rolledBack(email: string) {
  const stub = bindings.DATAPAD.getByName(email);
  const applied = await stub.apply(MAIN_SPACE, 'op-1', [addTask('t1')]);
  expect(applied.ok).toBe(true);
  await runInDurableObject(stub, (_o, state) => {
    state.storage.sql.exec(
      "UPDATE meta SET value = ? WHERE key = 'schema_version'",
      NEWER,
    );
  });
  // Restart the object, as a deploy would: the next call constructs it.
  await runInDurableObject(stub, (_o, state) => state.abort('rolled back'))
    .then(() => {
      throw new Error('abort() should throw');
    })
    .catch((error: Error) => expect(error.message).toBe('rolled back'));
}

describe('a newer stored schema', () => {
  it('stops the constructor before it loads, creates or books anything', async () => {
    const stub = bindings.DATAPAD.getByName('newer-ctor@example.com');
    await stub.apply(MAIN_SPACE, 'op-1', [addTask('t1')]);
    await runInDurableObject(stub, async (_o, state) => {
      const sql = state.storage.sql;
      sql.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", NEWER);
      // A newer layout may have dropped tables this code would create.
      sql.exec('DROP TABLE op_ids');
      sql.exec('DROP TABLE mcp_clients');
      await state.storage.deleteAlarm();
      const before = dump(state);

      // The real constructor, with its startup caught rather than left to
      // break this (live) object's input gate.
      let startup: Promise<unknown> = Promise.resolve();
      Object.defineProperty(state, 'blockConcurrencyWhile', {
        configurable: true,
        value: (fn: () => Promise<unknown>) => {
          startup = fn();
          return startup.catch(() => {});
        },
      });
      let revived: DatapadObject;
      try {
        revived = new DatapadObject(state, bindings);
      } finally {
        Reflect.deleteProperty(state, 'blockConcurrencyWhile');
      }
      await expect(startup).rejects.toThrow(NEWER_SCHEMA);

      expect(dump(state)).toEqual(before);
      expect(await state.storage.getAlarm()).toBeNull();
      // Nothing was loaded.
      expect(await revived.listSpaces()).toEqual({ spaces: [] });
      expect(await revived.hasSpace(MAIN_SPACE)).toBe(false);
    });
  });

  it('refuses every RPC and the alarm, and backs nothing up', async () => {
    const email = 'newer-rpc@example.com';
    await rolledBack(email);
    const stub = () => bindings.DATAPAD.getByName(email);

    const calls: Record<string, () => Promise<unknown>> = {
      ping: () => stub().ping(),
      snapshot: () => stub().snapshot(MAIN_SPACE),
      apply: () => stub().apply(MAIN_SPACE, 'op-2', [addTask('t2')]),
      listSpaces: () => stub().listSpaces(),
      createSpace: () => stub().createSpace('Work'),
      export: () => stub().export(MAIN_SPACE),
      eraseToken: () => stub().eraseToken(MAIN_SPACE),
      backups: () => stub().backups(MAIN_SPACE),
      alarm: () => runDurableObjectAlarm(stub()),
    };
    for (const [name, call] of Object.entries(calls)) {
      expect(await refusal(call), name).toBe(NEWER_SCHEMA);
    }

    const listed = await bindings.BACKUPS.list({ prefix: `${email}/` });
    expect(listed.objects).toEqual([]);
  });

  it('answers health, the API and the socket with the reason', async () => {
    const email = 'newer-http@example.com';
    await rolledBack(email);
    const handle = as(email);
    const request = (path: string, init?: RequestInit) =>
      handle(new Request(`http://datapad.test${path}`, init), bindings);

    const health = await request('/api/health');
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, error: NEWER_SCHEMA });

    for (const path of ['/api/spaces', '/api/export.json', '/api/backups']) {
      const response = await request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toEqual({ error: NEWER_SCHEMA });
    }

    const socket = await request('/ws', { headers: { Upgrade: 'websocket' } });
    expect(socket.status).toBe(503);
    expect(socket.webSocket).toBeNull();
    expect(await socket.json()).toEqual({ error: NEWER_SCHEMA });
  });
});
