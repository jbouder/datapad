# MCP server

Datapad is an MCP server at `/mcp` (M14,
[#152](https://github.com/jbouder/datapad/issues/152)): Claude Code, Claude
Desktop and a claude.ai connector can talk to the signed-in owner's own
data, as typed tools over the same Durable Object the app uses. It is
modelled on holotable's MCP server.

This first part is the front door: sign-in, the endpoint, and two tools,
`whoami` and `list_spaces`. Read tools arrive with
[#153](https://github.com/jbouder/datapad/issues/153), write tools with
[#154](https://github.com/jbouder/datapad/issues/154).

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
email, so they can be revoked (#154 adds that to Settings). Tokens, codes
and client secrets are stored in `OAUTH_KV` only as hashes, and a grant's
email is encrypted with a key only its token can unwrap.

## The endpoint

Streamable HTTP in its stateless form: every POST carries its own bearer
and is answered once, with one JSON body. There is no session id and no
server-initiated stream, so `GET /mcp` is `405`. JSON-RPC batches are
refused. Protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`.

At `initialize` the server tells the model how the data is shaped: it is
split into spaces (call `list_spaces` first; `main` is the default), ids
are opaque, dates are `YYYY-MM-DD`, names match ignoring case, read before
you write.

A failure a model can fix (a bad argument, an unknown space, the rate
limit) comes back as a tool result with `isError`, never as a protocol
error. Each token may make 60 tool calls a minute
(`LIMITS.mcpCallsPerMinute`).

## The tools

| Tool          | Scope  | Returns                                                                                                                                                   |
| ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`      | `read` | The email this connection acts for, its scopes, and every space with its counts (projects, archived projects, tasks, open tasks, notes, meetings, people) |
| `list_spaces` | `read` | Every space (id, name, position, created) in the order the app shows them                                                                                 |

`tools/list` shows only the tools the token's scopes allow, each with its
arguments as JSON Schema generated from the zod schema that validates them.

## What a client can and cannot do

- It acts as you, in every one of your spaces, and nobody else. No tool
  argument can name another user's object: the object is chosen by the
  email in the grant, which only the consent page, behind Access, writes.
- It cannot reach anything but `/mcp` with its token: the app's `/api/*`
  and `/ws` still want Access, and ignore a bearer.
- It cannot reach `/mcp` with an Access cookie or JWT: no bearer, no entry.
- It cannot change anything yet. Write tools (#154) will need the `write`
  scope.
- It cannot erase or delete a space, or touch backups.

## Tests

`test/mcp.test.ts` runs in workerd: discovery, registration, the consent
page behind a signed Access JWT, PKCE, refresh, the official SDK client
(`@modelcontextprotocol/sdk`) over `SELF` for `initialize`, `tools/list`,
`whoami` and `list_spaces`, and the refusals: no bearer, a cookie only, a
token not issued here, `GET`, one email's token against another's object,
a revoked grant, the rate limit. `test/headers.test.ts` holds the consent
page to the same header and CSP rules as the rest of the Worker.
