# Running Datapad on your own Cloudflare account

Datapad is personal: it holds your projects, notes and people. Everything
below keeps it reachable by you and nobody else. Allow about 20 minutes.

## Prerequisites

- A Cloudflare account with Zero Trust enabled (the free plan covers up to
  50 users; you need one).
- Node 22+, [bun](https://bun.sh), and this repository cloned.
- `npx wrangler login` done once on your machine.

## What it costs

A personal Datapad fits in the free plans: Workers Free includes
SQLite-backed Durable Objects, R2 has a free tier that holds years of
nightly backups (an export is kilobytes to a few megabytes), and Zero
Trust is free for up to 50 users. There is no third-party service and no
API key: summaries run in the browser. If you would rather be sure, set a
spend notification under Billing → Notifications; nothing in this app
needs a paid plan.

## 1. Make the config yours

`wrangler.jsonc` ships with the author's own Access values. Before the
first deploy, replace them with yours, or blank `ACCESS_AUD` until step 4:

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "",
  "ACCESS_AUD": "",
  "BACKUP_HOUR": "3",
  "BACKUP_TIME_ZONE": "America/New_York"
}
```

Both Access values are public, so they live here and not in a secret. The
app has no secrets at all; the only one you will create is the API token
GitHub Actions deploys with (below). `name` is the Worker's name and
`bucket_name` the backups bucket; change either if you like.

## 2. Create the backups bucket

```bash
npx wrangler r2 bucket create datapad-backups
```

`wrangler.jsonc` binds the bucket as `BACKUPS`, and a deploy whose bucket
does not exist fails, so this comes first. The bucket stays private;
nothing serves it publicly. Each user gets a folder named by their email:
the `main` space's backups sit directly in it
(`<email>/datapad-YYYY-MM-DD.json`), and every other space's in a
subfolder named by its id (`<email>/<spaceId>/datapad-YYYY-MM-DD.json`).

When the backup runs is two vars in `wrangler.jsonc`: `BACKUP_HOUR` (0–23,
default `3`) and `BACKUP_TIME_ZONE` (an IANA zone, default
`America/New_York`). Each user's Durable Object books its own alarm for that
hour. See [data.md § Backups](data.md#backups) for retention and restoring.

## 3. Deploy the Worker

```bash
bun install
npm run deploy
```

This publishes `datapad` at `https://datapad.<your-subdomain>.workers.dev`.
With `ACCESS_AUD` empty in `wrangler.jsonc`, the Worker answers **401 to
everything**: it fails closed until Access is set up. That is expected.

`DEV_ACCESS_EMAIL` only ever lives in `.dev.vars`, which is never deployed,
and it is ignored whenever `ACCESS_AUD` is set. Do not add it as a var or
secret in the dashboard.

## 4. Put Cloudflare Access in front

### On the workers.dev URL (one click)

The Zero Trust "Add public hostname" form only lists domains that are zones
in your account, and `workers.dev` is not one. Workers has its own switch:
1. Dashboard → **Workers & Pages** → **datapad** → **Settings** →
   **Domains & Routes**.
2. On the `workers.dev` row, select **Enable Cloudflare Access**.
3. The dialog shows two values. Copy both:
   - `POLICY_AUD`, the application's AUD tag;
   - `TEAM_DOMAIN`, `https://<team>.cloudflareaccess.com`.
4. Select **Manage Cloudflare Access** and make the policy allow exactly
   one email, yours. Login with One-time PIN is enough; add Google or
   another identity provider if you prefer.
5. Optional but recommended: on the application's **Additional settings**
   → **Cookie settings**, turn on HttpOnly and set SameSite to Lax.
6. Put the two values in `wrangler.jsonc` (they are public). The Worker
   accepts the team domain with or without `https://`:

   ```jsonc
   "vars": {
     "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
     "ACCESS_AUD": "<POLICY_AUD>"
   }
   ```

   Set them here, not under the Worker's Settings → Variables: every deploy
   replaces dashboard vars with the ones in `wrangler.jsonc`.
7. Deploy again (`npm run deploy`, or push to `main` with the workflow
   below).

### On a custom domain

Zero Trust → **Access controls** → **Applications** → **Create new
application** → **Self-hosted and private** → **Add public hostname**, pick
the domain, add the same one-email Allow policy, and copy the AUD tag from
the application's overview. If both hostnames are in use, they need the
same AUD (one application covering both) because the Worker checks one.

