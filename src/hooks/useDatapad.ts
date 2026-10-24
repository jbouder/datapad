import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  describeIssue,
  type Op,
  type OpOf,
  OpSchema,
  type OpType,
  type ServerMessage,
} from '#shared/protocol';
import { OpError, reduce } from '#shared/reducer';
import type { Snapshot } from '#shared/types';
import { socketUrl } from '@/lib/api';
import { newId } from '@/lib/ids';

/**
 * The live connection to the signed-in user's Datapad.
 *
 * `confirmed` is what the server has told us (its last snapshot plus every
 * op it has echoed, at its `seq`); `pending` are our own ops it has not
 * echoed yet. What renders is `pending` replayed over `confirmed`, so a
 * change shows at once and settles when the echo (or a rejection) comes.
 * Until the socket's first snapshot, the last one cached in IndexedDB
 * renders instead, marked `stale`.
 *
 * Components never touch the socket: they call the actions, one per op.
 */

export type SyncStatus = 'connecting' | 'live' | 'offline';

interface Pending {
  opId: string;
  op: Op;
  at: string;
}

interface Confirmed {
  seq: number;
  state: Snapshot;
}

/** The ops that create a document; their action makes the id. */
const CREATES = {
  addTask: true,
  createProject: true,
  addNote: true,
  addEvent: true,
  addPerson: true,
} as const;
type CreateType = keyof typeof CREATES;

export type ActionInput<T extends OpType> = T extends CreateType
  ? Omit<OpOf<T>, 'type' | 'id'> & { id?: string }
  : Omit<OpOf<T>, 'type'>;

/**
 * One action per op. Creating returns the new id; everything else whether
 * it was taken. Either way a refusal has already been toasted.
 */
export type Actions = {
  [T in OpType]: (
    input: ActionInput<T>,
  ) => T extends CreateType ? string | null : boolean;
};

/** Every op type, so the actions object is complete. */
const OP_TYPES = {
  put: true,
  remove: true,
  log: true,
  addTask: true,
  toggleTask: true,
  moveTask: true,
  reorderTasks: true,
  editTask: true,
  deleteTask: true,
  createProject: true,
  editProject: true,
  setState: true,
  setStatus: true,
  archiveProject: true,
  unarchiveProject: true,
  deleteProject: true,
  addNote: true,
  editNote: true,
  pinNote: true,
  deleteNote: true,
  addEvent: true,
  editEvent: true,
  deleteEvent: true,
  addPerson: true,
  editPerson: true,
  removePerson: true,
} as const satisfies Record<OpType, true>;

export interface Datapad {
  /** Null until the cache or the socket has given us something. */
  state: Snapshot | null;
  status: SyncStatus;
  /** True while showing the cached snapshot, before the socket confirms. */
  stale: boolean;
  /** Our changes the server has not confirmed yet. */
  pendingCount: number;
  actions: Actions;
}

export const CACHE_KEY = 'datapad:snapshot';

interface Cached {
  email: string;
  seq: number;
  state: Snapshot;
}

const MAX_BACKOFF_MS = 15_000;
const PING_MS = 30_000;
const CACHE_DEBOUNCE_MS = 400;

/**
 * The connection itself; `DatapadProvider` runs it once for the app.
 * `email` (from `/api/config`) keys the cache, so a browser shared by two
 * accounts never shows one the other's data.
 */
