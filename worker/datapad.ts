import { DurableObject } from 'cloudflare:workers';
import { LIMITS } from '#shared/limits';
import { migrate } from '#shared/migrate';
import {
  type BackupInfo,
  type BackupList,
  ClientMessageSchema,
  type Counts,
  countDocuments,
  describeIssue,
  type EraseToken,
  type ExportFile,
  ExportSchema,
  issuePath,
  MCP_OP_TYPES,
  type Op,
  OpSchema,
  type ServerMessage,
  SPACE_DELETED_CLOSE,
  SPACE_DELETED_REASON,
  type SpaceList,
} from '#shared/protocol';
import { type Changed, merge, OpError, reduce } from '#shared/reducer';
import { lastDailyAt, nextDailyAt, zonedDay } from '#shared/schedule';
import {
  nextPosition,
  orderedSpaces,
  projectSubtree,
  removeSubtree,
  type SpaceSummary,
  spaceCounts,
  validSpaceName,
} from '#shared/spaces';
import {
  COLLECTIONS,
  type Collection,
  emptySnapshot,
  GENERAL,
  MAIN_SPACE,
  type Snapshot,
  type SpaceInfo,
} from '#shared/types';
import { type Bindings, ownerTimeZone } from './env';

/**
 * One Durable Object per signed-in user, named by the verified email (see
 * worker/index.ts; nothing else may choose the name). Its SQLite storage
 * holds every document the user has, one JSON row each, and its WebSockets
 * are the user's open tabs and devices. Nothing here is ever wiped; the
 * only ways to delete a space's documents are `erase()` and `deleteSpace()`,
 * each with a fresh token.
 *
 * The documents are split into spaces: each a complete, separate Datapad
 * with its own snapshot and its own sequence number, listed in the `spaces`
 * table. Every row of `docs` belongs to one. A space id only picks among
 * this user's spaces; it is never a credential and never names the object.
 * The data from before spaces lives in `main`, migrated in place.
 *
 * Every space's snapshot lives in memory, loaded from SQLite when the
 * object starts (and so again after hibernation). Every change is an op
 * through `reduce()`: the rows it touched are written in one transaction
 * with that space's next sequence number, then the op goes to every socket
 * open on that space, the sender's too, so all its tabs apply the same ops
 * in the same order. A socket's space is in its attachment, which survives
 * hibernation.
 *
 * Every night (BACKUP_HOUR in BACKUP_TIME_ZONE) an alarm writes each
 * space's export to R2 and keeps the latest 30 per space: `main` at
 * `<email>/datapad-YYYY-MM-DD.json`, where backups were before spaces, and
 * any other space at `<email>/<space>/datapad-YYYY-MM-DD.json`. The alarm
 * only ever adds to R2 and prunes R2; it never touches the data here.
 */

export interface DatapadStats {
  docs: number;
  seq: number;
  sockets: number;
}

/**
 * Thrown by every RPC that names a space this user does not have. The
 * Worker checks `hasSpace()` first, so this is the backstop; RPC carries
 * the message, not the class, so the Worker matches on `NO_SUCH_SPACE`
 * (see `isNoSuchSpace`) and answers 404 all the same.
 */
export const NO_SUCH_SPACE = 'No such space';

export class SpaceError extends Error {
  constructor() {
    super(NO_SUCH_SPACE);
    this.name = 'SpaceError';
  }
}

/** Whether an error, thrown here or rethrown across RPC, is a SpaceError. */
export function isNoSuchSpace(error: unknown): boolean {
  return error instanceof Error && error.message === NO_SUCH_SPACE;
}

/**
 * The stored layout is newer than this code knows (the Worker was rolled
 * back past a schema bump). The object then never starts: its
 * constructor throws this before it loads, migrates or books anything, so
 * every RPC, socket and alarm fails with this message and nothing is read
 * or written. The Worker matches on the message (`isNewerSchema`).
 */
export const NEWER_SCHEMA =
  "This Datapad's data is from a newer version; deploy that version again";

/** Whether an error, thrown here or rethrown across RPC, is NEWER_SCHEMA. */
export function isNewerSchema(error: unknown): boolean {
  return error instanceof Error && error.message === NEWER_SCHEMA;
}

/** One activity line an applied op wrote: its project's log, or General's. */
export interface AppliedLine {
  project: string | null;
  text: string;
}

/**
 * `apply()`: the space after the op, its sequence number, when it was
 * applied and what it logged; or, for an op id already applied (a
 * replay), the space as it is; or why it was refused.
 */
export type ApplyOutcome =
  | {
      ok: true;
      replay: boolean;
      seq: number;
      at: string | null;
      activity: AppliedLine[];
      state: Snapshot;
    }
  | { ok: false; error: string };

type RunOutcome =
  | { kind: 'applied'; at: string; seq: number; changed: Changed[] }
  | { kind: 'replay' }
  | { kind: 'refused'; error: string };

export type ImportOutcome =
  | { ok: true; imported: Counts }
  | { ok: false; error: string };

/** What a change to the list of spaces came to: the result, or why not. */
export type SpaceOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** `moveProject()`: done, or why not. */
export type MoveOutcome = { ok: true } | { ok: false; error: string };

/**
 * `deleteSpace()`: refused because the token was wrong, expired or for
 * another space (`token`), or because of the space itself (`refused`).
 */
export type DeleteOutcome =
  | { ok: true }
  | { ok: false; why: 'token' | 'refused'; error: string };

/**
 * The single sequence number from before spaces. Read once, by the
 * migration, as `main`'s; each space's own lives in its `spaces` row.
 */
const SEQ = 'seq';
/**
 * The storage layout: 1 before spaces, 2 with `docs` keyed by space, 3
 * with meetings (no `events` rows) and milestones on their projects.
 */
const SCHEMA = 'schema_version';
const SCHEMA_VERSION = 3;
/** The collections the meetings migration reads and may rewrite. */
const MIGRATED = ['projects', 'notes', 'events', 'meetings'] as const;
/** Where op ids lived before the `op_ids` table; read once to migrate. */
const RECENT = 'recent_ops';
const ERASE_TOKEN = 'erase_token';
/**
 * When the last backup ran, in ms: set as it starts, so a failed one is
 * retried by the alarm (below), not by every connection.
 */
