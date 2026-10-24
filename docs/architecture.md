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
                      ├─ GET  /api/export.json   DO.export()            (M1)
                      ├─ POST /api/import        DO.import(json)        (M1)
                      ├─ GET  /ws                DO.fetch() → acceptWebSocket()
                      └─ everything else: static assets, SPA fallback
                      │
                      ▼
                   DatapadObject (worker/datapad.ts), name = verified email
                      ├─ SQLite: docs(col, id, json, updated_at), meta(key, value)
                      ├─ onMessage: zod parse → reduce() → persist → broadcast {op, seq}   (M1)
                      ├─ snapshot on connect, {type: 'sync'} on a gap                    (M1)
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

## State changes (M1)

Every change is a typed op from `shared/protocol.ts`, applied by
`reduce()` in `shared/reducer.ts`: optimistically on the client, then
authoritatively in the object, which persists the changed rows and
broadcasts the op with a sequence number to every open tab and device.
Clients that see a gap ask for a fresh snapshot. Compound ops (cascading
deletes, moves, reorders, activity appends) are single ops so two devices
cannot clobber each other.

## Client

React 19 SPA. `useDatapad()` (M1) keeps a confirmed snapshot plus pending
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
