# Security

Datapad holds one person's working notes about projects, clients and
colleagues. The goal is simple: nobody but the owner can read or change it,
and a configuration mistake fails closed.

## Threat model

| Threat                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone on the internet opens the app                                                                     | Cloudflare Access requires sign-in with the one allowed email before any request reaches the Worker.                                                                                                                                                                                                                                                                                                                                                                               |
| The Access application does not cover a hostname (a renamed route, a preview Worker, a new custom domain) | The Worker verifies the Access JWT itself on every request, assets included, and answers 401 without one. With `ACCESS_AUD` empty and no `DEV_ACCESS_EMAIL`, everything is 401.                                                                                                                                                                                                                                                                                                    |
| A forged or replayed token                                                                                | RS256 signature checked against the team's published keys; `aud` must be the app's AUD tag, `iss` the team domain, `exp` and `nbf` within 60 seconds of now. Unknown key ids refetch the keys at most every 30 seconds.                                                                                                                                                                                                                                                            |
| A signed-in user reaching someone else's data                                                             | The Durable Object is named only by the verified email. No URL, header, body or socket message can choose another object; a space id only picks among the user's own spaces. Tests try.                                                                                                                                                                                                                                                                                            |
| An MCP client reaching data without Access                                                                | Only `/mcp`, `/oauth/token`, `/oauth/register` and `/.well-known/oauth-*` skip the Access check (a Bypass application at the edge, and the Worker sends just those paths to the OAuth provider). `/mcp` admits only an unexpired, unrevoked bearer the provider issued for this origin; a token is issued only after the owner approved the client at `/oauth/authorize`, which is behind Access. See [MCP clients](#mcp-clients).                                                 |
| A stolen or replayed MCP token                                                                            | Access tokens live an hour, grants 30 days; refresh tokens rotate on use. PKCE (S256) is required, codes work once. Tokens, codes and client secrets are stored in KV only as hashes; the grant's email is encrypted with a key only the token unwraps. Revoking a grant refuses its next call. Each token is held to 60 tool calls a minute.                                                                                                                                      |
| A malicious app registering itself as a known client                                                      | The consent page says a registered name is unverified, shows the host the tokens go to and warns when it is a local app; nothing is granted without the owner's Allow, behind Access. The form's handle works once, for ten minutes, in the browser holding its `__Host-` cookie, and a cross-site post is refused.                                                                                                                                                                |
| The dev bypass left on in production                                                                      | It needs both an empty `ACCESS_AUD` and `DEV_ACCESS_EMAIL`, which lives only in `.dev.vars` (never deployed, git-ignored). With `ACCESS_AUD` set the bypass code path does not run. The Worker logs a loud warning whenever the bypass is active.                                                                                                                                                                                                                                  |
| Cross-site scripting                                                                                      | React escaping, a strict CSP with no inline script except the hashed theme script, and a Markdown renderer that emits no raw HTML. A document's links (a project's, task's, org's, a meeting's) become links only for `https:`, `http:` and `mailto:`, as in Markdown; a `javascript:` one from an import or an MCP client is shown as text.                                                                                                                                       |
| Clickjacking, MIME sniffing, referrer leaks                                                               | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`.                                                                                                                                                                                                                                                                                                                                                                                      |
| Cross-site requests                                                                                       | In the Access application's cookie settings, HttpOnly is on and SameSite is Lax. Every write (import, erase, backup restore, every `/api/spaces/*` write, revoking a connection) accepts `application/json` bodies only, which a cross-site form cannot send, and refuses any `Origin` but the app's own. The socket refuses any `Origin` but the app's own too: a WebSocket handshake is not subject to CORS, and a sibling subdomain is same-site, so a Lax cookie goes with it. |
| Data leaving the account                                                                                  | Summaries run on-device; the item's text never leaves the tab. The CSP's `connect-src` allows only this origin plus the model's download hosts (Hugging Face, `raw.githubusercontent.com`), which receive no data and no referrer.                                                                                                                                                                                                                                                 |
| Loss of data                                                                                              | Nightly R2 backups (latest 30 per space, in a private bucket, under the owner's email), JSON export; the backup alarm never deletes documents; erasing a space or deleting one takes a fresh, single-use token for that space (`/api/erase-token`), and a deleted space's backups stay. Erase, delete, import and restore first write the space to R2 (`before-<what>-<time>.json`) and do nothing if that fails.                                                                  |

## What Access protects, and what the Worker adds

Access handles identity: the login page, one-time PINs or SSO, the session
cookie, and logout. It signs every request it forwards with a short-lived
JWT in `Cf-Access-Jwt-Assertion`.

The Worker (`worker/access.ts`) checks that JWT on every request, so the
app's safety does not depend on the Access application being attached to
every hostname correctly. It also turns the token into the one thing that
selects data: the lowercased `email` claim names the Durable Object.

## Every path and its check

Every path is behind Access except the OAuth provider's own, and the
Worker checks Access again before anything else (`createHandler` in
`worker/index.ts`): no verified email is 401. "Same origin, JSON" is
`refuseCrossSite()`: a `POST` or `DELETE` with an `Origin` other than the
app's is 403, and one that is not `application/json` is 415. Every
`/api/*` and `/ws` path names the Durable Object by the verified email and
nothing else; "scoped" means `?space=` picks a space within it and an
unknown one is 404.

| Path                                      | Method    | Who                | Checks after that                                                                                                                                                                                                                  |
| ----------------------------------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/config`                             | GET       | Access             | Returns the email, nothing else                                                                                                                                                                                                    |
| `/api/health`                             | GET       | Access             | Pings the object; says nothing about the data                                                                                                                                                                                      |
| `/api/spaces`                             | GET       | Access             | The object's spaces                                                                                                                                                                                                                |
| `/api/spaces/create`, `rename`, `reorder` | POST      | Access             | Same origin, JSON; the body's zod schema; a named space must exist; names checked like any field; 12 spaces at most                                                                                                                |
| `/api/spaces/delete`                      | POST      | Access             | As above, plus the single-use erase token for that space; never the last space; [a copy first](#the-destructive-paths)                                                                                                             |
| `/api/spaces/move-project`                | POST      | Access             | As above; both spaces must exist; one transaction across the two                                                                                                                                                                   |
| `/api/export.json`                        | GET       | Access             | Scoped                                                                                                                                                                                                                             |
| `/api/import`                             | POST      | Access             | Same origin, JSON; scoped; 16 MB at most; `ExportSchema` in full before anything is written; [a copy first](#the-destructive-paths)                                                                                                |
| `/api/backups`                            | GET       | Access             | Scoped; that space's R2 folder only                                                                                                                                                                                                |
| `/api/backups/YYYY-MM-DD.json`            | GET       | Access             | Scoped; the path must match the date pattern, and the object builds the R2 key from its own email and the space, so no path can reach another folder                                                                               |
| `/api/backups/restore`                    | POST      | Access             | Same origin, JSON; scoped; the day checked as above; then exactly an import                                                                                                                                                        |
| `/api/erase-token`                        | GET       | Access             | Scoped; 24 random bytes, good for five minutes, for that space only; a new one replaces the last. Its answer is unreadable cross-origin (no CORS)                                                                                  |
| `/api/erase`                              | POST      | Access             | Same origin, JSON; scoped; the token, compared in constant time and used up either way; [a copy first](#the-destructive-paths)                                                                                                     |
| `/api/connections`                        | GET       | Access             | This email's MCP grants only                                                                                                                                                                                                       |
| `/api/connections/:id`                    | DELETE    | Access             | Same origin, JSON; the grant must be this email's, else 404                                                                                                                                                                        |
| any other `/api/*`                        | any       | Access             | 404                                                                                                                                                                                                                                |
| `/ws`                                     | GET       | Access             | A WebSocket upgrade (else 426); `Origin` must be the app's (else 403); `?space=` picks a space, an unknown one opens the first; every op parsed by `OpSchema`, 256 KB a message at most, deduplicated by op id, through `reduce()` |
| `/oauth/authorize`                        | GET, POST | Access             | The consent page; its POST must be same-origin (`Sec-Fetch-Site`, else `Origin`) and carry the single-use handle from its `__Host-` cookie; the grant's email is Access's                                                          |
| `/mcp`                                    | POST      | Bearer, not Access | An unexpired, unrevoked token the provider issued for this origin's `/mcp`; no cookie fallback; the object named by the grant's email; scope `write` for write tools; 60 calls a minute                                            |
| `/oauth/token`, `/oauth/register`         | POST      | Nobody (provider)  | A code with its PKCE verifier, or a refresh token; registration stores a client that can do nothing until approved, five a minute per IP, kept 60 days unless used                                                                 |
| `/.well-known/oauth-*`                    | GET       | Nobody (provider)  | Public metadata, no data                                                                                                                                                                                                           |
| everything else                           | GET       | Access             | The built app (static assets); unknown paths get `index.html`                                                                                                                                                                      |

Access's own `/cdn-cgi/access/*` paths are answered at the edge and never
reach the Worker. `test/datapad.test.ts`, `test/backups.test.ts`,
`test/spaces.test.ts` and `test/mcp.test.ts` try each row's refusals: no
identity, the wrong method, another origin, a body that is not JSON, an
unknown space, another user's object.

## Spaces

A user's spaces all live in that one object. The space id (`?space=` on
`/ws` and the scoped routes, `id` / `from` / `to` in the `/api/spaces/*`
bodies) is not a credential: it never names the object, so the worst a
forged one can do is reach another of your own spaces. Ids are random
UUIDs chosen by the object (`main` is fixed), and they appear in URLs and
in R2 keys, which is fine because they are not secret.

The Worker still checks every one. Each body is parsed with its zod
schema (`shared/protocol.ts`); a scoped route asks the object whether the
space exists before doing anything and answers 404 "No such space" when
it does not, and the object's RPCs refuse an unknown space too, as a
backstop. A socket asking for an unknown space gets the first space, never
another object's. Space names are checked like any document field (trimmed,
not empty, at most 40 characters, unique ignoring case), and a user can
have at most 12 spaces. Deleting a space takes the same single-use token
as erasing one, issued for that space only; the last space cannot be
deleted.

## MCP clients

Datapad is also an OAuth 2.1 authorization server, for MCP clients only
([mcp.md](mcp.md)), with `@cloudflare/workers-oauth-provider`. This is the
one exception to "Access first", and it is narrow:
- The Worker routes an allowlist of paths to the provider before
  `verifyAccess()`: `/mcp`, `/oauth/token`, `/oauth/register`,
  `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource` (and below them). Anything else
  the provider would answer falls through to a 404. Every other path is
  verified against Access as before.
- `/oauth/authorize` is not on the list. It is the sign-in: the Worker
  verifies the Access JWT, then shows the consent page, and on Allow
  completes the authorization with `props: { email }` from that verified
  identity. No other code writes an email into a grant.
- `/mcp` answers `401` (with a `WWW-Authenticate` naming the resource
  metadata) to anything without a bearer the provider issued, unexpired,
  unrevoked and for this origin's `/mcp`. There is no cookie fallback: an
  Access cookie or JWT alone gets `401`. Then the Durable Object is named by
  the grant's email and nothing else, as the app's is by Access's.
- A token is for `/mcp` only. `/api/*` and `/ws` still want Access and
  ignore a bearer.
- The consent page runs no script. Its CSP is `default-src 'none'`, its one
  style block allowed by hash, `form-action` this origin and the redirect's,
  `frame-ancestors 'none'`. Everything the client chose (its name, the
  redirect host) is escaped.
- The provider's own answers get the Worker's API headers (`nosniff`,
  `no-store`, `default-src 'none'`) where they do not set their own.
- `/oauth/register` is open, and each registration is a write to
  `OAUTH_KV`, so it is capped (#225). The Worker checks the
  `REGISTER_LIMIT` rate-limiting binding before the provider sees a
  `POST /oauth/register`: five a minute per client IP (`CF-Connecting-IP`,
  which Cloudflare sets and a client cannot), then `429` with
  `Retry-After: 60` and an OAuth error body (`temporarily_unavailable`).
  An MCP client registers once, when it is first connected. The limiter
  counts per Cloudflare location and is approximate; it stops one address
  from filling KV, not a botnet. For that, add a WAF rate-limiting rule on
  the path at the zone.
- A registered client is stored with a KV expiry of 60 days
  (`CLIENT_REGISTRATION_TTL_S`), so one nobody approved goes by itself,
  with no sweep. A client in use is not lost: the provider writes it again
  with a fresh 60 days on a token request once less than half is left, so
  after the code exchange it has at least 30 days, and a grant lasts at
  most 30. When it does go, the client registers again.

## The destructive paths

Three things can remove or overwrite data in bulk: erase (with deleting a
space, which is erase plus the space itself), import, and restore. Each
was reviewed for who can trigger it, what it can reach, and how it is
undone.

| Path                                  | What it changes                                                                         | Guard                                                                                                                                       | Way back                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Erase (`/api/erase`)                  | Deletes every document in one space; the space stays                                    | Same origin, JSON; a token from `/api/erase-token` for that space, five minutes, single use, used up by a wrong guess; no button in the app | `before-erase-…` in R2, and the nightly backups                           |
| Delete a space (`/api/spaces/delete`) | Deletes the space and its documents; closes its sockets                                 | As erase, plus the name typed exactly in the app; never the last space                                                                      | `before-delete-…` in that space's R2 folder; its nightly backups stay too |
| Import (`/api/import`)                | Replaces documents whose ids are in the file; deletes nothing; "me" moves to the file's | Same origin, JSON, 16 MB, the whole file valid first; one transaction                                                                       | `before-import-…` in R2                                                   |
| Restore (`/api/backups/restore`)      | An import of one of the space's own nightly files                                       | As import; only a date-named file in that space's own folder                                                                                | `before-restore-…` in R2                                                  |

The copy is written before the change and the change waits for it: if R2
refuses, nothing is erased, deleted or merged and the call fails
(`test/backups.test.ts`). An empty space writes no copy. The copies are
outside the names the app lists and the nightly prune deletes, so they stay
until the owner deletes them. Restore one by hand like any backup
([data.md](data.md#backups)).

Over MCP none of these exist: no tool deletes, archives, erases, imports,
restores, moves between spaces or touches spaces or settings.

## What the logs contain

- **Access logs** (Zero Trust → Logs): your email, IP address, sign-in
  times and the application. This is by design.
- **Worker logs** (Workers observability): request metadata as Cloudflare
  records it, and the Worker's own lines, listed in
  [architecture.md](architecture.md#logs). Those carry a path, a tool name,
  counts and an error message, never the email, tokens, document content
  or request bodies. Cloudflare's own record of a request can include its
  URL and headers, and Access adds the signed-in email as a header, so the
  owner's email can appear there; the logs are in the owner's account and
  readable only by its members.
- **R2**: the backup keys start with the email (`<email>/…`), in the
  owner's private bucket.

## Transport and headers

All traffic is HTTPS (workers.dev and custom domains on Cloudflare).

Static assets get `public/_headers`:
- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self'`
  plus the SHA-256 of the inline theme script in `index.html` and
  `'wasm-unsafe-eval'` (WebAssembly for the summary model; no JavaScript
  eval); `style-src 'self' 'unsafe-inline'` (style attributes from the UI
  library); `connect-src 'self'` (API and WebSocket) plus the summary
  model's download hosts, `https://huggingface.co`,
  `https://*.huggingface.co`, `https://*.hf.co` and
  `https://raw.githubusercontent.com`, exactly as holocron allows for the
  same model; `worker-src 'self'` (the model's Web Worker); `img-src 'self'
  data: blob:` (`blob:` for the whiteboard's PNG export); `font-src 'self'
  data:`; `manifest-src 'self'`; `object-src 'none'`; `base-uri 'none'`;
  `form-action 'self'`; `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, and a `Permissions-Policy` that turns off
  camera, microphone, geolocation, payment, USB, serial, Bluetooth, HID and
  MIDI.

The Worker's own responses (`/api/*`, `/ws`, `/mcp`, the OAuth endpoints, the 401 page) carry
`default-src 'none'` CSP, `nosniff`, `DENY`, `no-referrer` and
`Cache-Control: no-store`.

`test/headers.test.ts` parses `index.html` and fails if the inline script
changes without its hash being updated in `_headers`, and if any directive
allows another origin. Check a deployment with:

```bash
curl -sI https://<host>/ -H 'cf-access-jwt-assertion: …'
```

Access's `/cdn-cgi/access/*` paths are answered at the edge, before the
Worker and before these headers.

## Supply chain

- **Dependencies.** `bun install --frozen-lockfile` everywhere, so CI and
  deploys install exactly `bun.lock`. `bun audit --audit-level=moderate`
  runs in CI's `check` job. Dependabot proposes updates monthly; majors are
  reviewed by hand (docs/self-hosting.md → Dependency updates). The Worker
  bundle carries only the runtime dependencies it imports (zod, the OAuth
  provider); everything else is build and test tooling.
- **Workflows.** Every action is pinned to a commit SHA
  (`test/workflows.test.ts`). Workflows default to `contents: read`; CodeQL
  alone adds `security-events: write`, and only `deploy.yml` sees the
  Cloudflare secrets, from the `production` environment, after a green CI
  run of a commit on this repository's `main`. Nothing uses
  `pull_request_target`, so a fork's PR runs with a read-only token and no
  secrets.
- **Code scanning.** CodeQL (security-extended) over the TypeScript and the
  workflows, on every PR, on `main` and weekly; its two checks are among
  `main`'s required checks (docs/self-hosting.md). An alert is fixed, or
  dismissed with the reason it cannot happen (the review below lists them).
- **Secrets.** GitHub secret scanning and push protection are on. `.dev.vars`
  is ignored by git, and the repository holds no real data (AGENTS.md).

## Summaries run on-device

Summarize never sends an item anywhere. The model (Qwen3, 4-bit, via
WebLLM) runs in a Web Worker on the device's GPU. The first Summarize asks
before downloading anything; until the owner agrees, no request leaves for
Hugging Face (`e2e/summaries.spec.ts` checks with the network watched).
`Referrer-Policy: same-origin` keeps the app's URL out of those downloads,
and the worker sends them with no referrer at all.

## Review, 2026-10-28

The pass before daily use (#39). It covered every path above and the
socket, input validation and limits, the three destructive paths, the
Access check, the MCP provider, headers, logs, dependencies, workflows and
CodeQL's first scan of `main`.

Checked and found sound: the Access JWT (RS256 only, `kid` required, `aud`,
`iss` and `exp` required, `nbf` honoured, 60 seconds' leeway, unknown keys
refetched at most every 30 seconds); the dev bypass (inert once `ACCESS_AUD`
is set); the object named only by the email on every path; space ids
checked on every scoped call, with the object refusing an unknown one as a
backstop; writes refused cross-site; bodies validated in full before
anything is written, under the limits in `shared/limits.ts`; backup reads
confined to the caller's folder; the erase token (random, single use,
constant-time compare, per space); MCP (bearer only on `/mcp`, the grant's
email from Access, `write` scope, no destructive tools, 60 calls a minute);
headers and CSP on every response.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Severity                                                                                  | Status                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/ws` accepted a handshake from any `Origin`. A WebSocket is not subject to CORS, and a page on a sibling subdomain is same-site, so a Lax Access cookie goes with it: such a page could read every document and send ops.                                                                                                                                                                                                                               | High, on a custom domain shared with other sites; none on `workers.dev` (a public suffix) | Fixed: another `Origin` is 403 (`test/datapad.test.ts`)                                                                                                                     |
| 2   | A document's link (project, task, org, meeting) was rendered as given, any scheme. React 19 replaces a `javascript:` URL and the CSP forbids inline script, so nothing ran, but nothing in Datapad's own code refused it. (CodeQL `js/xss`, `js/client-side-unvalidated-url-redirection`)                                                                                                                                                                | Low (two layers already held)                                                             | Fixed: `ExternalLink` links only `https:`, `http:` and `mailto:`, as Markdown does; anything else is text (`e2e/links.spec.ts`)                                             |
| 3   | An id could be `__proto__`, `toString` or another name every object has. In a collection it would read back an inherited member as a document, or (`__proto__`) be lost. Only the owner's own data was at stake. (CodeQL `js/prototype-polluting-assignment`, `js/remote-property-injection` in `shared/reducer.ts`)                                                                                                                                     | Low                                                                                       | Fixed: such ids are refused by every schema, keyed collections refuse such keys, and the reducer reads own documents only (`test/protocol.test.ts`, `test/reducer.test.ts`) |
| 4   | Erase, delete, import and restore had no way back but last night's backup: a day's work could go with one mistaken call.                                                                                                                                                                                                                                                                                                                                 | Medium (data loss, owner only)                                                            | Fixed: a copy of the space in R2 first, or no change ([above](#the-destructive-paths))                                                                                      |
| 5   | Restoring a backup that is not JSON was a 500.                                                                                                                                                                                                                                                                                                                                                                                                           | Low                                                                                       | Fixed: "That backup is not readable"                                                                                                                                        |
| 6   | `newId()` took each byte modulo 36, so `0`–`3` came up about 14% more often (8 in 256 against 7). Ids are not secrets, so this cost a little uniqueness only. (CodeQL `js/biased-cryptographic-random`)                                                                                                                                                                                                                                                  | Low                                                                                       | Fixed: bytes past 251 are drawn again (`test/ids.test.ts`)                                                                                                                  |
| 7   | `/oauth/register` is open, as it must be, and nothing limits how many clients it stores: anyone could use up the account's KV write quota, and real sign-ins with it.                                                                                                                                                                                                                                                                                    | Medium (availability of MCP sign-in)                                                      | Fixed: five a minute per client IP, and an unapproved client expires after 60 days (`test/mcp.test.ts`)                                                                     |
| 8   | Dependabot alerts are off for the repository (the monthly update PRs are on). `bun audit`: one low advisory, `deepmerge` in the shadcn CLI, build tooling only, no fix released.                                                                                                                                                                                                                                                                         | Low                                                                                       | Owner: turn on Dependabot alerts (Settings → Code security). The deepmerge advisory is accepted until a release fixes it                                                    |
| 9   | CodeQL alerts that cannot happen: property writes keyed by a page key (a `z.enum`) or a saved-filter key (`/^[a-z][A-Za-z0-9:_-]*$/`, never `__proto__`) in `shared/pages.ts` and `shared/reducer.ts`; a computed key in an object literal (`SpacesSettings.tsx`), which never sets a prototype; a dedicated Web Worker's `message` handler (`summary.worker.ts`), which only its page can post to; a test's regex and a test helper's single `replace`. | None                                                                                      | Dismissed with these reasons                                                                                                                                                |
| 10  | WCAG 2.2 AA against the deployed app.                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a                                                                                       | #53 fixed what the automated checks found ([accessibility.md](accessibility.md)); the `a11y-audit` run on the deployed app needs the owner signed in, and is due with #54   |
