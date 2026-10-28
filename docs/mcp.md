# MCP server

Datapad is an MCP server at `/mcp` (M14,
[#152](https://github.com/jbouder/datapad/issues/152)): Claude Code, Claude
Desktop and a claude.ai connector can talk to the signed-in owner's own
data, as typed tools over the same Durable Object the app uses. It is
modelled on holotable's MCP server.

It has sign-in, the endpoint, `whoami` and `list_spaces`, the read tools
([#153](https://github.com/jbouder/datapad/issues/153)), and the write
tools with Settings → Connected apps
([#154](https://github.com/jbouder/datapad/issues/154)).

## Connecting

The deployment needs the Access Bypass application and the `OAUTH_KV`
namespace first ([self-hosting.md § MCP clients](self-hosting.md#5-mcp-clients)).

**Claude Code**

```bash
claude mcp add --transport http datapad https://<host>/mcp
```

The first call opens a browser: the Cloudflare Access sign-in (skipped if
you are already signed in), then Datapad's consent page. Allow, and Claude
Code keeps and refreshes the tokens itself. `/mcp` in Claude Code shows the
connection; ask it to call `whoami` to check.

**claude.ai**: Settings → Connectors → **Add custom connector**, with the
URL `https://<host>/mcp`. The same sign-in and consent follow.

**Claude Desktop**: Settings → Connectors → **Add custom connector**, the
same URL. (Desktop also reads claude.ai's connectors when you are signed
in to the same account.)

**Locally**, with `npm run dev` and `.dev.vars` as in
[self-hosting.md § Local development](self-hosting.md#local-development):

```bash
claude mcp add --transport http datapad http://localhost:5173/mcp
```

With `ACCESS_AUD` empty the consent page signs in as `DEV_ACCESS_EMAIL`,
as every page does in development.

## How sign-in works

Browsers sign in with Cloudflare Access; an MCP client cannot. So Datapad
is also its own OAuth 2.1 authorization server, for MCP clients only, with
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider):
1. The client calls `/mcp` and gets `401` with a `WWW-Authenticate` header
   naming `/.well-known/oauth-protected-resource/mcp`, which names this
   origin as the authorization server; `/.well-known/oauth-authorization-server`
   lists the endpoints.
2. It registers itself at `/oauth/register` (dynamic client registration)
   and opens `/oauth/authorize` in a browser with a PKCE challenge (S256
   only).
3. `/oauth/authorize` is behind Access like every page: Access signs you
   in, and the Worker verifies the Access JWT. The consent page shows the
   client's name (self-asserted, and said so), the host the tokens will be
   sent to, a warning when that is an app on this computer, your email, and
   what it may do: **read** always, **write** if you tick it. Allow or Deny.
4. On Allow the Worker completes the authorization with your verified email.
   That is the only place an email enters a token. The client exchanges the
   code (with its PKCE verifier) at `/oauth/token`.
5. Every call to `/mcp` carries `Authorization: Bearer …`. The provider
   checks it was issued here, for this origin's `/mcp`, and is neither
   expired nor revoked; then the email in the grant names the Durable
   Object, exactly as Access's email does for the app.

Access tokens live an hour and the client refreshes them; a grant lasts
30 days from sign-in, then you connect again. Grants are listed under your
email: Settings → Connected apps shows each one and revokes it (below). Tokens, codes
and client secrets are stored in `OAUTH_KV` only as hashes, and a grant's
email is encrypted with a key only its token can unwrap.

## The endpoint

Streamable HTTP in its stateless form: every POST carries its own bearer
and is answered once, with one JSON body. There is no session id and no
server-initiated stream, so `GET /mcp` is `405`. JSON-RPC batches are
refused. Protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`.

At `initialize` the server tells the model how the data is shaped and
which tools to reach for in order: `list_spaces` (`main` is the default),
then `get_overview` or `get_focus`, then the specific reads. Ids are
opaque, dates are `YYYY-MM-DD`, names match ignoring case, lists are
capped, read before you write.

A failure a model can fix (a bad argument, an unknown space, the rate
limit) comes back as a tool result with `isError`, never as a protocol
error. Each token may make 60 tool calls a minute
(`LIMITS.mcpCallsPerMinute`).

## The read tools

Every read tool is read-only and needs the `read` scope. Each is a thin façade
over the `shared/` selectors the app's pages use (`select.ts`, `tasks.ts`,
`projects.ts`, `notes.ts`, `meetings.ts`, `orgs.ts`, `digest.ts`,
`search.ts`), run in the Worker over one space's snapshot (the Durable
Object's `snapshot(space)` RPC: read-only, no socket).

| Tool            | Arguments                                                                                                | Returns                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`        | none                                                                                                     | The email this connection acts for, its scopes, and every space with its counts (projects, archived projects, tasks, open tasks, notes, meetings, people)                                    |
| `list_spaces`   | none                                                                                                     | Every space (id, name, position, created) in the order the app shows them                                                                                                                    |
| `get_overview`  | `space`, `today`                                                                                         | The space's counts, the week's movement (closed, added, overdue), and each project outside the archive with status, health, priority, dates, next milestone, open and blocked counts         |
| `get_focus`     | `space`, `assignee`, `today`                                                                             | Focus: open tasks due overdue, today and this week (later and undated as counts), waiting on whom, the last week's meetings' open action items, projects needing attention, the 7-day agenda |
| `list_projects` | `space`, `status`, `health`, `org`, `archived`, `sort`, `today`                                          | Projects as the Projects page selects them (by default every status outside the archive, most recently updated first), each as on `get_overview`                                             |
| `get_project`   | `space`, `project`, `today`                                                                              | One project (or `general`): details, members, links, milestones, open tasks in order, the 10 latest notes (pinned first), 5 upcoming and 5 recent meetings with topics, 25 activity lines    |
| `list_tasks`    | `space`, `project`, `status`, `assignee`, `due`, `blocked`, `meeting`, `query`, `sort`, `limit`, `today` | Tasks as the Tasks page selects them, soonest due first; `due` is a Focus bucket: `overdue`, `today`, `week`, `later`, `none`                                                                |
| `list_notes`    | `space`, `project`, `meeting`, `pinned`, `query`, `limit`                                                | Notes as the Notes page selects them, newest first (50 by default); the space's Notepad is a General note with `notepad: true`                                                                                                                           |
| `list_meetings` | `space`, `project`, `from`, `to`, `limit`                                                                | Meetings soonest first with attendees, topics (done, outcome, carried from) and counts of notes and open and done action items                                                               |
| `list_people`   | `space`                                                                                                  | Everyone by name: role, whether it is you, their projects, their open tasks and the open tasks waiting on them                                                                               |
| `list_orgs`     | `space`, `archived`                                                                                      | Orgs by name: kind, contacts, links, notes and projects                                                                                                                                      |
| `get_digest`    | `space`, `weekEnding`                                                                                    | The weekly digest for the seven days ending that day: per project what closed, was added, changed, met and is due, with totals and the Digest page's Markdown                                |
| `search`        | `space`, `query`, `kinds`, `limit`                                                                       | The ⌘K search over projects, tasks, notes, meetings and their topics, orgs, people and whiteboard text, ranked as the palette ranks, with a count per kind                                   |

The rules every tool keeps:
- **`space`** is an id or a name (ignoring case); `main` when omitted. An
  unknown space is an error naming `list_spaces`.
- **Names for ids.** Where a tool takes a `project`, `assignee` (also `me`
  and `unassigned`), `org` or `meeting`, an id works, or a name: equal
  ignoring case, else the one name that contains it. A name that matches
  several returns the candidates' ids and names instead of a guess.
  `project: "general"` is General, the work in no project.
- **Lists** carry at most 200 items, as `{ count, truncated, items }`:
  `count` is how many matched, `truncated` whether `items` was cut.
  `limit` cuts sooner.
- **Text** shows mentions as `@Name`; people and projects come as
  `{ id, name }`.
- **Dates** are `YYYY-MM-DD`. "Today" is the owner's day in
  `BACKUP_TIME_ZONE` (the backup's zone, `America/New_York` by default)
  unless a call passes `today`; the digest's week runs midnight to
  midnight in that zone.

Retired data stays retired: decisions and a project's old one-line state
(#183) are kept in the export but no tool shows them, as no page does.

`tools/list` shows only the tools the token's scopes allow, each with its
arguments as JSON Schema generated from the zod schema that validates them.

## The write tools

Each write tool needs the `write` scope (ticked on the consent page); a
token without it does not see them and cannot call them. Each turns names
into ids (the same rule as the reads), words into dates (`shared/dates.ts`'
`parseDate`: `tomorrow`, `fri`, `next week`, `+3d`, `10/31`, `2026-11-02`,
relative to the owner's today or a passed `today`) and `@Name` into the
`@{id}` mention tokens the app stores, then makes **one change**: one op,
or two in one `batch` for `cover_topic`. It answers with the document as it
now is and the activity lines the change wrote (`{ project, text }`,
`project` null for General).

| Tool                 | Arguments                                                                                                              | Op                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `add_task`           | `space`, `title`, `project`, `meeting` (an action item), `assignee`, `due`, `priority`, `desc`, `tags`, `today`        | `addTask`                                         |
| `complete_task`      | `space`, `task`                                                                                                        | `toggleTask` (`done: true`)                       |
| `reopen_task`        | `space`, `task`                                                                                                        | `toggleTask` (`done: false`)                      |
| `edit_task`          | `space`, `task`, `title`, `due` (`none` clears), `priority`, `assignee` (`unassigned` clears), `desc`, `tags`, `today` | `editTask`                                        |
| `set_blocked`        | `space`, `task`, `blocked` (false unblocks), `on`, `note`                                                              | `setBlocked`                                      |
| `add_note`           | `space`, `body`, `project`, `meeting` or `task`                                                                        | `addNote`                                         |
| `add_meeting`        | `space`, `title`, `date`, `time`, `end`, `project`, `attendees`, `link`, `note`, `today`                               | `addMeeting`                                      |
| `add_topic`          | `space`, `meeting`, `title`                                                                                            | `addTopic`                                        |
| `cover_topic`        | `space`, `meeting`, `topic`, `done` (default true), `outcome`                                                          | `toggleTopic`, plus `editTopic` for the outcome   |
| `create_project`     | `space`, `name`, `org`, `status`, `health`, `priority`, `startDate`, `targetDate`, `desc`, `tags`, `members`, `today`  | `createProject` (an `org` naming an Org links it) |
| `set_project_status` | `space`, `project`, `status`                                                                                           | `setStatus`                                       |
| `set_project_health` | `space`, `project`, `health`                                                                                           | `setHealth`                                       |
| `add_milestone`      | `space`, `project`, `title`, `date`, `today`                                                                           | `addMilestone`                                    |

A `task` is an id or a title (ignoring case, or a unique part of it);
ids from `list_tasks` are safest.

**How a write lands.** The tool builds the op with ids it makes
(`shared/ids.ts`, as the app does) and calls the Durable Object's
`apply(space, opId, ops)`. That runs exactly the path a socket's op takes:
`OpSchema` validation (several ops go as one `batch`: all or nothing),
`MCP_OP_TYPES` (`shared/protocol.ts`: the add and edit ops the write
tools build, and nothing else; one op off it, alone or in a batch,
refuses the whole change), the socket's size limit, op-id dedupe, `reduce()` with the object's clock
as `now`, the touched rows and the space's next sequence number in one
transaction, and the op broadcast to every socket open on that space. So an
open tab shows the change at once, with no reload, and the change logs in
Activity as the same action in the app would. A refusal, the schema's or
the reducer's, comes back as `Not saved: <reason>.` Nothing in the Worker
or the object changes a space for MCP any other way.

Retired ops stay off MCP as they are off the app: no decisions and no
project state line (#183).

## Connected apps

Settings → Connected apps (`/settings/connections`) lists the MCP clients
you approved: the name each gave itself, Read only or Read and write,
when it was connected, its last tool call, and when its grant expires.
**Revoke** asks first, then revokes the grant and every token it issued;
the app's next call gets `401`, and it has to connect and be approved
again. Grants are per email, not per space.

Behind it are `GET /api/connections` and `DELETE /api/connections/<grantId>`,
behind Access like every page (and the delete refuses a cross-site
request). Both look grants up under the signed-in email's grant user id
only, so a grant can only be listed or revoked by the email it belongs to;
the grant id is not a credential. The last use is kept per client in the
Durable Object, written at most once a minute.

## What a client can and cannot do

- It acts as you, in every one of your spaces, and nobody else. No tool
  argument can name another user's object: the object is chosen by the
  email in the grant, which only the consent page, behind Access, writes.
- It cannot reach anything but `/mcp` with its token: the app's `/api/*`
  and `/ws` still want Access, and ignore a bearer.
- It cannot reach `/mcp` with an Access cookie or JWT: no bearer, no entry.
- Without the `write` scope it cannot change anything.
- With it, it can only add and edit through the write tools above. By
  design it **cannot**: delete anything (a task, note, meeting, topic,
  milestone, project, person or org), archive a project, erase a space,
  import, restore or list backups, create, rename, reorder or delete
  spaces, move a project between spaces, or change settings, navigation
  or page preferences. Those stay in the app. The object enforces it, not
  only the tool list: `apply()` refuses any op not on `MCP_OP_TYPES`.

## Tests

`test/mcp.test.ts` runs in workerd: discovery, registration, the consent
page behind a signed Access JWT, PKCE, refresh, the official SDK client
(`@modelcontextprotocol/sdk`) over `SELF` for `initialize`, `tools/list`,
`whoami` and `list_spaces`, and the refusals: no bearer, a cookie only, a
token not issued here, `GET`, one email's token against another's object,
a revoked grant, the rate limit. `test/headers.test.ts` holds the consent
page to the same header and CSP rules as the rest of the Worker.
`test/mcp-tools.test.ts` runs each read tool over an object seeded with
`test/fixtures/export.json`: the filters, the name rule and its
candidates, the 200-item cap, a space by name and an unknown one, and that
`tools/list` shows the schemas the same zod validates with. It runs each
write tool too, with the activity line it writes; that a write reaches an
open socket as the op; that `apply()` refuses what `OpSchema` or the
reducer refuses and dedupes an op id; that it refuses a delete, `remove`,
`put` or archive, alone or in a batch, writing nothing; that the ops the
write tools send are exactly `MCP_OP_TYPES`; and that a read-only token neither
sees nor runs a write tool. `test/mcp.test.ts` lists and revokes grants
through `/api/connections` (another email gets 404, a revoked token 401),
and `e2e/connections.spec.ts` does the same in the browser, desktop and
phone, and watches an MCP write appear in an open tab.
