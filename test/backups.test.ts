import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '#shared/limits';
import { type BackupInfo, newerFormatMessage } from '#shared/protocol';
import { EXPORT_FORMAT, MAIN_SPACE } from '#shared/types';
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

/** Make this object's R2 puts throw until `restore()` is called. */
async function breakR2(stub: DurableObjectStub<DatapadObject>) {
  await runInDurableObject(stub, (o: DatapadObject) => {
    const own = o as unknown as { env: Bindings };
    const real = own.env.BACKUPS;
    own.env = {
      ...own.env,
      BACKUPS: new Proxy(real, {
        get: (target, key) =>
          key === 'put'
            ? () => Promise.reject(new Error('R2 is down'))
            : Reflect.get(target, key).bind(target),
      }),
    };
  });
  return () =>
    runInDurableObject(stub, (o: DatapadObject) => {
      const own = o as unknown as { env: Bindings };
      own.env = { ...own.env, BACKUPS: bindings.BACKUPS };
    });
}

function alarmAt(stub: DurableObjectStub<DatapadObject>) {
  return runInDurableObject(stub, (_o, state) => state.storage.getAlarm());
}

describe('a failed backup', () => {
  it('is retried after 15 minutes, an hour and four hours, then the next night', async () => {
    const { email, stub } = await seeded();
    const restore = await breakR2(stub);
    const night = await alarmAt(stub);
    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const before = Date.now();
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      waits.push(((await alarmAt(stub)) ?? 0) - before);
    }
    const minutes = waits.map((w) => Math.round(w / 60_000));
    // Each retry is capped at the next night, which may come first; the
    // fourth failure waits for it.
    const cap = Math.round(((night ?? 0) - Date.now()) / 60_000);
    expect(minutes).toEqual([15, 60, 240, cap].map((m) => Math.min(m, cap)));
    expect(await keys(email)).toEqual([]);
    await restore();
  });

  it('shows in the list until a backup succeeds', async () => {
    const { email, stub } = await seeded();
    const night = await alarmAt(stub);
    const restore = await breakR2(stub);
    const before = Date.now();
    await runDurableObjectAlarm(stub);
    const failed = await stub.backups(MAIN_SPACE);
    expect(failed.backups).toEqual([]);
    expect(Date.parse(failed.failedAt ?? '')).toBeGreaterThanOrEqual(before);

    // Over the route too: the time, never the error.
    const response = await as(email)(
      new Request('http://datapad.test/api/backups'),
      bindings,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.failedAt).toBe(failed.failedAt);
    expect(JSON.stringify(body)).not.toContain('R2 is down');

    await restore();
    await runDurableObjectAlarm(stub);
    const ok = await stub.backups(MAIN_SPACE);
    expect(ok.backups).toHaveLength(1);
    expect(ok.failedAt).toBeUndefined();
    // Back on the nightly schedule.
    expect(await alarmAt(stub)).toBe(night);
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

  it('refuses a backup from a newer Datapad, and changes nothing', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const stub = bindings.DATAPAD.getByName(email);
    await bindings.BACKUPS.put(
      `${email}/datapad-2026-01-02.json`,
      JSON.stringify({ ...fixture, format: EXPORT_FORMAT + 1 }),
    );
    expect(await stub.restoreBackup(MAIN_SPACE, '2026-01-02')).toEqual({
      ok: false,
      error: newerFormatMessage(EXPORT_FORMAT + 1),
    });
    expect((await stub.stats()).docs).toBe(0);
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

describe('a copy before a destructive change', () => {
  /** The copies kept for `space`'s folder, by what came after them. */
  async function kept(email: string, folder = '') {
    const listed = await bindings.BACKUPS.list({
      prefix: `${email}/${folder}before-`,
    });
    return listed.objects.map((o) =>
      o.key.slice(`${email}/${folder}before-`.length).replace(/-\d.*$/, ''),
    );
  }

  async function copyOf(email: string, what: string) {
    const listed = await bindings.BACKUPS.list({
      prefix: `${email}/before-${what}-`,
    });
    const key = listed.objects[0]?.key ?? '';
    return (await (await bindings.BACKUPS.get(key))?.json()) as {
      tasks: object;
    };
  }

  it('keeps the space before erasing it, and lists it nowhere', async () => {
    const { email, stub } = await seeded();
    const before = await stub.export(MAIN_SPACE);

    // A wrong token keeps nothing and erases nothing.
    await stub.eraseToken(MAIN_SPACE);
    expect(await stub.erase(MAIN_SPACE, 'wrong')).toBe(false);
    expect(await kept(email)).toEqual([]);

    const { token } = await stub.eraseToken(MAIN_SPACE);
    expect(await stub.erase(MAIN_SPACE, token)).toBe(true);
    expect(await kept(email)).toEqual(['erase']);
    expect((await copyOf(email, 'erase')).tasks).toEqual(before.tasks);
    expect(await stub.listBackups(MAIN_SPACE)).toEqual([]);

    // Erasing an empty space has nothing to keep.
    const again = await stub.eraseToken(MAIN_SPACE);
    expect(await stub.erase(MAIN_SPACE, again.token)).toBe(true);
    expect(await kept(email)).toEqual(['erase']);
  });

  it('erases nothing when the copy cannot be written', async () => {
    const { email, stub } = await seeded();
    const restore = await breakR2(stub);
    const { token } = await stub.eraseToken(MAIN_SPACE);
    const response = await as(email)(
      new Request('http://datapad.test/api/erase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      bindings,
    );
    expect(response.status).toBe(500);
    await restore();
    expect(Object.keys((await stub.export(MAIN_SPACE)).tasks)).toEqual(
      Object.keys(fixture.tasks),
    );
    expect(await kept(email)).toEqual([]);
  });

  it('keeps the space before an import or a restore, not into an empty one', async () => {
    const { email, stub } = await seeded();
    // seeded() imported into an empty space.
    expect(await kept(email)).toEqual([]);
    expect((await stub.import(MAIN_SPACE, { tasks: fixture.tasks })).ok).toBe(
      true,
    );
    expect(await kept(email)).toEqual(['import']);
    // A file that is not an export keeps nothing.
    expect((await stub.import(MAIN_SPACE, { tasks: 'no' })).ok).toBe(false);
    expect(await kept(email)).toEqual(['import']);

    await bindings.BACKUPS.put(
      `${email}/datapad-2026-01-02.json`,
      JSON.stringify(fixture),
    );
    expect((await stub.restoreBackup(MAIN_SPACE, '2026-01-02')).ok).toBe(true);
    expect((await kept(email)).sort()).toEqual(['import', 'restore']);
  });

  it('keeps a space in its own folder before deleting it', async () => {
    const { email, stub } = await seeded();
    await withSpace(stub, 'hoth');
    await stub.import('hoth', { tasks: fixture.tasks });
    const { token } = await stub.eraseToken('hoth');
    expect(await stub.deleteSpace('hoth', token)).toEqual({ ok: true });
    expect(await kept(email, 'hoth/')).toEqual(['delete']);
    expect(await kept(email)).toEqual([]);
  });

  it('says so when a backup cannot be read', async () => {
    const { email, stub } = await seeded();
    await bindings.BACKUPS.put(`${email}/datapad-2026-01-03.json`, 'not json');
    expect(await stub.restoreBackup(MAIN_SPACE, '2026-01-03')).toEqual({
      ok: false,
      error: 'That backup is not readable',
    });
  });
});

describe('an age limit for the copies before a destructive change', () => {
  const DAY = 86_400_000;

  /** Set `BEFORE_COPIES_MAX_DAYS` on the object, as a deployed var would. */
  function limit(stub: DurableObjectStub<DatapadObject>, days: string) {
    return runInDurableObject(stub, (o: DatapadObject) => {
      const own = o as unknown as { env: Bindings };
      own.env = { ...own.env, BEFORE_COPIES_MAX_DAYS: days };
    });
  }

  /** Back up as the alarm does, `days` from now. */
  function backupIn(stub: DurableObjectStub<DatapadObject>, days: number) {
    return runInDurableObject(stub, (o: DatapadObject) =>
      o.backup(Date.now() + days * DAY),
    );
  }

  async function copiesOf(email: string) {
    return (await keys(email)).filter((k) => k.includes('/before-'));
  }

  /** Copies in main's folder and in a deleted space's. */
  async function withCopies() {
    const { email, stub } = await seeded();
    const { token } = await stub.eraseToken(MAIN_SPACE);
    expect(await stub.erase(MAIN_SPACE, token)).toBe(true);
    await stub.import(MAIN_SPACE, fixture);
    await withSpace(stub, 'hoth');
    await stub.import('hoth', { tasks: fixture.tasks });
    const gone = await stub.eraseToken('hoth');
    expect(await stub.deleteSpace('hoth', gone.token)).toEqual({ ok: true });
    const copies = await copiesOf(email);
    // before-erase in main, before-delete in hoth's folder.
    expect(copies).toHaveLength(2);
    expect(copies.some((k) => k.startsWith(`${email}/hoth/before-`))).toBe(
      true,
    );
    return { email, stub, copies };
  }

  it('keeps every copy while it is off (the default)', async () => {
    const { email, stub, copies } = await withCopies();
    await backupIn(stub, 400);
    expect(await copiesOf(email)).toEqual(copies);
    // Zero, or anything but a positive whole number, is off too.
    for (const days of ['0', '-3', '1.5', 'thirty', ' ']) {
      await limit(stub, days);
      await backupIn(stub, 400);
    }
    expect(await copiesOf(email)).toEqual(copies);
  });

  it('keeps copies younger than the limit', async () => {
    const { email, stub, copies } = await withCopies();
    await limit(stub, '30');
    await backupIn(stub, 29);
    expect(await copiesOf(email)).toEqual(copies);
  });

  it('deletes older copies in every folder, and nothing else', async () => {
    const { email, stub } = await withCopies();
    const other = await withCopies();
    await bindings.BACKUPS.put(`${email}/datapad-2025-01-01.json`, '{}');
    await bindings.BACKUPS.put(`${email}/hoth/datapad-2025-01-01.json`, '{}');
    await limit(stub, '30');
    await backupIn(stub, 31);
    expect(await copiesOf(email)).toEqual([]);
    // The nightly files stay, a deleted space's too, and so does every
    // other email's copy.
    const left = await keys(email);
    expect(left).toContain(`${email}/datapad-2025-01-01.json`);
    expect(left).toContain(`${email}/hoth/datapad-2025-01-01.json`);
    expect(await copiesOf(other.email)).toEqual(other.copies);
  });

  it('runs on the nightly alarm', async () => {
    const { email, stub } = await withCopies();
    await limit(stub, '30');
    await runDurableObjectAlarm(stub);
    // Written just now: well inside 30 days.
    expect(await copiesOf(email)).toHaveLength(2);

    // R2 says every object is 40 days old.
    await runInDurableObject(stub, (o: DatapadObject) => {
      const own = o as unknown as { env: Bindings };
      const real = own.env.BACKUPS;
      const aged = async (options?: R2ListOptions) => {
        const page = await real.list(options);
        for (const object of page.objects) {
          Object.defineProperty(object, 'uploaded', {
            value: new Date(Date.now() - 40 * DAY),
          });
        }
        return page;
      };
      own.env = {
        ...own.env,
        BACKUPS: new Proxy(real, {
          get: (target, key) =>
            key === 'list' ? aged : Reflect.get(target, key).bind(target),
        }),
      };
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await copiesOf(email)).toEqual([]);
    expect(await stub.listBackups(MAIN_SPACE)).toHaveLength(1);
  });
});
