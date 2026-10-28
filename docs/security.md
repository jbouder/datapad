# Security

Datapad holds one person's working notes about projects, clients and
colleagues. The goal is simple: nobody but the owner can read or change it,
and a configuration mistake fails closed.

## Threat model

| Threat                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone on the internet opens the app                                                                     | Cloudflare Access requires sign-in with the one allowed email before any request reaches the Worker.                                                                                                                                                                                                                                                                                                                               |
| The Access application does not cover a hostname (a renamed route, a preview Worker, a new custom domain) | The Worker verifies the Access JWT itself on every request, assets included, and answers 401 without one. With `ACCESS_AUD` empty and no `DEV_ACCESS_EMAIL`, everything is 401.                                                                                                                                                                                                                                                    |
| A forged or replayed token                                                                                | RS256 signature checked against the team's published keys; `aud` must be the app's AUD tag, `iss` the team domain, `exp` and `nbf` within 60 seconds of now. Unknown key ids refetch the keys at most every 30 seconds.                                                                                                                                                                                                            |
| A signed-in user reaching someone else's data                                                             | The Durable Object is named only by the verified email. No URL, header, body or socket message can choose another object; a space id only picks among the user's own spaces. Tests try.                                                                                                                                                                                                                                            |
| An MCP client reaching data without Access                                                                | Only `/mcp`, `/oauth/token`, `/oauth/register` and `/.well-known/oauth-*` skip the Access check (a Bypass application at the edge, and the Worker sends just those paths to the OAuth provider). `/mcp` admits only an unexpired, unrevoked bearer the provider issued for this origin; a token is issued only after the owner approved the client at `/oauth/authorize`, which is behind Access. See [MCP clients](#mcp-clients). |
| A stolen or replayed MCP token                                                                            | Access tokens live an hour, grants 30 days; refresh tokens rotate on use. PKCE (S256) is required, codes work once. Tokens, codes and client secrets are stored in KV only as hashes; the grant's email is encrypted with a key only the token unwraps. Revoking a grant refuses its next call. Each token is held to 60 tool calls a minute.                                                                                      |
| A malicious app registering itself as a known client                                                      | The consent page says a registered name is unverified, shows the host the tokens go to and warns when it is a local app; nothing is granted without the owner's Allow, behind Access. The form's handle works once, for ten minutes, in the browser holding its `__Host-` cookie, and a cross-site post is refused.                                                                                                                |
| The dev bypass left on in production                                                                      | It needs both an empty `ACCESS_AUD` and `DEV_ACCESS_EMAIL`, which lives only in `.dev.vars` (never deployed, git-ignored). With `ACCESS_AUD` set the bypass code path does not run. The Worker logs a loud warning whenever the bypass is active.                                                                                                                                                                                  |
| Cross-site scripting                                                                                      | React escaping, a strict CSP with no inline script except the hashed theme script, and a Markdown renderer that emits no raw HTML.                                                                                                                                                                                                                                                                                                 |
| Clickjacking, MIME sniffing, referrer leaks                                                               | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`.                                                                                                                                                                                                                                                                                                                                      |
| Cross-site requests                                                                                       | In the Access application's cookie settings, HttpOnly is on and SameSite is Lax. Every `POST` (import, erase, backup restore, and every `/api/spaces/*` write) accepts `application/json` bodies only, which a cross-site form cannot send, and refuses any `Origin` but the app's own.                                                                                                                                            |
| Data leaving the account                                                                                  | Summaries run on-device; the item's text never leaves the tab. The CSP's `connect-src` allows only this origin plus the model's download hosts (Hugging Face, `raw.githubusercontent.com`), which receive no data and no referrer.                                                                                                                                                                                                 |
| Loss of data                                                                                              | Nightly R2 backups (latest 30 per space, in a private bucket, under the owner's email), JSON export; the backup alarm never deletes documents; erasing a space or deleting one takes a fresh, single-use token for that space (`/api/erase-token`), and a deleted space's backups stay.                                                                                                                                            |

## What Access protects, and what the Worker adds

Access handles identity: the login page, one-time PINs or SSO, the session
cookie, and logout. It signs every request it forwards with a short-lived
JWT in `Cf-Access-Jwt-Assertion`.

The Worker (`worker/access.ts`) checks that JWT on every request, so the
app's safety does not depend on the Access application being attached to
every hostname correctly. It also turns the token into the one thing that
selects data: the lowercased `email` claim names the Durable Object.

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

## What the logs contain

- **Access logs** (Zero Trust → Logs): your email, IP address, sign-in
  times and the application. This is by design.
- **Worker logs** (Workers observability): request metadata as Cloudflare
  records it, and the Worker's own error lines, which carry the path and an
  error message only. The Worker never logs tokens, document content or
  request bodies.

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
  workflows, on every PR, on `main` and weekly; required on `main`.
- **Secrets.** GitHub secret scanning and push protection are on. `.dev.vars`
  is ignored by git, and the repository holds no real data (AGENTS.md).

## Summaries run on-device

Summarize never sends an item anywhere. The model (Qwen3, 4-bit, via
WebLLM) runs in a Web Worker on the device's GPU. The first Summarize asks
before downloading anything; until the owner agrees, no request leaves for
Hugging Face (`e2e/summaries.spec.ts` checks with the network watched).
`Referrer-Policy: same-origin` keeps the app's URL out of those downloads,
and the worker sends them with no referrer at all.
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
