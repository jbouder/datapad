import { DurableObject } from 'cloudflare:workers';
import { LIMITS } from '#shared/limits';
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
  type Op,
  type ServerMessage,
} from '#shared/protocol';
import { type Changed, merge, OpError, reduce } from '#shared/reducer';
import { lastDailyAt, nextDailyAt, zonedDay } from '#shared/schedule';
import {
  COLLECTIONS,
  type Collection,
  emptySnapshot,
  type Snapshot,
} from '#shared/types';
import type { Bindings } from './env';

/**
 * One Durable Object per signed-in user, named by the verified email (see
 * worker/index.ts; nothing else may choose the name). Its SQLite storage
 * holds every document the user has, one JSON row each, and its WebSockets
 * are the user's open tabs and devices. Nothing here is ever wiped; the
 * only way to delete everything is `erase()` with a fresh token.
 *
 * The whole snapshot lives in memory, loaded from SQLite when the object
 * starts (and so again after hibernation). Every change is an op through
 * `reduce()`: the rows it touched are written in one transaction with the
 * new sequence number, then the op goes to every socket, the sender's too,
 * so all tabs apply the same ops in the same order.
 *
 * Every night (BACKUP_HOUR in BACKUP_TIME_ZONE) an alarm writes the export
 * to R2 at `<email>/datapad-YYYY-MM-DD.json` and keeps the latest 30. The
 * alarm only ever adds to R2 and prunes R2; it never touches the data here.
 */

export interface DatapadStats {
  docs: number;
  seq: number;
  sockets: number;
}

export type ImportOutcome =
  | { ok: true; imported: Counts }
  | { ok: false; error: string };

const SEQ = 'seq';
/** Where op ids lived before the `op_ids` table; read once to migrate. */
const RECENT = 'recent_ops';
const ERASE_TOKEN = 'erase_token';
/** When the last backup ran, in ms. */
const LAST_BACKUP = 'last_backup';
const BACKUP_PREFIX = 'datapad-';

