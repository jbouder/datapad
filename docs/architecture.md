# Architecture

Datapad is one Cloudflare Worker and one Durable Object class. Cloudflare
Access sits in front of the hostname.

```
Browser ──HTTPS──▶ Cloudflare Access (login, session cookie, signed JWT)
                      │
                      ▼
                   Worker (worker/index.ts)
                      ├─ verifyAccess(): Cf-Access-Jwt-Assertion → email, else 401
                      ├─ GET  /api/config                 { email }
                      ├─ GET  /api/health                 DO.ping() → { ok }        no data
                      │  on one space, ?space= (missing → main, unknown → 404):
                      ├─ GET  /api/export.json            DO.export(space)
                      ├─ POST /api/import                 DO.import(space, json)   merge by id
                      ├─ GET  /api/backups                DO.backups(space)
                      ├─ GET  /api/backups/<day>.json     DO.readBackup(space, day)
                      ├─ POST /api/backups/restore        DO.restoreBackup(space, day)
                      ├─ GET  /api/erase-token            DO.eraseToken(space)
                      ├─ POST /api/erase                  DO.erase(space, token)   the only delete-all
                      │  the list of spaces (ids in the body):
                      ├─ GET  /api/spaces                 DO.listSpaces()
                      ├─ POST /api/spaces/create          DO.createSpace(name)
                      ├─ POST /api/spaces/rename          DO.renameSpace(id, name)
                      ├─ POST /api/spaces/reorder         DO.reorderSpaces(ids)
                      ├─ POST /api/spaces/delete          DO.deleteSpace(id, token)
                      ├─ POST /api/spaces/move-project    DO.moveProject(from, to, id)
                      ├─ GET  /ws?space=<id>              DO.fetch() → acceptWebSocket()
                      └─ everything else: static assets, SPA fallback
                      │
                      ▼
                   DatapadObject (worker/datapad.ts), name = verified email
                      ├─ SQLite: docs(space, col, id, json, updated_at),
                      │          spaces(id, name, position, seq, created_at), meta, op_ids
                      ├─ onMessage: zod parse → reduce() → persist → broadcast {op, seq} on that space
                      ├─ snapshot on connect, {type: 'sync'} on a gap, {type: 'spaces'} when the list changes
                      └─ alarm(): nightly export of every space to the R2 BACKUPS bucket, keep 30 each
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

The MCP paths are the one exception to "Access first" (`worker/mcp/`,
[mcp.md](mcp.md)): `/mcp`, `/oauth/token`, `/oauth/register` and
`/.well-known/oauth-*` go to the OAuth provider before the Access check, and
the provider admits only a bearer it issued. `/oauth/authorize`, where the
owner approves a client, is checked against Access like every page, and is
the only place an email enters a token. On `/mcp` the grant's email names
the Durable Object, and each tool is an RPC on it.

## One object per user

`env.DATAPAD.getByName(email)` with the verified, lowercased email. That is
the only way a Durable Object is reached. A second person signing in gets a
second, empty object; nothing is shared.

Inside the object the data is split into **spaces**: each a complete,
separate Datapad with its own documents, snapshot and sequence number. A
user starts with one, `main` ("Main"), and may have up to
`LIMITS.spacesMax` (12). `?space=` on `/ws` and on the scoped routes, and
the ids in the `/api/spaces*` bodies, only choose among the spaces of the
object the email already named; they never choose the object, and a space
id is not a credential. A scoped route without `?space=` works on `main`,
so a client from before spaces keeps working; an unknown space is 404 "No
such space". Space names are unique ignoring case and at most 40
characters (`shared/spaces.ts`). `main` is not special: any space but the
last can be deleted.

## State changes

Every change is a typed op from `shared/protocol.ts`, applied by
`reduce()` in `shared/reducer.ts`: optimistically on the client, then
authoritatively in the object, which persists the changed rows and
broadcasts the op with that space's next sequence number to every tab and
device open on that space. An op only ever changes one space.
Clients that see a gap ask for a fresh snapshot. Compound ops (cascading
deletes, moves, reorders, activity appends) are single ops so two devices
cannot clobber each other.

Moving a project to another space is the one change that spans two spaces,
so it is not an op: `POST /api/spaces/move-project` builds the project's
subtree (`projectSubtree()`), `merge()`s it into the target, removes it
from the source (`removeSubtree()`), writes both in one transaction, and
sends a fresh snapshot to the sockets on each space. See
[data.md](data.md#moving-a-project-to-another-space).

`reduce(state, op, now)` is pure: ids arrive in the op and the time as
`now`, so the client and the object compute the same result. It returns
the next state and `changed`, the rows it touched (`{col, id}` or
`{col, id, deleted: true}`), and throws `OpError` with a sentence the UI
can toast when the op cannot apply.

### The message protocol

One WebSocket per tab at `/ws?space=<id>`, JSON text frames, following
one space. A missing or unknown id opens the first space; the snapshot
says which it opened. The socket's space is in its attachment, so it
survives hibernation. Switching spaces closes the socket and opens
another. `ping` / `pong` keep it alive (answered by the runtime without
waking the object).

| Direction       | Message                                                   | When                                                                                      |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| server → client | `{ type: 'snapshot', seq, state, recent, space, spaces }` | On connect, on `sync`, and to the space's sockets after an import, restore, erase or move |
| client → server | `{ type: 'op', opId, op }`                                | Every change; `opId` is the client's, to match the echo                                   |
| server → client | `{ type: 'op', seq, opId, op, at }`                       | To **every** socket on that space, the sender's included, once the op is stored           |
| server → client | `{ type: 'rejected', opId, reason }`                      | Only to the sender: invalid, impossible, too large, or over the flood limit               |
| server → client | `{ type: 'ack', opId }`                                   | Only to the sender: that op id was already applied (a replay); nothing changed            |
| client → server | `{ type: 'sync' }`                                        | After a sequence gap, or when the client's reducer disagrees with an echoed op            |
| server → client | `{ type: 'spaces', spaces }`                              | To every socket, on every space, when a space is created, renamed, reordered or deleted   |
- `space` is the space the socket opened and `state` is that space's;
  `spaces` is every space, in switcher order.
- When a space is deleted, its sockets are closed with code `4004`
  (`SPACE_DELETED_CLOSE`, reason "space deleted") before anything else is
  sent. The client does not reconnect to it; it asks for the list and
  opens another space.
- When the Access session a socket opened under has ended, the socket is
  closed with code `4401` (`SESSION_EXPIRED_CLOSE`, reason "session
  expired") at its next message, or instead of the next thing sent to it.
  The client asks `GET /api/health`: signed out shows "Sign in again",
  otherwise it reconnects at once and resends what is waiting
  ([security](security.md#sockets-and-the-session)).
- `seq` is per space and goes up by one per stored op (a no-op too, so its
  sender gets an echo). A client at `seq` n that receives n + 2 has missed one and asks
  for `sync`.
- `recent` lists the last `LIMITS.recentOps` op ids the object applied.
  A client that reconnects drops pending ops listed there (their echo went
  to the socket that closed) and resends the rest once per socket.
- The object also remembers the last `LIMITS.opIdsKept` (1 000) op ids in
  its `op_ids` table. An op whose id is there is answered with `ack` and
  not applied again, so replaying an offline queue is always safe.
- `at` is the object's clock when it applied the op. Clients pass it to
  `reduce()` so their confirmed state matches the object's byte for byte.
- Each socket may send `LIMITS.opsPerSecond` ops per second; more are
  rejected, not dropped, so the sender rolls back its optimistic copy.
- Messages over `LIMITS.messageBytes`, and documents over
  `LIMITS.docBytes`, are rejected with a readable reason.

### Storage

`docs(space, col, id, json, updated_at)` holds one row per document,
keyed `(space, col, id)`. `spaces(id, name, position, seq, created_at)`
lists the spaces: `position` is the switcher order, `seq` that space's
sequence number. `meta` holds the schema version, the last backup time
and a pending erase token (which records its space). `op_ids(op_id, seq)`
is the idempotency table, one for every space (op ids are random, so
they never collide). The object loads every space into memory when it
starts (again after hibernation), and writes only the rows in `changed`,
with the space's new `seq`, in one `transactionSync`.

An object from before spaces migrates on its first wake (schema version 2
in `meta`): in one transaction every `docs` row moves into `main`, the
`spaces` table is created with `main` in it, and `main` takes over the old
`seq` from `meta`, so open clients carry on without a resync. A failed
migration leaves the old layout whole and runs again on the next wake.

Schema version 3 turns the typed `events` rows from before meetings into
meetings and moves milestones onto their project. On the first wake after
the upgrade, in one transaction,
each space's projects, notes and `events` rows go through
`shared/migrate.ts` (the same function every import runs): the `events`
rows are gone, the changed rows are written (`meetings` rows, projects
with `milestones`, notes with `meetingId`), and the space's `seq` goes up
by one so every open or cached client takes a fresh snapshot rather than
replaying ops across the change. A space that never changed keeps `seq`
0.

## Client

React 19 SPA. `useDatapad()` keeps a confirmed snapshot plus pending
ops and caches the last snapshot in IndexedDB for instant first paint.
The pending ops are in IndexedDB too (`datapad:pending`), written on every
change (and copied synchronously to `localStorage` as `datapad:pending-now`,
because an IndexedDB write can lose the race with an immediate reload), so writes made offline, or in a tab closed before their echo,
come back on the next load and are sent, in order and with their original
op ids, on the next connection. Tabs share that store and merge into it
atomically, keeping each other's ops until some tab sees them settle. A
change the object refuses on replay is dropped and toasted by name
("Not saved: add task “…”. reason"). The sync status (at the foot of the
rail on desktop, in the top bar on phones, led by a dot colored ok, warn or
destructive; on phones the dot alone unless offline) says Saved, Saving… or "Offline, N changes
waiting"; only connecting and offline are announced, and it never blocks. The
router is holocron's small pushState router; route changes run inside a
`page` view transition. Its pure half (parsing, paths, page titles, and
the redirects from old addresses, such as the meetings page's address
from before meetings, which keeps its query and renames the id
parameter to `meeting`) is `shared/routes.ts`, so Vitest tests it
without a DOM; `src/lib/router.ts` re-exports it.

The pages most visits never open (Whiteboard, Help, Digest, Settings and
a meeting's and a task's page) are chunks of their own
(`src/pages/lazy.tsx`), rendered inside the page's error boundary with an
empty, `aria-busy` Suspense fallback. They are fetched anyway once the
browser is idle, and a first visit straight to one loads its chunk before
the first render (`src/main.tsx`), so a loaded page never suspends. A
chunk that fails to load is a page that threw: "This view stopped
working", whose Reload this view fetches it again.
`scripts/budget.ts` holds the entry (what `index.html` loads up front) to
a gzip budget in CI.

The active space is remembered per device in `localStorage`
(`datapad:space`), not in the URL, so a link opens in whatever space is
active. `DatapadProvider` opens one socket on it and shares `useSpaces()`
(the list, the current space, `switchSpace`, `openInSpace`,
`createSpace`). Every cache key is per space (`keyFor()` in
`src/lib/spaces.ts`): `main` keeps the keys from before spaces
(`datapad:snapshot`, `datapad:pending`, `datapad:pending-now`), so nothing
cached or queued is lost, and any other space appends its id
(`datapad:snapshot:<id>`). Switching runs inside a `space` view
transition (the page and the rail crossfade); from a project, person or
org page it goes to Focus, since that item belongs to the space being
left. With more than one space, the tab title carries the space's name
("Tasks · Personal · Datapad").

Page preferences (#186) live in the space's `settings` document
(`pages`), changed by `setPagePrefs` (merge; `null` clears) and
`resetPagePrefs`, neither logged. `shared/pages.ts` is the pure half:
what each page remembers, `effectiveQuery()` (the address over what is
saved), `planChange()` (what a change writes, saves and pins on the
history entry it leaves) and the one-time carry-over from the old
`localStorage` keys. `PagePrefsProvider` holds the rest: it coalesces
changes for 500 ms into one op (sent at once when the tab hides), carries
over this browser's old keys once per space, and says when the live state
is in. `usePageQuery()` (the filters) and `useView()` (the layout) read
what is saved once, as the page opens with that state, then follow only
the page's own changes; `Section` with `remember` saves open or closed.

## Summaries

In the browser: `@mlc-ai/web-llm` in a Web Worker
(`src/lib/summary.worker.ts`) with holocron's model list and request
settings, streamed. `shared/summaries.ts` holds the models, the prompt and
the context builders; `src/lib/summary-engine.ts` wraps one loaded model
(unit-tested with a fake); `src/lib/summary-runtime.ts` loads WebLLM lazily,
so the library is not in the main bundle (`scripts/budget.ts` fails CI if
it ever is) and nothing downloads until the owner agrees. Every WebLLM call
gets `src/lib/summary-pins.ts`'s `appConfig`: the WebGPU library from a
commit of `binary-mlc-llm-libs` and the weights from a Hugging Face
revision, never a branch, with SRI hashes WebLLM checks for the library,
the model's config and its tokenizer (it has no option for the weight
shards; the pinned revision is what fixes those). `SummaryProvider` keeps the model loaded between summaries and
owns the `Summary · <item>` panel. No Worker route and no API key are
involved.

## Backups

Each object books a Durable Object alarm for `BACKUP_HOUR` in
`BACKUP_TIME_ZONE` (`shared/schedule.ts`, holocron's reset-time maths). The
alarm writes each non-empty space's export to R2, prunes each space's
folder to 30 and books the next night. A failed run is logged, kept as
`failedAt` (Settings → Backups says so in `warn`), and retried after 15
minutes, an hour and four hours, then on the next night. `main` writes to
`<email>/datapad-YYYY-MM-DD.json`, where backups were before spaces; any
other space to `<email>/<spaceId>/datapad-YYYY-MM-DD.json` (the email is
the object's own name, `ctx.id.name`). A socket connection catches up a missed night. `GET
/api/backups`, `GET /api/backups/<day>.json` and `POST
/api/backups/restore` run on the signed-in user's object like every other
route, so nobody can list or read another user's folder, and take
`?space=` like the other scoped routes. Restore goes
through the same `merge()` and transaction as Import. See
[data.md](data.md#backups).

## Failures

Every failure the owner can meet, what they see, and the test that proves
it:

| Failure                                      | What the owner sees                                                                                                                                                                                                                                                                               | Test                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The socket drops, or the device goes offline | Sync status says "Offline, N changes waiting" in `warn`; reads keep working, writes queue (in IndexedDB too) and replay in order on reconnect, which backs off to 15 s and retries at once on `online` or when the tab is shown                                                                   | `e2e/sync.spec.ts`                                                     |
| The server refuses a change                  | Toast "Not saved: add task “…”. <reason>"; the change is dropped from the queue                                                                                                                                                                                                                   | `e2e/errors.spec.ts`                                                   |
| An import is not valid                       | Toast naming the file and why ("notes.txt is not JSON")                                                                                                                                                                                                                                           | `e2e/data.spec.ts`                                                     |
| A call gets no answer                        | Toast "Could not reach Datapad. Check the connection and try again."                                                                                                                                                                                                                              | `e2e/errors.spec.ts`                                                   |
| A summary fails (download, GPU memory)       | The panel says what happened and offers Try again and Pick another model                                                                                                                                                                                                                          | `e2e/summaries.spec.ts`                                                |
| The Access session ends mid-session          | When the socket cannot reconnect, `GET /api/health` is asked; a 401 or Access's redirect to its login means signed out, and the app shows "Sign in again" in place of the shell and stops reconnecting. Every other call does the same check (`call()` in `src/lib/api.ts`, `redirect: 'manual'`) | `e2e/errors.spec.ts`                                                   |
| A page throws while rendering                | "This view stopped working" in place of the page, with Reload this view; the rail, top bar and other pages keep working. A note being written is a draft in sessionStorage and comes back                                                                                                         | `e2e/errors.spec.ts`                                                   |
| Something outside a page throws              | "Datapad stopped working" and Reload Datapad                                                                                                                                                                                                                                                      | `e2e/errors.spec.ts`                                                   |
| The nightly backup fails                     | Retried (above); Settings → Backups: "The latest attempt failed … and is retried on its own." in `warn`, or "Last backup: …" in `warn` once a space with data has gone two days without one                                                                                                       | `test/backups.test.ts`, `test/schedule.test.ts`, `e2e/backups.spec.ts` |
| The object cannot be reached                 | `GET /api/health` answers 503 `{ ok: false }`                                                                                                                                                                                                                                                     | `test/datapad.test.ts`                                                 |
| The Worker is rolled back past a schema bump | Every route and the socket answer 503 "This Datapad's data is from a newer version; deploy that version again", `/api/health` as `{ ok: false, error }`; nothing is read or written, the backup alarm included. The app shows Offline until that version is deployed again                        | `test/newer-schema.test.ts`                                            |

## Logs

`npm run tail` (`wrangler tail`) streams the Worker's and the object's
logs; Workers observability keeps them in the dashboard. Each line the
code writes is one JSON object. None carries an email, a token, a request
body or anything from a document: the path, the error's message, ids and
counts (`worker/log.ts`).

Every response the Worker makes carries `x-request-id`: the request's
`cf-ray`, which also names it in Cloudflare's own logs (a random id in
local runs). A 500 puts it in its body as `requestId` and its log line
carries the same, so an id read off a failure finds the line.

| Line                                                            | Meaning                                                                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"level":"error","path":"/api/…","requestId":"…","error":"…"}` | A route threw something other than "no such space"; the client got 500 `{ error: "Something went wrong", requestId }`. Also for the OAuth paths (`/oauth/token`, …). |
| `{"level":"error","path":"/mcp","error":"…"}`                   | The MCP endpoint threw outside a tool; the client got a JSON-RPC error.                                                                         |
| `{"level":"error","what":"client","requestId":"…","where":"page","message":"…","componentStack":"…","version":"…"}` | A view crashed in the browser; its error boundary posted the error's message and component stack (names only) to `POST /api/client-error`, which takes at most 8 KB and nothing else. |
| `{"level":"info","what":"security","event":"grant","requestId":"…","outcome":"ok","clientId":"…","scope":["read"]}` | The owner allowed an MCP client on the consent page.                                                                                            |
| `{"level":"info","what":"security","event":"revoke","requestId":"…","outcome":"ok","grantId":"…","clientId":"…"}` | The owner revoked an MCP client in Settings → Connected apps.                                                                                    |
| `{"level":"info","what":"security","event":"erase","requestId":"…","outcome":"ok","space":"main"}` | Erase everything in a space; `outcome` is `refused` for a wrong or expired confirmation.                                                         |
| `{"level":"info","what":"security","event":"deleteSpace","requestId":"…","outcome":"ok","space":"…"}` | A space was deleted; `refused` for a wrong confirmation or the last space.                                                                      |
| `{"level":"info","what":"security","event":"import","requestId":"…","outcome":"ok","space":"main","imported":{…}}` | A file was imported into a space, with how many of each kind came in; `refused` when it was not valid.                                         |
| `{"level":"info","what":"security","event":"restore","requestId":"…","outcome":"ok","space":"main","imported":{…}}` | A backup was restored into a space; `refused` when there was none for that day.                                                                 |
| `{"level":"error","path":"/mcp","tool":"add_task","error":"…"}` | One MCP tool threw; the client got "The tool failed; the server log has the details."                                                           |
| `{"level":"error","what":"health","error":"…"}`                 | `GET /api/health` could not reach the object; it answered 503.                                                                                  |
| `{"level":"error","what":"startup","error":"…"}`                | The object could not start, so every call to it failed. After a rollback past a schema bump: the newer-version message (self-hosting.md).       |
| `{"level":"info","what":"backup","spaces":2,"bytes":48211}`     | A backup ran: how many spaces it wrote and their total size.                                                                                    |
| `{"level":"error","what":"backup","error":"…","retryAt":"…"}`   | A backup failed; `retryAt` is the next try. Without `retryAt`, the catch-up on connect failed before it could book one; the alarm is unchanged. |
| `{"level":"warn","message":"ACCESS DISABLED: …"}`               | The dev bypass is on (`ACCESS_AUD` empty and `DEV_ACCESS_EMAIL` set). Once per isolate. Never in a deployment.                                  |

Cloudflare's own fields come with each line: time, outcome, the request's
method and URL, and, in `wrangler tail`, the client's IP and country. A
401 from the Worker logs nothing of its own; Access's logs (Zero Trust →
Logs) record sign-ins.
