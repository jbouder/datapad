# Security policy

Datapad is a private, single-owner project tracker that runs on
Cloudflare. How it is protected is in [docs/security.md](docs/security.md).

## Reporting a vulnerability

Please report it privately, not in a public issue:
[open a private advisory](https://github.com/jbouder/datapad/security/advisories/new)
(GitHub → Security → Report a vulnerability). Say what you found, where
(a path, file or commit), and how to reproduce it.

Never use real data in a report. Test against your own deployment
([docs/self-hosting.md](docs/self-hosting.md)) or `npm run dev`, never
against someone else's.

## In scope

- **The Worker** (`worker/`): every route, the WebSocket, the Durable
  Object, its backups and the destructive paths (erase, delete, import,
  restore).
- **The Access check** (`worker/access.ts`): anything that reaches data or
  the app without a verified Cloudflare Access sign-in, or reaches another
  email's Durable Object.
- **MCP** (`worker/mcp/`): the OAuth provider, the consent page, `/mcp`
  and its tools; a token that does more than its grant and scope allow.
- **The app** (`src/`): script injection, data leaving the browser.
- The repository's workflows and supply chain (`.github/`).

Out of scope: Cloudflare's own services (report those to Cloudflare), a
deployment's own misconfiguration that the docs warn against, and denial
of service by volume.

## What to expect

This is a one-person project, so the timelines are best effort:

- an acknowledgement within a week;
- an assessment, and a fix or a plan, within 30 days for anything serious;
- credit in the advisory and `CHANGELOG.md`, if you want it, once a fix is
  released.

Only the latest release on `main` gets fixes.