export class DatapadObject extends DurableObject<Bindings> {
  private state: Snapshot = emptySnapshot();
  private seq = 0;
  /**
   * The last `LIMITS.opIdsKept` applied op ids, oldest first: the
   * idempotency table, mirrored from `op_ids`.
   */
  private opIds: string[] = [];
  private seenOps = new Set<string>();
  /** Recent op times per socket, for the flood limit. */
  private readonly recent = new Map<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
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
  }

  /* ---------- backups ---------- */

  private backupHour(): number {
    const hour = Number(this.env.BACKUP_HOUR ?? 3);
    return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 3;
  }

  private backupZone(): string {
    return this.env.BACKUP_TIME_ZONE || 'America/New_York';
  }

  private nextBackupAt(now: number): number {
    return nextDailyAt(now, this.backupZone(), this.backupHour());
  }

  /** The R2 folder of this user: the verified email that named us. */
  private backupFolder(): string {
    const name = this.ctx.id.name;
    if (!name) throw new Error('A Datapad object must be named by email');
    return `${name}/`;
  }

  private backupKey(day: string): string {
    return `${this.backupFolder()}${BACKUP_PREFIX}${day}.json`;
  }

  /**
   * Write today's backup (the export as JSON), then delete all but the
   * latest `LIMITS.backupsKept`. An object with no documents writes
   * nothing. Never changes a document.
   */
  async backup(now = Date.now()): Promise<BackupInfo | null> {
    this.setMeta(LAST_BACKUP, String(now));
    if (countRows(this.state) === 0) return null;
    const day = zonedDay(now, this.backupZone());
    const body = JSON.stringify(await this.export(), null, 2);
    const object = await this.env.BACKUPS.put(this.backupKey(day), body, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    await this.prune();
    return { day, bytes: object.size, at: object.uploaded.toISOString() };
  }

  private async prune() {
    const all = await this.listBackups();
    const old = all.slice(LIMITS.backupsKept);
    if (old.length > 0) {
      await this.env.BACKUPS.delete(old.map((b) => this.backupKey(b.day)));
    }
  }

  /**
   * The alarm missed its night (the object was being moved, say): back up
   * now. Called on every connection; cheap when nothing is due.
   */
  private async catchUp(now = Date.now()) {
    const last = Number(this.meta(LAST_BACKUP) ?? 0);
    const due = lastDailyAt(now, this.backupZone(), this.backupHour());
    if (last < due) await this.backup(now);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(this.nextBackupAt(now));
    }
  }

  async alarm() {
    const now = Date.now();
    try {
      await this.backup(now);
    } finally {
      // Always book the next night, even when this one failed.
      await this.ctx.storage.setAlarm(this.nextBackupAt(now));
    }
  }

  /** The backups and when they run, for Settings → Data. */
  async backups(): Promise<BackupList> {
    return {
      backups: await this.listBackups(),
      hour: this.backupHour(),
      timeZone: this.backupZone(),
    };
  }

  /** This user's backups, newest first. */
  async listBackups(): Promise<BackupInfo[]> {
    const folder = this.backupFolder();
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

  /** One backup's JSON text, or null when there is none for that day. */
  async readBackup(day: string): Promise<string | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const object = await this.env.BACKUPS.get(this.backupKey(day));
    return object ? object.text() : null;
  }

  /** Merge a backup back in: the same path, and transaction, as Import. */
  async restoreBackup(day: string): Promise<ImportOutcome> {
    const text = await this.readBackup(day);
    if (text === null)
      return { ok: false, error: 'There is no backup for that day' };
    return this.import(JSON.parse(text));
  }

  /** Created on first touch; `IF NOT EXISTS` makes it safe on every wake. */
  private ensureTables() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        col TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (col, id)
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS op_ids (
        op_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
    `);
  }

  private load() {
    const state = emptySnapshot();
    const known = new Set<string>(COLLECTIONS);
    for (const row of this.ctx.storage.sql.exec<{
      col: string;
      id: string;
      json: string;
    }>('SELECT col, id, json FROM docs')) {
      if (known.has(row.col)) {
        (state[row.col as Collection] as Record<string, unknown>)[row.id] =
          JSON.parse(row.json);
      }
    }
    this.state = state;
    this.seq = Number(this.meta(SEQ) ?? 0);
    const legacy = this.meta(RECENT);
    if (legacy) {
      // One-time move from the meta row to the table.
      const ids = JSON.parse(legacy) as string[];
      this.ctx.storage.transactionSync(() => {
        for (const id of ids) {
          this.ctx.storage.sql.exec(
            'INSERT OR IGNORE INTO op_ids (op_id, seq) VALUES (?, ?)',
            id,
            this.seq,
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

  private setMeta(key: string, value: string) {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }

  /**
   * Write the touched rows and the next sequence number in one
   * transaction, then adopt the new state. Nothing changes if it throws.
   */
  private commit(
    next: Snapshot,
    changed: Changed[],
    at: string,
    opId?: string,
  ) {
    const seq = this.seq + 1;
    const opIds = opId ? [...this.opIds, opId] : this.opIds;
    const dropped = opIds.splice(
      0,
      Math.max(0, opIds.length - LIMITS.opIdsKept),
    );
    this.ctx.storage.transactionSync(() => {
      for (const c of changed) {
        if ('deleted' in c) {
          this.ctx.storage.sql.exec(
            'DELETE FROM docs WHERE col = ? AND id = ?',
            c.col,
            c.id,
          );
        } else {
          const doc = (next[c.col] as Record<string, unknown>)[c.id];
          this.ctx.storage.sql.exec(
            'INSERT OR REPLACE INTO docs (col, id, json, updated_at) VALUES (?, ?, ?, ?)',
            c.col,
            c.id,
            JSON.stringify(doc),
            at,
          );
        }
      }
      this.setMeta(SEQ, String(seq));
      if (opId) {
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO op_ids (op_id, seq) VALUES (?, ?)',
          opId,
          seq,
        );
      }
      for (const id of dropped) {
        this.ctx.storage.sql.exec('DELETE FROM op_ids WHERE op_id = ?', id);
      }
    });
    this.state = next;
    this.seq = seq;
    this.opIds = opIds;
    if (opId) this.seenOps.add(opId);
    for (const id of dropped) this.seenOps.delete(id);
  }

  /* ---------- RPC (called by the Worker) ---------- */

  /** Counts for tests and diagnostics. Carries no document content. */
  async stats(): Promise<DatapadStats> {
    const docs =
      this.ctx.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM docs')
        .one().n ?? 0;
    return { docs, seq: this.seq, sockets: this.ctx.getWebSockets().length };
  }

  /** Every document, in the artifact's export format. */
  async export(): Promise<ExportFile> {
    const {
      projects,
      tasks,
      notes,
      people,
      activity,
      events,
      settings,
      decisions,
      orgs,
    } = this.state;
    // The artifact's order, then what Datapad adds.
    return {
      exportedAt: new Date().toISOString(),
      projects,
      tasks,
      notes,
      people,
      activity,
      events,
      settings,
      decisions,
      orgs,
    };
  }

  /**
   * Merge an export by id, validated first, written in one transaction.
   * Every open socket then gets a fresh snapshot.
   */
  async import(file: unknown): Promise<ImportOutcome> {
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
    const at = new Date().toISOString();
    const { state, changed } = merge(this.state, parsed.data);
    this.commit(state, changed, at);
    this.broadcastSnapshot();
    const { exportedAt: _, ...incoming } = parsed.data;
    return { ok: true, imported: countDocuments(incoming) };
  }

  /** A one-time token for `erase()`, good for a few minutes. */
  async eraseToken(): Promise<EraseToken> {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...bytes]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const expiresAt = Date.now() + LIMITS.eraseTokenTtlMs;
    this.setMeta(ERASE_TOKEN, JSON.stringify({ token, expiresAt }));
    return { token, expiresAt };
  }

  /**
   * Delete every document, given the token `eraseToken()` just issued. The
   * only code path that deletes everything. Returns false for a wrong or
   * expired token, which is used up either way.
   */
  async erase(token: string): Promise<boolean> {
    const stored = this.meta(ERASE_TOKEN);
    this.ctx.storage.sql.exec('DELETE FROM meta WHERE key = ?', ERASE_TOKEN);
    if (!stored) {
      return false;
    }
    const expected = JSON.parse(stored) as EraseToken;
    if (Date.now() > expected.expiresAt || !sameText(token, expected.token)) {
      return false;
    }
    const changed: Changed[] = COLLECTIONS.flatMap((col) =>
      Object.keys(this.state[col]).map((id) => ({
        col,
        id,
        deleted: true as const,
      })),
    );
    this.commit(emptySnapshot(), changed, new Date().toISOString());
    this.broadcastSnapshot();
    return true;
  }

  /* ---------- sockets ---------- */

  /** WebSocket upgrades only; everything else goes through RPC. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // A connection is "the next request" after a missed night.
    this.ctx.waitUntil(this.catchUp().catch(logBackupError));
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the object can sleep while sockets stay open.
    this.ctx.acceptWebSocket(server);
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
    if (this.seenOps.has(opId)) {
      // A replay (an offline queue resent after its echo was lost): it
      // is already in the state, so say so and change nothing.
      const message: ServerMessage = { type: 'ack', opId };
      trySend(ws, JSON.stringify(message));
      return;
    }
    const at = new Date().toISOString();
    let result: ReturnType<typeof reduce>;
    try {
      result = reduce(this.state, op, at);
    } catch (error) {
      if (error instanceof OpError) {
        this.reject(ws, opId, error.message);
        return;
      }
      throw error;
    }
    // A no-op still takes a sequence number and an echo: the sender is
    // waiting for one to settle its pending copy.
    this.commit(result.state, result.changed, at, opId);
    const message: ServerMessage = { type: 'op', seq: this.seq, opId, op, at };
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      trySend(socket, text);
    }
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

  private snapshotText(): string {
    const message: ServerMessage = {
      type: 'snapshot',
      seq: this.seq,
      state: this.state,
      recent: this.recentOps(),
    };
    return JSON.stringify(message);
  }

  private sendSnapshot(ws: WebSocket) {
    trySend(ws, this.snapshotText());
  }

  private broadcastSnapshot() {
    const text = this.snapshotText();
    for (const socket of this.ctx.getWebSockets()) {
      trySend(socket, text);
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

function countRows(state: Snapshot): number {
  return COLLECTIONS.reduce((n, col) => n + Object.keys(state[col]).length, 0);
}

function logBackupError(error: unknown) {
  console.error(
    JSON.stringify({
      level: 'error',
      what: 'backup',
      error: error instanceof Error ? error.message : String(error),
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
