import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import type { BackupInfo } from '#shared/protocol';
import { MAIN_SPACE } from '#shared/types';
import type { DatapadObject } from '../worker/datapad';
import type { Bindings } from '../worker/env';
import { createHandler } from '../worker/index';
import fixture from './fixtures/export.json';
import legacy from './fixtures/legacy-export.json';

const bindings = env as unknown as Bindings;

function as(email: string) {
  return createHandler(async () => ({ email }));
}

/** A fresh user with the fictional export imported. */
async function seeded() {
  const email = `${crypto.randomUUID()}@example.com`;
  const stub = bindings.DATAPAD.getByName(email);
  const outcome = await stub.import(MAIN_SPACE, fixture);
  expect(outcome.ok).toBe(true);
  return { email, stub };
}

/** Enough of a socket on `space` for `applyOp`, which reads and echoes. */
function socketOn(space: string) {
  return { deserializeAttachment: () => ({ space }), send() {} };
}

async function keys(email: string): Promise<string[]> {
  const listed = await bindings.BACKUPS.list({ prefix: `${email}/` });
  return listed.objects.map((o) => o.key).sort();
}

function last(stub: DurableObjectStub<DatapadObject>) {
  return runInDurableObject(
    stub,
    (_o, state) =>
      state.storage.sql
        .exec<{ value: string }>(
          "SELECT value FROM meta WHERE key = 'last_backup'",
        )
        .toArray()[0]?.value,
  );
}

describe('nightly backups', () => {
  it('books an alarm for the next 3 AM New York time on first touch', async () => {
    const { stub } = await seeded();
    const alarm = await runInDurableObject(stub, (_o, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeGreaterThan(Date.now());
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(alarm ?? 0);
    expect(hour).toBe('03');
  });

  it('the alarm writes the export to R2 and books the next night', async () => {
    const { email, stub } = await seeded();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const written = await keys(email);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(
      new RegExp(`^${email}/datapad-\\d{4}-\\d{2}-\\d{2}\\.json$`),
    );
    const object = await bindings.BACKUPS.get(written[0] ?? '');
    const file = (await object?.json()) as { projects: object };
    expect(Object.keys(file.projects)).toEqual(Object.keys(fixture.projects));
    const next = await runInDurableObject(stub, (_o, state) =>
      state.storage.getAlarm(),
    );
    expect(next).toBeGreaterThan(Date.now());
  });

  it('a second alarm prunes to the latest 30', async () => {
    const { email, stub } = await seeded();
    // Thirty-five older nights already in the bucket.
    for (let i = 1; i <= 35; i += 1) {
      const day = new Date(Date.UTC(2025, 0, i)).toISOString().slice(0, 10);
      await bindings.BACKUPS.put(`${email}/datapad-${day}.json`, '{}');
    }
    await runDurableObjectAlarm(stub);
    const left = await keys(email);
    expect(left).toHaveLength(LIMITS.backupsKept);
    // Today's is kept, the oldest are gone.
    expect(left.some((k) => k.includes('datapad-2025-01-01'))).toBe(false);
    expect(left.at(-1)).not.toContain('2025-');
    // Another user's backups are not touched.
    const other = `${crypto.randomUUID()}@example.com`;
    await bindings.BACKUPS.put(`${other}/datapad-2020-01-01.json`, '{}');
    await runDurableObjectAlarm(stub);
    expect(await keys(other)).toHaveLength(1);
  });

  it('never changes the data', async () => {
    const { stub } = await seeded();
    const before = await stub.stats();
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub);
    expect(await stub.stats()).toMatchObject({
      docs: before.docs,
      seq: before.seq,
    });
  });

  it('an empty Datapad writes nothing', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const stub = bindings.DATAPAD.getByName(email);
    await stub.stats();
    await runDurableObjectAlarm(stub);
    expect(await keys(email)).toEqual([]);
  });

  it('a missed alarm catches up on the next connection', async () => {
    const { email, stub } = await seeded();
    expect(await last(stub)).toBeUndefined();
    expect(await keys(email)).toEqual([]);
    const response = await as(email)(
      new Request('http://datapad.test/ws', {
        headers: { Upgrade: 'websocket' },
      }),
      bindings,
    );
    response.webSocket?.accept();
    await expect.poll(() => keys(email)).toHaveLength(1);
    expect(Number(await last(stub))).toBeGreaterThan(0);
    response.webSocket?.close();

    // Caught up: the next connection writes nothing new.
    await runInDurableObject(stub, async (o: DatapadObject) => {
      const before = await o.listBackups(MAIN_SPACE);
      expect(before).toHaveLength(1);
    });
  });
});