### Check it

- In a private window, open the app. You should land on the Access login.
- Sign in. The app loads, and Settings → Account shows your email.
- In the browser's developer tools, the `/ws` request should show `101`.
- `curl -i https://datapad.<subdomain>.workers.dev/` without a cookie gets
  Access's redirect; with a made-up `Cf-Access-Jwt-Assertion` header the
  Worker itself answers `401`.

Sign out is in the account menu (and Settings → Account), which goes to
`/cdn-cgi/access/logout`.

### More than one person

Each email the policy allows gets its own Durable Object, empty at first,
and nothing is shared between them: add a colleague to the Access policy
and they get a Datapad of their own in your account, with their own
backups folder. Sharing one Datapad between emails is not a feature.

## Summaries

Nothing to configure. Summaries run in the browser on a local WebLLM model;
there is no API key. The browser needs WebGPU (recent Chrome, Edge, Safari
or Firefox on most hardware); without it Summarize says so and does
nothing else. If you serve the assets somewhere other than Workers, keep
the CSP from `public/_headers`: the model needs `'wasm-unsafe-eval'` and
its download hosts in `connect-src`.

## Custom domain

Add a custom domain to the Worker (Workers & Pages → datapad → Settings →
Domains & Routes), then cover it with Access as above. The Worker checks
the AUD, so a hostname that Access does not cover gets 401.

## Deploy from GitHub Actions

`.github/workflows/ci.yml` runs on every pull request and on `main`: Biome,
type check, build, Vitest in workerd, then Playwright + axe (desktop and
phone) against `vite preview`, split across four runners on the Playwright
container image. `.github/workflows/deploy.yml` deploys `main`
after a green CI run.
1. Create an API token from the **Edit Cloudflare Workers** template.
2. In the repository: Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Settings → Environments → create `production` (add yourself as a
   required reviewer if you want a manual gate).
4. Settings → Branches (or Rules) → protect `main`: require a pull request
   and the `check` and `e2e` status checks. The browser suite runs as four
   `e2e shard n/4` jobs; `e2e` is the one job that passes only when all of
   them do, so require it, not the shards. GitHub only offers a check once
   it has run.

Without the secret the deploy job is skipped and the run stays green, so
forks and fresh clones are safe.

The e2e job signs in with the dev bypass (it writes a `.dev.vars` with
`DEV_ACCESS_EMAIL` and an empty `ACCESS_AUD` for the preview build only). It
never uses real credentials.

### Pull request previews: off

Holocron deploys a Worker per pull request. Datapad does not, because a
preview Worker on a new hostname would not be behind Access. The Worker's
JWT check means it would answer 401 rather than leak, but it would also be
useless. To turn previews on later:
1. Create an Access application for the wildcard
   `datapad-pr-*.<subdomain>.workers.dev` with the same policy, and confirm
   the previews' tokens carry an AUD the Worker accepts (one application, or
   the preview's own AUD set as its var).
2. Port holocron's `.github/workflows/preview.yml`, naming Workers
   `datapad-pr-<number>`.
3. Remember each preview has its own, empty Durable Objects.

### Dependency updates

Dependabot opens grouped monthly pull requests for npm packages (via bun)
and GitHub Actions, labeled `dependencies`. They run CI like any other PR
and never deploy until merged.

## Local development

```bash
cp .dev.vars.example .dev.vars   # DEV_ACCESS_EMAIL=dev@example.com
npm run dev
```

Change `DEV_ACCESS_EMAIL` to get a fresh, empty Datapad. Local data lives
in `.wrangler/state`; delete that folder to start over.

## Observability

Workers observability is on in `wrangler.jsonc`. The Worker logs errors with
the request path only. `npm run tail` streams live logs.

## Updating

Pull, `bun install`, `npm run check && npm run build && npm test`, then
deploy. Durable Object migrations are listed in `wrangler.jsonc`; never edit
or remove an applied one. The object's own schema (`SCHEMA_VERSION` in
`worker/datapad.ts`) upgrades itself on the first wake after a deploy, in
one transaction, and a failed upgrade leaves the old layout whole.

Releases are tags on `main` (`v0.1.0`, …) with a GitHub release each;
[CHANGELOG.md](../CHANGELOG.md) says what changed and whether the export
format did. Every release imports every earlier export and backup.
