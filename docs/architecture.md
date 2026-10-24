# Architecture

Datapad is one Cloudflare Worker and one Durable Object class. Cloudflare
Access sits in front of the hostname.

```
Browser ──HTTPS──▶ Cloudflare Access (login, session cookie, signed JWT)
                      │
                      ▼
                   Worker (worker/index.ts)
                      ├─ verifyAccess(): Cf-Access-Jwt-Assertion → email, else 401
                      ├─ GET  /api/config        { email }
                      ├─ GET  /api/export.json   DO.export()
                      ├─ POST /api/import        DO.import(json)        merge by id
                      ├─ GET  /api/erase-token   DO.eraseToken()
                      ├─ POST /api/erase         DO.erase(token)        the only delete-all
                      ├─ GET  /ws                DO.fetch() → acceptWebSocket()
                      └─ everything else: static assets, SPA fallback
                      │
                      ▼
                   DatapadObject (worker/datapad.ts), name = verified email
                      ├─ SQLite: docs(col, id, json, updated_at), meta(key, value)
                      ├─ onMessage: zod parse → reduce() → persist → broadcast {op, seq}
                      ├─ snapshot on connect, {type: 'sync'} on a gap
                      └─ alarm(): nightly export to the R2 BACKUPS bucket, keep 30      (M6)
```

## Requests

Every request reaches the Worker first (`run_worker_first: true` in
`wrangler.jsonc`), static assets included. The Worker verifies the Access
JWT before it looks at the path; a request that fails gets `401`, as JSON
for `/api/*`, a short page for everything else, and a refused upgrade for
`/ws`. Assets are then served through the `ASSETS` binding, which still
applies `public/_headers`. Unknown paths fall back to `index.html` so deep
links work.

Access's own paths (`/cdn-cgi/access/*`, including logout) are answered at
the edge and never reach the Worker.

## One object per user

`env.DATAPAD.getByName(email)` with the verified, lowercased email. That is
the only way a Durable Object is reached. A second person signing in gets a
second, empty object; nothing is shared.

## State changes

Every change is a typed op from `shared/protocol.ts`, applied by
`reduce()` in `shared/reducer.ts`: optimistically on the client, then
authoritatively in the object, which persists the changed rows and
broadcasts the op with a sequence number to every open tab and device.
Clients that see a gap ask for a fresh snapshot. Compound ops (cascading
deletes, moves, reorders, activity appends) are single ops so two devices
cannot clobber each other.

`reduce(state, op, now)` is pure: ids arrive in the op and the time as
`now`, so the client and the object compute the same result. It returns
the next state and `changed`, the rows it touched (`{col, id}` or
`{col, id, deleted: true}`), and throws `OpError` with a sentence the UI
can toast when the op cannot apply.

### The message protocol

One WebSocket per tab at `/ws`, JSON text frames. `ping` / `pong` keep it
alive (answered by the runtime without waking the object).

| Direction       | Message                                    | When                                                                           |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| server → client | `{ type: 'snapshot', seq, state, recent }` | On connect, on `sync`, and to every socket after an import or erase            |
| client → server | `{ type: 'op', opId, op }`                 | Every change; `opId` is the client's, to match the echo                        |
| server → client | `{ type: 'op', seq, opId, op, at }`        | To **every** socket, the sender's included, once the op is stored              |
| server → client | `{ type: 'rejected', opId, reason }`       | Only to the sender: invalid, impossible, too large, or over the flood limit    |
| client → server | `{ type: 'sync' }`                         | After a sequence gap, or when the client's reducer disagrees with an echoed op |
- `seq` goes up by one per stored op (a no-op too, so its sender gets an
  echo). A client at `seq` n that receives n + 2 has missed one and asks
  for `sync`.
- `recent` lists the last `LIMITS.recentOps` op ids the object applied.
  A client that reconnects drops pending ops listed there (their echo went
  to the socket that closed) and resends the rest once per socket.
- `at` is the object's clock when it applied the op. Clients pass it to
  `reduce()` so their confirmed state matches the object's byte for byte.
- Each socket may send `LIMITS.opsPerSecond` ops per second; more are
  rejected, not dropped, so the sender rolls back its optimistic copy.
- Messages over `LIMITS.messageBytes`, and documents over
  `LIMITS.docBytes`, are rejected with a readable reason.

### Storage

`docs(col, id, json, updated_at)` holds one row per document; `meta` holds
`seq` and a pending erase token. The object loads every row into memory
when it starts (again after hibernation), and writes only the rows in
`changed`, with the new `seq`, in one `transactionSync`.

## Client

React 19 SPA. `useDatapad()` keeps a confirmed snapshot plus pending
ops and caches the last snapshot in IndexedDB for instant first paint. The
router is holocron's small pushState router; route changes run inside a
`page` view transition.

## Summaries (M6)

In the browser: `@mlc-ai/web-llm` in a Web Worker with holocron's model list
and settings. The context builders in `shared/summaries.ts` run on the
client. No Worker route and no API key are involved.

## Backups (M6)

A nightly alarm in each object writes a JSON export to the `BACKUPS` R2
bucket and keeps the latest 30. See [data.md](data.md).
