import { DurableObject } from 'cloudflare:workers';
import { LIMITS } from '#shared/limits';
import {
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
const RECENT = 'recent_ops';
const ERASE_TOKEN = 'erase_token';

export class DatapadObject extends DurableObject<Bindings> {
  private state: Snapshot = emptySnapshot();
  private seq = 0;
  /** The latest applied op ids, newest last (see `ServerMessage`). */
  private recentOps: string[] = [];
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
    });
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
    this.recentOps = JSON.parse(this.meta(RECENT) ?? '[]') as string[];
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
    const recentOps = opId
      ? [...this.recentOps, opId].slice(-LIMITS.recentOps)
      : this.recentOps;
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
      if (opId) this.setMeta(RECENT, JSON.stringify(recentOps));
    });
    this.state = next;
    this.seq = seq;
    this.recentOps = recentOps;
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
    const { projects, tasks, notes, people, activity, events, settings } =
      this.state;
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
      recent: this.recentOps,
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