describe('backup routes', () => {
  it('lists, downloads and restores, by the signed-in email only', async () => {
    const { email, stub } = await seeded();
    await runDurableObjectAlarm(stub);
    const handle = as(email);

    const list = (await (
      await handle(new Request('http://datapad.test/api/backups'), bindings)
    ).json()) as { backups: BackupInfo[] };
    expect(list.backups).toHaveLength(1);
    const day = list.backups[0]?.day ?? '';
    expect(list.backups[0]?.bytes).toBeGreaterThan(100);

    const file = await handle(
      new Request(`http://datapad.test/api/backups/${day}.json`),
      bindings,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain(
      `datapad-${day}.json`,
    );

    // Someone else sees none of it.
    const stranger = as(`${crypto.randomUUID()}@example.com`);
    const theirs = (await (
      await stranger(new Request('http://datapad.test/api/backups'), bindings)
    ).json()) as { backups: BackupInfo[] };
    expect(theirs.backups).toEqual([]);
    expect(
      (
        await stranger(
          new Request(`http://datapad.test/api/backups/${day}.json`),
          bindings,
        )
      ).status,
    ).toBe(404);

    // Delete a project, then restore: it comes back, in one merge.
    const id = Object.keys(fixture.projects)[0] ?? '';
    await runInDurableObject(stub, (o: DatapadObject) => {
      // Through the same path the app uses: an op.
      (
        o as unknown as {
          applyOp: (ws: unknown, opId: string, op: unknown) => void;
        }
      ).applyOp(socketOn(MAIN_SPACE), 'op-delete', {
        type: 'deleteProject',
        id,
      });
    });
    expect((await stub.export(MAIN_SPACE)).projects[id]).toBeUndefined();
    const restored = await handle(
      new Request('http://datapad.test/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day }),
      }),
      bindings,
    );
    expect(restored.status).toBe(200);
    const result = (await restored.json()) as {
      imported: { projects: number };
    };
    expect(result.imported.projects).toBe(Object.keys(fixture.projects).length);
    expect((await stub.export(MAIN_SPACE)).projects[id]).toBeDefined();
  });

  it('refuses a cross-site restore and an unknown day', async () => {
    const { email } = await seeded();
    const handle = as(email);
    const cross = await handle(
      new Request('http://datapad.test/api/backups/restore', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ day: '2026-01-01' }),
      }),
      bindings,
    );
    expect(cross.status).toBe(403);
    const missing = await handle(
      new Request('http://datapad.test/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: '1999-01-01' }),
      }),
      bindings,
    );
    expect(missing.status).toBe(404);
  });

  it('restores a backup written before meetings, migrated', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const stub = bindings.DATAPAD.getByName(email);
    await bindings.BACKUPS.put(
      `${email}/datapad-2026-01-02.json`,
      JSON.stringify(legacy),
    );
    const outcome = await stub.restoreBackup(MAIN_SPACE, '2026-01-02');
    expect(outcome).toMatchObject({ ok: true });
    const file = await stub.export(MAIN_SPACE);
    expect(Object.keys(file.meetings).sort()).toEqual(['e-1', 'e-3', 'e-4']);
    expect(file.projects['p-echo']?.milestones?.map((m) => m.id)).toEqual([
      'e-2',
    ]);
    expect(file).not.toHaveProperty('events');
  });
});

/** A second space, written straight into storage, then reloaded. */
async function withSpace(stub: DurableObjectStub<DatapadObject>, id: string) {
  await runInDurableObject(stub, (o: DatapadObject, state) => {
    state.storage.sql.exec(
      'INSERT INTO spaces (id, name, position, seq, created_at) VALUES (?, ?, 1, 0, ?)',
      id,
      `Space ${id}`,
      '2026-10-01T00:00:00.000Z',
    );
    (o as unknown as { load: () => void }).load();
  });
}