const LAST_BACKUP = 'last_backup';
/** When the last backup failed, in ms; cleared when one succeeds. */
const BACKUP_FAILED = 'backup_failed';
/** Retries since the night's backup failed. */
const BACKUP_RETRIES = 'backup_retries';
/**
 * After a failed backup, try again this long after each failure, then
 * wait for the next night.
 */
const BACKUP_RETRY_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

const BACKUP_PREFIX = 'datapad-';
/**
 * The copy kept before a destructive change (`keepCopy`). Outside
 * `BACKUP_PREFIX`, so Settings never lists it and pruning never deletes it.
 */
const KEPT_PREFIX = 'before-';

/** One space's documents and how many changes it has seen. */
interface SpaceData {
  state: Snapshot;
  seq: number;
}

/** One space's part of a commit: its next state and the rows that changed. */
interface SpaceWrite {
  space: string;
  next: Snapshot;
  changed: Changed[];
}

/** What a socket carries through hibernation: the space it opened. */
interface SocketAttachment {
  space: string;
}

export class DatapadObject extends DurableObject<Bindings> {
  private data = new Map<string, SpaceData>();
  /** Every space, in switcher order. */
  private spaces: SpaceInfo[] = [];
  /**
   * The last `LIMITS.opIdsKept` applied op ids, oldest first: the
   * idempotency table, mirrored from `op_ids`.
   */
  private opIds: string[] = [];
  private seenOps = new Set<string>();
  /** Recent op times per socket, for the flood limit. */
  private readonly recent = new Map<WebSocket, number[]>();
  /**
   * Recent MCP tool-call times per access token (keyed by the token's
   * hash, never the token), for `LIMITS.mcpCallsPerMinute`. In memory: an
   * evicted object forgets, which only ever lets a client through sooner.
   */
  private readonly mcpCalls = new Map<string, number[]>();
  /** When each MCP client's last use was written, so it is written rarely. */
  private readonly mcpUsed = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // A throw in here resets the object: every call waiting on it fails
    // with the error, and the next request constructs it again. That is
    // how `ensureTables()`'s NEWER_SCHEMA refuses everything (RPCs,
    // sockets, the alarm) after a rollback. Logged here, not unhandled.
    const started = ctx.blockConcurrencyWhile(async () => {
      this.ensureTables();
      this.load();
      // Keep-alives answered by the runtime without waking the object.
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('ping', 'pong'),
      );
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(this.nextBackupAt(Date.now()));
      }
    });
    started.catch(logStartupError);
  }

  /* ---------- backups ---------- */

  private backupHour(): number {
    const hour = Number(this.env.BACKUP_HOUR ?? 3);
    return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 3;
  }

  private backupZone(): string {
    return ownerTimeZone(this.env);
  }

  private nextBackupAt(now: number): number {
    return nextDailyAt(now, this.backupZone(), this.backupHour());
  }

  /**
   * A space's R2 folder, under the verified email that named us. `main`
   * keeps the folder from before spaces, so its old backups stay listed
   * and restorable; every other space gets a folder of its own.
   */
  private backupFolder(space: string): string {
    const name = this.ctx.id.name;
    if (!name) throw new Error('A Datapad object must be named by email');
    return space === MAIN_SPACE ? `${name}/` : `${name}/${space}/`;
  }

  private backupKey(space: string, day: string): string {
    return `${this.backupFolder(space)}${BACKUP_PREFIX}${day}.json`;
  }

  /**
   * Write today's backup of every space that has documents (its export as
   * JSON), then delete all but that space's latest `LIMITS.backupsKept`.
   * An empty space writes nothing. Never changes a document.
   */
  async backup(now = Date.now()): Promise<BackupInfo[]> {
    this.setMeta(LAST_BACKUP, String(now));
    const day = zonedDay(now, this.backupZone());
    const written: BackupInfo[] = [];
    for (const { id } of this.spaces) {
      if (countRows(this.space(id).state) === 0) continue;
      const body = JSON.stringify(await this.export(id), null, 2);
      const object = await this.env.BACKUPS.put(this.backupKey(id, day), body, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      });
      await this.prune(id);
      written.push({
        day,
        bytes: object.size,
        at: object.uploaded.toISOString(),
      });
    }
    return written;
  }

  /**
   * Before erase, delete, import or restore change a space wholesale, its
   * export goes to R2 at `<folder>before-<what>-<time>.json`, so a mistake
   * is never worse than one file to import. Nothing lists or prunes these;
   * they are kept until the owner deletes them. An empty space has nothing
   * to keep. Throws when R2 does, and the change then does not happen.
   */
  private async keepCopy(
    space: string,
    before: 'erase' | 'delete' | 'import' | 'restore',
  ) {
    if (countRows(this.space(space).state) === 0) return;
    const at = new Date().toISOString().replace(/[:.]/g, '-');
    await this.env.BACKUPS.put(
      `${this.backupFolder(space)}${KEPT_PREFIX}${before}-${at}.json`,
      JSON.stringify(await this.export(space), null, 2),
      { httpMetadata: { contentType: 'application/json; charset=utf-8' } },
    );
  }

  private async prune(space: string) {
    const all = await this.listBackups(space);
    const old = all.slice(LIMITS.backupsKept);
    if (old.length > 0) {
      await this.env.BACKUPS.delete(
        old.map((b) => this.backupKey(space, b.day)),
      );
    }
  }

  /**
   * The alarm missed its night (the object was being moved, say): back up
   * now. Called on every connection; cheap when nothing is due.
   */
  private async catchUp(now = Date.now()) {
    const last = Number(this.meta(LAST_BACKUP) ?? 0);
    const due = lastDailyAt(now, this.backupZone(), this.backupHour());
    const next =
      last < due ? await this.attemptBackup(now) : this.nextBackupAt(now);
    const booked = await this.ctx.storage.getAlarm();
    if (booked === null || next < booked) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async alarm() {
    const now = Date.now();
    let next = this.nextBackupAt(now);
    try {
      next = await this.attemptBackup(now);
    } finally {
      // Always book the next run, even when this one failed.
      await this.ctx.storage.setAlarm(next);
    }
  }

  /**
   * Back up, and remember how it went. A failure is logged, shown in
   * Settings → Backups (`failedAt`) and retried after 15 minutes, an hour
   * and four hours, then on the next night. Returns when to run next.
   */
  private async attemptBackup(now: number): Promise<number> {
    const night = this.nextBackupAt(now);
    try {
      const written = await this.backup(now);
      this.deleteMeta(BACKUP_FAILED);
      this.deleteMeta(BACKUP_RETRIES);
      console.log(
        JSON.stringify({
          level: 'info',
          what: 'backup',
          spaces: written.length,
          bytes: written.reduce((n, b) => n + b.bytes, 0),
        }),
      );
      return night;
    } catch (error) {
      // Retries count from tonight's run: a new night starts again.
      const since = lastDailyAt(now, this.backupZone(), this.backupHour());
      const failed = Number(this.meta(BACKUP_FAILED) ?? 0);
      const retries =
        failed >= since ? Number(this.meta(BACKUP_RETRIES) ?? 0) : 0;
      this.setMeta(BACKUP_FAILED, String(now));
      this.setMeta(BACKUP_RETRIES, String(retries + 1));
      const wait = BACKUP_RETRY_MS[retries];
      const next = wait === undefined ? night : Math.min(now + wait, night);
      logBackupError(error, next);
      return next;
    }
  }

  /** A space's backups and when they run, for Settings → Data. */
  async backups(space: string): Promise<BackupList> {
    const failed = this.meta(BACKUP_FAILED);
    return {
      backups: await this.listBackups(space),
      hour: this.backupHour(),
      timeZone: this.backupZone(),
      ...(failed ? { failedAt: new Date(Number(failed)).toISOString() } : {}),
    };
  }

  /** For `GET /api/health`: the object is up and its storage opened. */
  async ping(): Promise<true> {
    return true;
  }

  /**
   * A space's backups, newest first. `main`'s prefix also matches the
   * names of other spaces' folders, but the day pattern below never
   * matches their keys, so each space lists only its own files.
   */
  async listBackups(space: string): Promise<BackupInfo[]> {
    this.space(space);
    const folder = this.backupFolder(space);
    const out: BackupInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.env.BACKUPS.list({
        prefix: `${folder}${BACKUP_PREFIX}`,
        cursor,
      });
      for (const o of page.objects) {
        const day = o.key.slice(folder.length + BACKUP_PREFIX.length, -5);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          out.push({ day, bytes: o.size, at: o.uploaded.toISOString() });
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.day.localeCompare(a.day));
  }

  /**
   * One backup's JSON text, or null when there is none for that day. The
   * space's folder is chosen here, never by the caller.
   */
  async readBackup(space: string, day: string): Promise<string | null> {
    this.space(space);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const object = await this.env.BACKUPS.get(this.backupKey(space, day));
    return object ? object.text() : null;
  }

  /**
   * Merge a space's backup back into that space: the same path, and
   * transaction, as Import.
   */
  async restoreBackup(space: string, day: string): Promise<ImportOutcome> {
    const text = await this.readBackup(space, day);
    if (text === null)
      return { ok: false, error: 'There is no backup for that day' };
    let file: unknown;
    try {
      file = JSON.parse(text);
    } catch {
      return { ok: false, error: 'That backup is not readable' };
    }
    return this.mergeFile(space, file, 'restore');
  }

  /**
   * Created on first touch, migrated to the current layout on the first
   * wake after an upgrade; safe to run on every wake. A layout newer than
   * `SCHEMA_VERSION` throws `NEWER_SCHEMA` before anything else is
   * created, so the constructor stops there (see `NEWER_SCHEMA`).
   */
  private ensureTables() {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const version = Number(this.meta(SCHEMA) ?? 1);
    if (version > SCHEMA_VERSION) throw new Error(NEWER_SCHEMA);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS op_ids (
        op_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_clients (
        client_id TEXT PRIMARY KEY,
        last_used TEXT NOT NULL
      );
    `);
    if (version === SCHEMA_VERSION) return;
    // One transaction, so a failure leaves the old layout whole and the
    // next wake tries again.
    this.ctx.storage.transactionSync(() => {
      if (version < 2) this.migrateSpaces();
      this.migrateMeetings();
      this.setMeta(SCHEMA, String(SCHEMA_VERSION));
    });
  }

  /** Schema 2: `docs` keyed by space, the data from before in `main`. */
  private migrateSpaces() {
    const sql = this.ctx.storage.sql;
    const hasDocs =
      sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'",
        )
        .toArray().length > 0;
    const keyedBySpace =
      hasDocs &&
      sql
        .exec<{ name: string }>("PRAGMA table_info('docs')")
        .toArray()
        .some((c) => c.name === 'space');
    if (!keyedBySpace) {
      // Rows from before spaces belong to `main`, unchanged otherwise.
      sql.exec(`
        DROP TABLE IF EXISTS docs_by_space;
        CREATE TABLE docs_by_space (
          space TEXT NOT NULL,
          col TEXT NOT NULL,
          id TEXT NOT NULL,
          json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (space, col, id)
        );
      `);
      if (hasDocs) {
        sql.exec(
          'INSERT INTO docs_by_space (space, col, id, json, updated_at) SELECT ?, col, id, json, updated_at FROM docs',
          MAIN_SPACE,
        );
        sql.exec('DROP TABLE docs');
      }
      sql.exec('ALTER TABLE docs_by_space RENAME TO docs');
    }
    sql.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const empty =
      sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM spaces').one().n === 0;
    if (empty) {
      // `main` carries on the sequence the clients already know.
      sql.exec(
        'INSERT INTO spaces (id, name, position, seq, created_at) VALUES (?, ?, 0, ?, ?)',
        MAIN_SPACE,
        'Main',
        Number(this.meta(SEQ) ?? 0),
        new Date().toISOString(),
      );
    }
    // From here each space's row holds its own sequence number.
    sql.exec('DELETE FROM meta WHERE key = ?', SEQ);
  }

  /**
   * Schema 3: events became meetings and milestones moved onto their
   * project (`shared/migrate.ts` has the rules). Per space: run the
   * migration over its projects, notes and events, drop the `events`
   * rows, write the rows it changed, and bump the space's `seq` by one so
   * every open or cached client takes a fresh snapshot rather than
   * replaying ops across the change. A space that never changed (seq 0,
   * nothing stored) keeps its 0. Runs inside `ensureTables()`'s
   * transaction.
   */
  private migrateMeetings() {
    const sql = this.ctx.storage.sql;
    const at = new Date().toISOString();
    const spaces = sql
      .exec<{ id: string; seq: number }>('SELECT id, seq FROM spaces')
      .toArray();
    for (const space of spaces) {
      const before: Record<string, Record<string, unknown>> = {};
      const text = new Map<string, string>();
      for (const col of MIGRATED) before[col] = {};
      for (const row of sql.exec<{ col: string; id: string; json: string }>(
        `SELECT col, id, json FROM docs WHERE space = ? AND col IN (${MIGRATED.map(() => '?').join(', ')})`,
        space.id,
        ...MIGRATED,
      )) {
        const docs = before[row.col];
        if (!docs) continue;
        docs[row.id] = JSON.parse(row.json);
        text.set(`${row.col}\u0000${row.id}`, row.json);
      }
      const after = migrate(before) as Record<
        string,
        Record<string, unknown> | undefined
      >;
      sql.exec("DELETE FROM docs WHERE space = ? AND col = 'events'", space.id);
      for (const col of ['projects', 'notes', 'meetings'] as const) {
        for (const [id, doc] of Object.entries(after[col] ?? {})) {
          const json = JSON.stringify(doc);
          if (text.get(`${col}\u0000${id}`) === json) continue;
          sql.exec(
            'INSERT OR REPLACE INTO docs (space, col, id, json, updated_at) VALUES (?, ?, ?, ?, ?)',
            space.id,
            col,
            id,
            json,
            at,
          );
        }
      }
      const stored =
        sql
          .exec<{ n: number }>(
            'SELECT COUNT(*) AS n FROM docs WHERE space = ?',
            space.id,
          )
          .one().n > 0;
      if (space.seq > 0 || stored) {
        sql.exec('UPDATE spaces SET seq = seq + 1 WHERE id = ?', space.id);
      }
    }
  }

  private load() {
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec<{
        id: string;
        name: string;
        position: number;
        seq: number;
        created_at: string;
      }>('SELECT id, name, position, seq, created_at FROM spaces')
      .toArray();
    this.spaces = orderedSpaces(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        createdAt: r.created_at,
      })),
    );
    this.data = new Map(
      rows.map((r) => [r.id, { state: emptySnapshot(), seq: r.seq }]),
    );
    const known = new Set<string>(COLLECTIONS);
    for (const row of sql.exec<{
      space: string;
      col: string;
      id: string;
      json: string;
    }>('SELECT space, col, id, json FROM docs')) {
      const state = this.data.get(row.space)?.state;
      if (state && known.has(row.col)) {
        (state[row.col as Collection] as Record<string, unknown>)[row.id] =
          JSON.parse(row.json);
      }
    }
    const legacy = this.meta(RECENT);
    if (legacy) {
      // One-time move from the meta row to the table.
      const ids = JSON.parse(legacy) as string[];
      this.ctx.storage.transactionSync(() => {
        for (const id of ids) {
          this.ctx.storage.sql.exec(
            'INSERT OR IGNORE INTO op_ids (op_id, seq) VALUES (?, ?)',
            id,
            this.data.get(MAIN_SPACE)?.seq ?? 0,
          );
        }
        this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', RECENT);
      });
    }
    this.opIds = this.ctx.storage.sql
      .exec<{ op_id: string }>('SELECT op_id FROM op_ids ORDER BY seq, rowid')
      .toArray()
      .map((r) => r.op_id);
    this.seenOps = new Set(this.opIds);
  }

  /** The latest applied op ids, newest last (see `ServerMessage`). */
  private recentOps(): string[] {
    return this.opIds.slice(-LIMITS.recentOps);
  }

  private meta(key: string): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0]?.value;
  }

  private deleteMeta(key: string) {
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', key);
  }

  private setMeta(key: string, value: string) {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }

  /** A space's data, or a SpaceError when this user has no such space. */
  private space(id: string): SpaceData {
    const data = this.data.get(id);
    if (!data) throw new SpaceError();
    return data;
  }

  /**
   * The space a socket opened, from its attachment. One that is gone (or
   * a socket without one) reads as the first space, as a new one would.
   */
  private socketSpace(ws: WebSocket): string {
    const attached = ws.deserializeAttachment() as SocketAttachment | null;
    if (attached && this.data.has(attached.space)) return attached.space;
    return this.firstSpace();
  }

  private firstSpace(): string {
    return this.spaces[0]?.id ?? MAIN_SPACE;
  }

  /**
   * Write the touched rows of one space and its next sequence number in
   * one transaction, then adopt the new state. Nothing changes if it
   * throws.
   */
  private commit(
    space: string,
    next: Snapshot,
    changed: Changed[],
    at: string,
    opId?: string,
  ) {
    this.commitSpaces([{ space, next, changed }], at, opId);
  }

  /**
   * `commit()` across several spaces at once (moving a project): every
   * space's rows and next sequence number in the same transaction, so
   * either all land or none does. An op id, when there is one, belongs
   * to the first.
   */
  private commitSpaces(writes: SpaceWrite[], at: string, opId?: string) {
    const bumped = writes.map((w) => {
      const data = this.space(w.space);
      return { ...w, data, seq: data.seq + 1 };
    });
    const opIds = opId ? [...this.opIds, opId] : this.opIds;
    const dropped = opIds.splice(
      0,
      Math.max(0, opIds.length - LIMITS.opIdsKept),
    );
    this.ctx.storage.transactionSync(() => {
      for (const { space, next, changed, seq } of bumped) {
        for (const c of changed) {
          if ('deleted' in c) {
            this.ctx.storage.sql.exec(
              'DELETE FROM docs WHERE space = ? AND col = ? AND id = ?',
              space,
              c.col,
              c.id,
            );
          } else {
            const doc = (next[c.col] as Record<string, unknown>)[c.id];
            this.ctx.storage.sql.exec(
              'INSERT OR REPLACE INTO docs (space, col, id, json, updated_at) VALUES (?, ?, ?, ?, ?)',
              space,
              c.col,
              c.id,
              JSON.stringify(doc),
              at,
            );
          }
        }
        this.ctx.storage.sql.exec(
          'UPDATE spaces SET seq = ? WHERE id = ?',
          seq,
          space,
        );
      }
      if (opId) {
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO op_ids (op_id, seq) VALUES (?, ?)',
          opId,
          bumped[0]?.seq ?? 0,
        );
      }
      for (const id of dropped) {
        this.ctx.storage.sql.exec('DELETE FROM op_ids WHERE op_id = ?', id);
      }
    });
    for (const { data, next, seq } of bumped) {
      data.state = next;
      data.seq = seq;
    }
    this.opIds = opIds;
    if (opId) this.seenOps.add(opId);
    for (const id of dropped) this.seenOps.delete(id);
  }

  /* ---------- RPC (called by the Worker) ---------- */

  /**
   * Counts for tests and diagnostics, across every space: `seq` is the
   * changes all spaces have seen together. Carries no document content.
   */
  async stats(): Promise<DatapadStats> {
    const docs =
      this.ctx.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM docs')
        .one().n ?? 0;
    let seq = 0;
    for (const data of this.data.values()) seq += data.seq;
    return { docs, seq, sockets: this.ctx.getWebSockets().length };
  }

  /**
   * Whether this user has a space. The Worker asks before a scoped call,
   * so an unknown space is a 404 rather than an exception thrown here.
   */
  async hasSpace(space: string): Promise<boolean> {
    return this.data.has(space);
  }

  /** Every space, in switcher order. */
  async listSpaces(): Promise<SpaceList> {
    return { spaces: this.spaces };
  }

  /** Every space with what it holds, in switcher order (MCP `whoami`). */
  async spaceSummaries(): Promise<SpaceSummary[]> {
    return this.spaces.map((info) => {
      const data = this.data.get(info.id);
      return {
        ...info,
        counts: spaceCounts(data ? data.state : emptySnapshot()),
      };
    });
  }

  /**
   * One space's documents and change count, read-only and with no socket
   * (the MCP read tools, #153, select over it with `shared/`). Throws the
   * `SpaceError` for a space this user does not have.
   */
  async snapshot(space: string): Promise<{ state: Snapshot; seq: number }> {
    const { state, seq } = this.space(space);
    return { state, seq };
  }

  /**
   * MCP's write path (#154): a batch of ops from a write tool, through
   * exactly what a socket's op goes through. Each op is checked with
   * `OpSchema` (several go as one `batch` op: all or nothing, one sequence
   * number, one echo), limited to `MCP_OP_TYPES` (no deletes, archives,
   * `put` or `remove`), held to the socket's size limit, deduped by
   * `opId`, run through `reduce()`, committed, and sent to every socket
   * open on the space, so the app updates live. Nothing else here changes
   * a space for MCP. `opId` and the ids inside the ops come from the
   * Worker; the time is this object's clock, as for a socket's op.
   *
   * Answers the space's state after the op and the activity lines it
   * wrote, or why it was refused. Throws the `SpaceError` for a space
   * this user does not have.
   */
  async apply(
    space: string,
    opId: string,
    ops: unknown[],
  ): Promise<ApplyOutcome> {
    this.space(space);
    if (typeof opId !== 'string' || !opId || opId.length > LIMITS.idMax) {
      return { ok: false, error: 'That change has no valid id' };
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      return { ok: false, error: 'There is nothing to change' };
    }
    const candidate = ops.length === 1 ? ops[0] : { type: 'batch', ops };
    const parsed = OpSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue ? describeIssue(issue) : 'That change is not valid',
      };
    }
    // MCP may only add and edit (#229): one op off `MCP_OP_TYPES`
    // refuses the whole change, before anything is written.
    const op = parsed.data;
    const barred = (op.type === 'batch' ? op.ops : [op]).find(
      (o) => !MCP_OP_TYPES.has(o.type),
    );
    if (barred) {
      return {
        ok: false,
        error: `A connected app cannot send "${barred.type}"; that change stays in the app`,
      };
    }
    const envelope = JSON.stringify({ type: 'op', opId, op: parsed.data });
    if (new TextEncoder().encode(envelope).length > LIMITS.messageBytes) {
      return { ok: false, error: 'That change is too large to save' };
    }
    const outcome = this.run(space, opId, parsed.data);
    const { state, seq } = this.space(space);
    if (outcome.kind === 'refused') return { ok: false, error: outcome.error };
    if (outcome.kind === 'replay') {
      return { ok: true, replay: true, seq, at: null, activity: [], state };
    }
    // Each log is newest first; the lines this op wrote lead it, all at
    // `at`, and read back in the order they were written.
    const activity: AppliedLine[] = [];
    for (const c of outcome.changed) {
      if (c.col !== 'activity' || 'deleted' in c) continue;
      const events = state.activity[c.id]?.events ?? [];
      const mine: AppliedLine[] = [];
      for (const event of events) {
        if (event.t !== outcome.at) break;
        mine.unshift({
          project: c.id === GENERAL ? null : c.id,
          text: event.text,
        });
      }
      activity.push(...mine);
    }
    return { ok: true, replay: false, seq, at: outcome.at, activity, state };
  }

  /**
   * Whether one more MCP tool call fits the minute for this token: true
   * and counted when it does, false (and not counted) when it does not.
   * `key` is a hash of the token, chosen by the Worker; it only ever picks
   * a counter inside the object the verified email already named.
   */
  async admitMcpCall(
    key: string,
    now = Date.now(),
    client?: string,
  ): Promise<boolean> {
    for (const [k, stamps] of this.mcpCalls) {
      const live = stamps.filter((t) => now - t < 60_000);
      if (live.length === 0) this.mcpCalls.delete(k);
      else this.mcpCalls.set(k, live);
    }
    const stamps = this.mcpCalls.get(key) ?? [];
    if (stamps.length >= LIMITS.mcpCallsPerMinute) return false;
    stamps.push(now);
    this.mcpCalls.set(key, stamps);
    if (client) this.touchMcpClient(client, now);
    return true;
  }

  /**
   * When each MCP client last made a tool call, by client id, for
   * Settings → Connected apps (#154). Written at most once a minute per
   * client; a client id only ever picks a row in this user's own object.
   */
  private touchMcpClient(client: string, now: number) {
    if (client.length > 256) return;
    const last = this.mcpUsed.get(client) ?? 0;
    if (now - last < 60_000) return;
    this.mcpUsed.set(client, now);
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO mcp_clients (client_id, last_used) VALUES (?, ?)',
      client,
      new Date(now).toISOString(),
    );
  }

  /** Each MCP client's last tool call (ISO 8601), by client id. */
  async mcpLastUsed(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const row of this.ctx.storage.sql.exec<{
      client_id: string;
      last_used: string;
    }>('SELECT client_id, last_used FROM mcp_clients')) {
      out[row.client_id] = row.last_used;
    }
    return out;
  }

  /** Forget a client's last use, once its grant is revoked. */
  async forgetMcpClient(client: string): Promise<void> {
    this.mcpUsed.delete(client);
    this.ctx.storage.sql.exec(
      'DELETE FROM mcp_clients WHERE client_id = ?',
      client,
    );
  }

  /** Every document in a space, in the artifact's export format. */
  async export(space: string): Promise<ExportFile> {
    const {
      projects,
      tasks,
      notes,
      people,
      activity,
      meetings,
      settings,
      decisions,
      orgs,
      templates,
      boardItems,
    } = this.space(space).state;
    // The artifact's order, then what Datapad adds.
    return {
      exportedAt: new Date().toISOString(),
      projects,
      tasks,
      notes,
      people,
      activity,
      meetings,
      settings,
      decisions,
      orgs,
      templates,
      boardItems,
    };
  }

  /**
   * Merge an export into a space by id, validated first, written in one
   * transaction. Every socket open on that space then gets a fresh
   * snapshot.
   */
  async import(space: string, file: unknown): Promise<ImportOutcome> {
    return this.mergeFile(space, file, 'import');
  }

  /** Import and restore: a copy of the space first, then the merge. */
  private async mergeFile(
    space: string,
    file: unknown,
    before: 'import' | 'restore',
  ): Promise<ImportOutcome> {
    this.space(space);
    const parsed = ExportSchema.safeParse(file);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue
          ? `${issuePath(issue)}: ${describeIssue(issue)}`
          : 'That file is not a Datapad export',
      };
    }
    await this.keepCopy(space, before);
    // Read after the copy: an op may have landed while R2 was writing.
    const data = this.space(space);
    const at = new Date().toISOString();
    const { state, changed } = merge(data.state, parsed.data);
    this.commit(space, state, changed, at);
    this.broadcastSnapshot(space);
    const { exportedAt: _, ...incoming } = parsed.data;
    return { ok: true, imported: countDocuments(incoming) };
  }

  /**
   * A one-time token for `erase()` of this space, good for a few minutes.
   * It records the space, so it cannot erase another.
   */
  async eraseToken(space: string): Promise<EraseToken> {
    this.space(space);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...bytes]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const expiresAt = Date.now() + LIMITS.eraseTokenTtlMs;
    const stored: StoredEraseToken = { token, expiresAt, space };
    this.setMeta(ERASE_TOKEN, JSON.stringify(stored));
    return { token, expiresAt };
  }

  /**
   * Delete every document in a space, given the token `eraseToken()` just
   * issued for it. The only code path that deletes everything; the space
   * itself stays. Returns false for a wrong or expired token, or one for
   * another space, which is used up either way.
   */
  async erase(space: string, token: string): Promise<boolean> {
    this.space(space);
    if (!this.takeEraseToken(space, token)) {
      return false;
    }
    await this.keepCopy(space, 'erase');
    const data = this.space(space);
    const changed: Changed[] = COLLECTIONS.flatMap((col) =>
      Object.keys(data.state[col]).map((id) => ({
        col,
        id,
        deleted: true as const,
      })),
    );
    this.commit(space, emptySnapshot(), changed, new Date().toISOString());
    this.broadcastSnapshot(space);
    return true;
  }

  /**
   * Use up the erase token, whatever it is, and say whether `token` was it:
   * issued for `space` and not yet expired.
   */
  private takeEraseToken(space: string, token: string): boolean {
    const stored = this.meta(ERASE_TOKEN);
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', ERASE_TOKEN);
    if (!stored) {
      return false;
    }
    const expected = JSON.parse(stored) as StoredEraseToken;
    return (
      Date.now() <= expected.expiresAt &&
      expected.space === space &&
      sameText(token, expected.token)
    );
  }

  /* ---------- moving a project ---------- */

  /**
   * Move a project, with its tasks, notes, meetings, decisions and log, from
   * one space to another, copying the people and org it refers to (see
   * `projectSubtree`). Not an op: an op changes one space, and this
   * changes two. So the target takes the project the way an import does,
   * through `merge()`, the source lets it go through `removeSubtree()`,
   * both pure, and both spaces' rows and sequence numbers are written in
   * one transaction: the project is never in both spaces, or in neither.
   * Each space's sockets then get a fresh snapshot, as after an import.
   */
  async moveProject(
    from: string,
    to: string,
    id: string,
  ): Promise<MoveOutcome> {
    const source = this.space(from);
    const target = this.space(to);
    if (from === to) return { ok: false, error: 'Pick another space' };
    const at = new Date().toISOString();
    const name =
      this.spaces.find((s) => s.id === from)?.name ?? 'another space';
    const subtree = projectSubtree(source.state, id, target.state, {
      from: name,
      at,
    });
    if (!subtree) {
      return { ok: false, error: 'That project no longer exists' };
    }
    const landed = merge(target.state, subtree);
    const left = removeSubtree(source.state, subtree);
    this.commitSpaces(
      [
        { space: to, next: landed.state, changed: landed.changed },
        { space: from, next: left.state, changed: left.changed },
      ],
      at,
    );
    this.broadcastSnapshot(from);
    this.broadcastSnapshot(to);
    return { ok: true };
  }

  /* ---------- the list of spaces ---------- */

  /**
   * Add an empty space at the end of the list. Refused over
   * `LIMITS.spacesMax`, or for a name `validSpaceName` turns down.
   */
  async createSpace(name: string): Promise<SpaceOutcome<SpaceInfo>> {
    if (this.spaces.length >= LIMITS.spacesMax) {
      return {
        ok: false,
        error: `You can have ${LIMITS.spacesMax} spaces at most`,
      };
    }
    const check = validSpaceName(name, this.spaces);
    if (!check.ok) return { ok: false, error: check.reason };
    const space: SpaceInfo = {
      id: crypto.randomUUID(),
      name: check.name,
      position: nextPosition(this.spaces),
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'INSERT INTO spaces (id, name, position, seq, created_at) VALUES (?, ?, ?, 0, ?)',
        space.id,
        space.name,
        space.position,
        space.createdAt,
      );
    });
    this.data.set(space.id, { state: emptySnapshot(), seq: 0 });
    this.spaces = orderedSpaces([...this.spaces, space]);
    this.broadcastSpaces();
    return { ok: true, value: space };
  }

  /** Rename a space; keeping or recasing its own name is fine. */
  async renameSpace(
    id: string,
    name: string,
  ): Promise<SpaceOutcome<SpaceList>> {
    this.space(id);
    const check = validSpaceName(name, this.spaces, id);
    if (!check.ok) return { ok: false, error: check.reason };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'UPDATE spaces SET name = ? WHERE id = ?',
        check.name,
        id,
      );
    });
    this.spaces = this.spaces.map((s) =>
      s.id === id ? { ...s, name: check.name } : s,
    );
    this.broadcastSpaces();
    return { ok: true, value: { spaces: this.spaces } };
  }

  /**
   * Put the spaces in this order: every current id exactly once, nothing
   * else. Positions become 0..n-1.
   */
  async reorderSpaces(ids: string[]): Promise<SpaceOutcome<SpaceList>> {
    const current = new Set(this.spaces.map((s) => s.id));
    const permutation =
      ids.length === current.size &&
      new Set(ids).size === ids.length &&
      ids.every((id) => current.has(id));
    if (!permutation) {
      return {
        ok: false,
        error: 'List every space once to reorder them. Refresh and try again.',
      };
    }
    this.ctx.storage.transactionSync(() => {
      ids.forEach((id, position) => {
        this.ctx.storage.sql.exec(
          'UPDATE spaces SET position = ? WHERE id = ?',
          position,
          id,
        );
      });
    });
    const byId = new Map(this.spaces.map((s) => [s.id, s]));
    this.spaces = orderedSpaces(
      ids.flatMap((id, position) => {
        const space = byId.get(id);
        return space ? [{ ...space, position }] : [];
      }),
    );
    this.broadcastSpaces();
    return { ok: true, value: { spaces: this.spaces } };
  }

  /**
   * Delete a space and every document in it, given the token
   * `eraseToken()` just issued for that space; the token is used up
   * either way. The last space cannot go (`main` is not special: any
   * space but the last may). Its sockets are closed with
   * `SPACE_DELETED_CLOSE` before anything else is sent, since a socket
   * whose space is gone would otherwise read as the first space's.
   *
   * Its backups stay in R2 (data is kept): nothing prunes the folder of a
   * deleted space, and they can still be restored by hand.
   */
  async deleteSpace(id: string, token: string): Promise<DeleteOutcome> {
    this.space(id);
    const fresh = this.takeEraseToken(id, token);
    if (this.spaces.length <= 1) {
      return {
        ok: false,
        why: 'refused',
        error: 'This is your only space, so it cannot be deleted',
      };
    }
    if (!fresh) {
      return {
        ok: false,
        why: 'token',
        error: 'That confirmation has expired. Ask for a new one.',
      };
    }
    await this.keepCopy(id, 'delete');
    // Another delete may have run while R2 was writing.
    if (this.spaces.length <= 1) {
      return {
        ok: false,
        why: 'refused',
        error: 'This is your only space, so it cannot be deleted',
      };
    }
    const doomed = this.ctx
      .getWebSockets()
      .filter((ws) => this.socketSpace(ws) === id);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM docs WHERE space = ?', id);
      this.ctx.storage.sql.exec('DELETE FROM spaces WHERE id = ?', id);
    });
    this.data.delete(id);
    this.spaces = this.spaces.filter((s) => s.id !== id);
    for (const ws of doomed) {
      this.recent.delete(ws);
      try {
        ws.close(SPACE_DELETED_CLOSE, SPACE_DELETED_REASON);
      } catch {
        // Already closed.
      }
    }
    this.broadcastSpaces(new Set(doomed));
    return { ok: true };
  }

  /* ---------- sockets ---------- */

  /**
   * WebSocket upgrades only; everything else goes through RPC. `?space=`
   * picks which of this user's spaces the socket follows; a missing or
   * unknown one opens the first space, and the snapshot says which.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // A connection is "the next request" after a missed night.
    this.ctx.waitUntil(this.catchUp().catch(logBackupError));
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the object can sleep while sockets stay open.
    this.ctx.acceptWebSocket(server);
    const asked = new URL(request.url).searchParams.get('space');
    const space = asked && this.data.has(asked) ? asked : this.firstSpace();
    const attachment: SocketAttachment = { space };
    server.serializeAttachment(attachment);
    this.sendSnapshot(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') {
      return;
    }
    // `ping` is answered by the auto-response above without waking us; a
    // ping that does arrive here (sent with whitespace, say) still gets one.
    if (raw.trim() === 'ping') {
      ws.send('pong');
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const opId = opIdOf(data);
    if (new TextEncoder().encode(raw).length > LIMITS.messageBytes) {
      if (opId) {
        this.reject(ws, opId, 'That change is too large to save');
      }
      return;
    }
    const message = ClientMessageSchema.safeParse(data);
    if (!message.success) {
      const issue = message.error.issues[0];
      if (opId) {
        this.reject(
          ws,
          opId,
          issue ? describeIssue(issue) : 'That change is not valid',
        );
      }
      return;
    }

    if (!this.allow(ws)) {
      // Refuse rather than drop, so the sender rolls back its optimistic
      // copy instead of keeping it until the next reconnect.
      if (message.data.type === 'op') {
        this.reject(
          ws,
          message.data.opId,
          'Too many changes at once. Try that again.',
        );
      }
      return;
    }

    if (message.data.type === 'sync') {
      this.sendSnapshot(ws);
      return;
    }
    this.applyOp(ws, message.data.opId, message.data.op);
  }

  private applyOp(ws: WebSocket, opId: string, op: Op) {
    const outcome = this.run(this.socketSpace(ws), opId, op);
    if (outcome.kind === 'replay') {
      // A replay (an offline queue resent after its echo was lost): it
      // is already in the state, so say so and change nothing.
      const message: ServerMessage = { type: 'ack', opId };
      trySend(ws, JSON.stringify(message));
    } else if (outcome.kind === 'refused') {
      this.reject(ws, opId, outcome.error);
    }
  }

  /**
   * The one way a space changes by an op, from a socket or from MCP
   * (`apply()`): op-id dedupe, `reduce()`, the touched rows and the next
   * sequence number in one transaction, then the op to every socket open
   * on the space, the sender's too. `op` has passed `OpSchema` already.
   */
  private run(space: string, opId: string, op: Op): RunOutcome {
    const data = this.space(space);
    if (this.seenOps.has(opId)) return { kind: 'replay' };
    const at = new Date().toISOString();
    let result: ReturnType<typeof reduce>;
    try {
      result = reduce(data.state, op, at);
    } catch (error) {
      if (error instanceof OpError) {
        return { kind: 'refused', error: error.message };
      }
      throw error;
    }
    // A no-op still takes a sequence number and an echo: the sender is
    // waiting for one to settle its pending copy.
    this.commit(space, result.state, result.changed, at, opId);
    const message: ServerMessage = { type: 'op', seq: data.seq, opId, op, at };
    this.sendTo(space, JSON.stringify(message));
    return { kind: 'applied', at, seq: data.seq, changed: result.changed };
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.recent.delete(ws);
    // 1005/1006 carry no sendable code; answer with a normal close.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing');
    } catch {
      // Already closed by the peer.
    }
  }

  async webSocketError(ws: WebSocket) {
    this.recent.delete(ws);
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }

  private snapshotText(space: string): string {
    const { state, seq } = this.space(space);
    const message: ServerMessage = {
      type: 'snapshot',
      seq,
      state,
      space,
      spaces: this.spaces,
      recent: this.recentOps(),
    };
    return JSON.stringify(message);
  }

  private sendSnapshot(ws: WebSocket) {
    trySend(ws, this.snapshotText(this.socketSpace(ws)));
  }

  /** A fresh snapshot to every socket on a space, after a bulk change. */
  private broadcastSnapshot(space: string) {
    this.sendTo(space, this.snapshotText(space));
  }

  /** The list of spaces changed: tell every socket, whatever its space. */
  private broadcastSpaces(skip: ReadonlySet<WebSocket> = new Set()) {
    const message: ServerMessage = { type: 'spaces', spaces: this.spaces };
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (!skip.has(socket)) trySend(socket, text);
    }
  }

  /** Send to the sockets open on one space, and only those. */
  private sendTo(space: string, text: string) {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.socketSpace(socket) === space) trySend(socket, text);
    }
  }

  private reject(ws: WebSocket, opId: string, reason: string) {
    const message: ServerMessage = { type: 'rejected', opId, reason };
    trySend(ws, JSON.stringify(message));
  }

  /** Sliding one-second window per socket. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const stamps = (this.recent.get(ws) ?? []).filter((t) => now - t < 1000);
    const allowed = stamps.length < LIMITS.opsPerSecond;
    if (allowed) {
      stamps.push(now);
    }
    this.recent.set(ws, stamps);
    return allowed;
  }
}

/** The erase token as stored: with the space it was issued for. */
interface StoredEraseToken extends EraseToken {
  space: string;
}

function countRows(state: Snapshot): number {
  return COLLECTIONS.reduce((n, col) => n + Object.keys(state[col]).length, 0);
}

function logStartupError(error: unknown) {
  console.error(
    JSON.stringify({
      level: 'error',
      what: 'startup',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function logBackupError(error: unknown, retryAt?: number) {
  console.error(
    JSON.stringify({
      level: 'error',
      what: 'backup',
      error: error instanceof Error ? error.message : String(error),
      ...(retryAt ? { retryAt: new Date(retryAt).toISOString() } : {}),
    }),
  );
}

function trySend(ws: WebSocket, text: string) {
  try {
    ws.send(text);
  } catch {
    // Closing; it will resync when it reconnects.
  }
}

/** The opId of something shaped like an op message, to reject it by. */
function opIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { opId } = data as { opId?: unknown };
  return typeof opId === 'string' && opId.length <= LIMITS.idMax ? opId : null;
}

/** Compare without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
