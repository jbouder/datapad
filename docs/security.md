# Security

Datapad holds one person's working notes about projects, clients and
colleagues. The goal is simple: nobody but the owner can read or change it,
and a configuration mistake fails closed.

## Threat model

| Threat                                                                                                    | Mitigation                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Someone on the internet opens the app                                                                     | Cloudflare Access requires sign-in with the one allowed email before any request reaches the Worker.                                                                                                                                                   |
| The Access application does not cover a hostname (a renamed route, a preview Worker, a new custom domain) | The Worker verifies the Access JWT itself on every request, assets included, and answers 401 without one. With `ACCESS_AUD` empty and no `DEV_ACCESS_EMAIL`, everything is 401.                                                                        |
| A forged or replayed token                                                                                | RS256 signature checked against the team's published keys; `aud` must be the app's AUD tag, `iss` the team domain, `exp` and `nbf` within 60 seconds of now. Unknown key ids refetch the keys at most every 30 seconds.                                |
| A signed-in user reaching someone else's data                                                             | The Durable Object is named only by the verified email. No URL, header, body or socket message can choose another object. Tests try.                                                                                                                   |
| The dev bypass left on in production                                                                      | It needs both an empty `ACCESS_AUD` and `DEV_ACCESS_EMAIL`, which lives only in `.dev.vars` (never deployed, git-ignored). With `ACCESS_AUD` set the bypass code path does not run. The Worker logs a loud warning whenever the bypass is active.      |
| Cross-site scripting                                                                                      | React escaping, a strict CSP with no inline script except the hashed theme script, and (from M3) a Markdown renderer that emits no raw HTML.                                                                                                           |
| Clickjacking, MIME sniffing, referrer leaks                                                               | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`.                                                                                                                                                          |
| Cross-site requests                                                                                       | In the Access application's cookie settings, HttpOnly is on and SameSite is Lax. Writes (`POST /api/import`, `POST /api/erase`) accept `application/json` bodies only, which a cross-site form cannot send, and refuse any `Origin` but the app's own. |
| Data leaving the account                                                                                  | Summaries run on-device; the item's text never leaves the tab. The CSP's `connect-src` allows only this origin plus the model's download hosts (Hugging Face, `raw.githubusercontent.com`), which receive no data and no referrer.                     |
| Loss of data                                                                                              | Nightly R2 backups (latest 30, in a private bucket, under the owner's email), JSON export; the backup alarm never deletes documents; deleting everything takes a fresh, single-use token (`/api/erase-token`).                                         |

## What Access protects, and what the Worker adds

Access handles identity: the login page, one-time PINs or SSO, the session
cookie, and logout. It signs every request it forwards with a short-lived
JWT in `Cf-Access-Jwt-Assertion`.

The Worker (`worker/access.ts`) checks that JWT on every request, so the
app's safety does not depend on the Access application being attached to
every hostname correctly. It also turns the token into the one thing that
selects data: the lowercased `email` claim names the Durable Object.

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
  data: blob:`; `font-src 'self' data:`; `object-src 'none'`; `base-uri
  'none'`; `form-action 'self'`; `frame-ancestors 'none'`.

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

The Worker's own responses (`/api/*`, `/ws`, the 401 page) carry
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