export function useDatapadConnection(
  email: string | null,
  onRefused: (reason: string) => void,
): Datapad {
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [cached, setCached] = useState<Cached | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const socket = useRef<WebSocket | null>(null);
  const confirmedRef = useRef<Confirmed | null>(null);
  confirmedRef.current = confirmed;
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;
  /** Which socket each pending op went out on. */
  const sentOn = useRef(new Map<string, WebSocket>());

  /* the socket */
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    /** A sync is on its way; ops until its snapshot are ignored. */
    let syncing = false;

    const send = (ws: WebSocket, message: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    };

    /** The server has answered this op, one way or the other. */
    const settle = (opId: string) => {
      sentOn.current.delete(opId);
      if (pendingRef.current.some((p) => p.opId === opId)) {
        pendingRef.current = pendingRef.current.filter((p) => p.opId !== opId);
        setPending(pendingRef.current);
      }
    };

    const resync = (ws: WebSocket) => {
      if (!syncing) {
        syncing = true;
        send(ws, { type: 'sync' });
      }
    };

    const connect = () => {
      if (cancelled) return;
      window.clearTimeout(reconnectTimer);
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      syncing = false;

      ws.addEventListener('open', () => {
        attempts = 0;
        pingTimer = window.setInterval(() => send(ws, 'ping'), PING_MS);
      });

      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || event.data === 'pong') return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case 'snapshot': {
            syncing = false;
            const next = { seq: message.seq, state: message.state };
            confirmedRef.current = next;
            setConfirmed(next);
            setStatus('live');
            // Ops the object already applied (their echo went to a socket
            // that closed) are in this state; drop them. Send the rest,
            // unless they already went out on this socket.
            const applied = new Set(message.recent);
            const left = pendingRef.current.filter((p) => !applied.has(p.opId));
            pendingRef.current = left;
            setPending(left);
            for (const p of left) {
              if (sentOn.current.get(p.opId) !== ws) {
                sentOn.current.set(p.opId, ws);
                send(ws, { type: 'op', opId: p.opId, op: p.op });
              }
            }
            return;
          }
          case 'op': {
            const current = confirmedRef.current;
            if (syncing || !current) {
              // Already in the snapshot that is on its way.
              settle(message.opId);
              return;
            }
            if (message.seq !== current.seq + 1) {
              // We missed something: ask for the whole state again.
              resync(ws);
              return;
            }
            let next: Confirmed;
            try {
              next = {
                seq: message.seq,
                state: reduce(current.state, message.op, message.at).state,
              };
            } catch {
              // Our state disagrees with the server's: resync, don't guess.
              resync(ws);
              return;
            }
            confirmedRef.current = next;
            setConfirmed(next);
            settle(message.opId);
            return;
          }
          case 'rejected': {
            const mine = pendingRef.current.some(
              (p) => p.opId === message.opId,
            );
            settle(message.opId);
            // Say so once, for an op this tab is still waiting on.
            if (mine) refusedRef.current(message.reason);
            return;
          }
        }
      });

      ws.addEventListener('close', () => {
        window.clearInterval(pingTimer);
        if (cancelled || ws !== socket.current) return;
        socket.current = null;
        setStatus('offline');
        attempts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempts - 1));
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    /** Back online, or back on the tab: try now instead of waiting. */
    const retryNow = () => {
      if (!socket.current && !cancelled) {
        attempts = 0;
        connect();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') retryNow();
    };
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', onVisible);

    // A tick late, so StrictMode's double mount in dev never opens a socket
    // it closes again at once.
    reconnectTimer = window.setTimeout(connect, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', onVisible);
      socket.current?.close(1000, 'leaving');
      socket.current = null;
    };
  }, []);

  /* the cache: read once we know who we are, write as things settle */
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    idbGet<Cached>(CACHE_KEY)
      .then((value) => {
        if (!cancelled && value?.email === email && value.state) {
          setCached(value);
        }
      })
      .catch(() => {
        // No IndexedDB (private mode, blocked storage): live data only.
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (!email || !confirmed) return;
    const timer = window.setTimeout(() => {
      idbSet(CACHE_KEY, { email, ...confirmed } satisfies Cached).catch(
        () => {},
      );
    }, CACHE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [email, confirmed]);

  const base = confirmed?.state ?? cached?.state ?? null;
  const baseRef = useRef(base);
  baseRef.current = base;

  const state = useMemo(
    () => (base ? replay(base, pending) : null),
    [base, pending],
  );

  const submit = useCallback((raw: Op): boolean => {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      refusedRef.current(issue ? describeIssue(issue) : 'That is not valid');
      return false;
    }
    const current = baseRef.current;
    if (!current) {
      refusedRef.current('Still loading. Try again in a moment.');
      return false;
    }
    const op = parsed.data;
    const at = new Date().toISOString();
    // Try it first, so an impossible op never leaves the browser.
    try {
      reduce(replay(current, pendingRef.current), op, at);
    } catch (error) {
      if (error instanceof OpError) {
        refusedRef.current(error.message);
        return false;
      }
      throw error;
    }
    const entry: Pending = { opId: newId(), op, at };
    pendingRef.current = [...pendingRef.current, entry];
    setPending(pendingRef.current);
    // Before the first snapshot it waits; the snapshot handler sends it.
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN && confirmedRef.current) {
      sentOn.current.set(entry.opId, ws);
      ws.send(JSON.stringify({ type: 'op', opId: entry.opId, op }));
    }
    return true;
  }, []);

  const actions = useMemo(() => {
    const out: Record<string, (input: Record<string, unknown>) => unknown> = {};
    for (const type of Object.keys(OP_TYPES) as OpType[]) {
      out[type] = (input) => {
        if (type in CREATES) {
          const id = (input.id as string | undefined) ?? newId();
          return submit({ ...input, type, id } as Op) ? id : null;
        }
        return submit({ ...input, type } as Op);
      };
    }
    return out as unknown as Actions;
  }, [submit]);

  const stale = confirmed === null && cached !== null;
  const pendingCount = pending.length;
  return useMemo(
    () => ({ state, status, stale, pendingCount, actions }),
    [state, status, stale, pendingCount, actions],
  );
}

function replay(state: Snapshot, pending: Pending[]): Snapshot {
  let next = state;
  for (const p of pending) {
    try {
      next = reduce(next, p.op, p.at).state;
    } catch {
      // The server will refuse it too; leave it out.
    }
  }
  return next;
}

export const DatapadContext = createContext<Datapad | null>(null);

/** The user's data, sync status and actions. Inside `DatapadProvider`. */
export function useDatapad(): Datapad {
  const value = useContext(DatapadContext);
  if (!value) {
    throw new Error('useDatapad must be used inside DatapadProvider');
  }
  return value;
}