describe('backups per space', () => {
  it('keeps main where backups always were and gives others a folder', async () => {
    const { email, stub } = await seeded();
    await withSpace(stub, 'hoth');
    await withSpace(stub, 'empty');
    const { tasks } = fixture;
    expect((await stub.import('hoth', { tasks })).ok).toBe(true);
    await runDurableObjectAlarm(stub);
    const written = await keys(email);
    // An empty space writes nothing.
    expect(written).toHaveLength(2);
    expect(
      written.filter((k) => k.startsWith(`${email}/datapad-`)),
    ).toHaveLength(1);
    const hothKey = written.find((k) => k.startsWith(`${email}/hoth/datapad-`));
    expect(hothKey).toBeDefined();
    const file = (await (
      await bindings.BACKUPS.get(hothKey ?? '')
    )?.json()) as { projects: object; tasks: object };
    expect(file.projects).toEqual({});
    expect(Object.keys(file.tasks)).toEqual(Object.keys(tasks));

    // Each space lists only its own.
    const [main] = await stub.listBackups(MAIN_SPACE);
    const [hoth] = await stub.listBackups('hoth');
    expect(main?.bytes).not.toBe(hoth?.bytes);
    expect(await stub.listBackups('empty')).toEqual([]);
    const list = (await (
      await as(email)(
        new Request('http://datapad.test/api/backups?space=hoth'),
        bindings,
      )
    ).json()) as { backups: BackupInfo[] };
    expect(list.backups).toEqual([hoth]);
  });

  it('prunes each folder to its own latest 30', async () => {
    const { email, stub } = await seeded();
    await withSpace(stub, 'hoth');
    await stub.import('hoth', fixture);
    // Main has a few old nights, hoth more than it may keep.
    for (let i = 1; i <= 35; i += 1) {
      const day = new Date(Date.UTC(2025, 0, i)).toISOString().slice(0, 10);
      await bindings.BACKUPS.put(`${email}/hoth/datapad-${day}.json`, '{}');
      if (i <= 5) {
        await bindings.BACKUPS.put(`${email}/datapad-${day}.json`, '{}');
      }
    }
    await runDurableObjectAlarm(stub);
    expect(await stub.listBackups('hoth')).toHaveLength(LIMITS.backupsKept);
    expect(await stub.listBackups(MAIN_SPACE)).toHaveLength(6);
  });

  it('restores a space from its own backup only', async () => {
    const { email, stub } = await seeded();
    await withSpace(stub, 'hoth');
    const id = Object.keys(fixture.projects)[0] ?? '';
    const project = fixture.projects[id as keyof typeof fixture.projects];
    await stub.import('hoth', { projects: { [id]: project } });
    await runDurableObjectAlarm(stub);
    const [backup] = await stub.listBackups('hoth');
    const day = backup?.day ?? '';

    // Delete the project from both spaces, then restore hoth.
    await runInDurableObject(stub, (o: DatapadObject) => {
      const apply = (
        o as unknown as {
          applyOp: (ws: unknown, opId: string, op: unknown) => void;
        }
      ).applyOp.bind(o);
      apply(socketOn(MAIN_SPACE), 'op-main', { type: 'deleteProject', id });
      apply(socketOn('hoth'), 'op-hoth', { type: 'deleteProject', id });
    });
    const restored = await as(email)(
      new Request('http://datapad.test/api/backups/restore?space=hoth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day }),
      }),
      bindings,
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      imported: { projects: 1, tasks: 0 },
    });
    expect((await stub.export('hoth')).projects[id]).toBeDefined();
    expect((await stub.export(MAIN_SPACE)).projects[id]).toBeUndefined();

    // Its backup downloads from its folder, not main's.
    const download = await as(email)(
      new Request(`http://datapad.test/api/backups/${day}.json?space=hoth`),
      bindings,
    );
    expect(download.status).toBe(200);
    const file = (await download.json()) as { tasks: object };
    expect(file.tasks).toEqual({});
  });
});
