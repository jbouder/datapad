import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './env';

/**
 * One Durable Object per signed-in user, named by the verified email (see
 * worker/index.ts; nothing else may choose the name). Its SQLite storage
 * holds every document the user has, one JSON row each, and its WebSockets
 * are the user's open tabs and devices. Nothing here is ever wiped.
 *
 * M0 is the skeleton: the tables exist and a socket answers `ping`. Ops,
 * snapshots and broadcast arrive with the reducer in M1.
 */

export interface DatapadStats {
  docs: number;
  seq: number;
  sockets: number;
}

export class DatapadObject extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureTables();
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

  /** Counts for tests and diagnostics. Carries no document content. */
  async stats(): Promise<DatapadStats> {
    const docs =
      this.ctx.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM docs')
        .one().n ?? 0;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'seq'")
      .toArray()[0];
    return {
      docs,
      seq: row ? Number(row.value) : 0,
      sockets: this.ctx.getWebSockets().length,
    };
  }

  /** WebSocket upgrades only; everything else goes through RPC. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the object can sleep while sockets stay open.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    // `ping` is answered by the auto-response above without waking us; a
    // ping that does arrive here (sent with whitespace, say) still gets one.
    if (typeof raw === 'string' && raw.trim() === 'ping') {
      ws.send('pong');
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // 1005/1006 carry no sendable code; answer with a normal close.
    ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing');
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, 'error');
  }
}
