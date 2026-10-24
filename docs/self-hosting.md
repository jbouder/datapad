# Running Datapad on your own Cloudflare account

Datapad is personal: it holds your projects, notes and people. Everything
below keeps it reachable by you and nobody else. Allow about 20 minutes.

## Prerequisites

- A Cloudflare account with Zero Trust enabled (the free plan covers up to
  50 users; you need one).
- Node 22+, [bun](https://bun.sh), and this repository cloned.
- `npx wrangler login` done once on your machine.

## 1. Deploy the Worker

```bash
bun install
npm run deploy
```

This publishes `datapad` at `https://datapad.<your-subdomain>.workers.dev`.
With `ACCESS_AUD` still empty in `wrangler.jsonc`, the Worker answers
**401 to everything**: it fails closed until Access is set up. That is
expected.

`DEV_ACCESS_EMAIL` only ever lives in `.dev.vars`, which is never deployed,
and it is ignored whenever `ACCESS_AUD` is set. Do not add it as a var or
secret in the dashboard.

## 2. Put Cloudflare Access in front

1. Zero Trust dashboard → **Access → Applications → Add an application →
   Self-hosted**.
2. **Application domain:** the Worker's hostname,
   `datapad.<your-subdomain>.workers.dev` (or your custom domain, below).
   Leave the path empty so the whole hostname is covered.
3. **Session duration:** 1 month is reasonable for your own devices.
4. **Cookie settings** (Advanced): HttpOnly on, SameSite Lax.
5. **Policy:** Action _Allow_, Include → _Emails_ → your address. Exactly
   one email.
6. **Login methods:** One-time PIN is enough; add Google or another
   identity provider if you prefer.
7. Save, then open the application's **Overview** and copy:
   - the **Application Audience (AUD) Tag**,
   - your **team domain**, `<team>.cloudflareaccess.com` (Settings →
     Custom pages, or the URL of the login page).
8. In `wrangler.jsonc`, set both vars (they are public values):

   ```jsonc
   "vars": {
     "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
     "ACCESS_AUD": "<the AUD tag>"
   }
   ```

9. Deploy again (`npm run deploy`, or push to `main` with the workflow
   below).

### Check it

- In a private window, open the app. You should land on the Access login.
- Sign in. The app loads, and Preferences shows "Signed in as <you>".
- In the browser's developer tools, the `/ws` request should show `101`.
- `curl -i https://datapad.<subdomain>.workers.dev/` without a cookie gets
  Access's redirect; with a made-up `Cf-Access-Jwt-Assertion` header the
  Worker itself answers `401`.

Sign out is Preferences → Sign out, which goes to
`/cdn-cgi/access/logout`.

## 3. Create the backups bucket

```bash
npx wrangler r2 bucket create datapad-backups
```

The `BACKUPS` binding and the nightly backup land in M6; creating the
bucket now means the deploy that adds them just works.

## Summaries

Nothing to configure. Summaries run in the browser on a local WebLLM model
(M6); there is no API key.

## Custom domain

Add a custom domain to the Worker (Workers & Pages → datapad → Settings →
Domains & Routes), then add the same hostname to the Access application
(or create a second application with the same policy). The Worker checks
the AUD, so a hostname that Access does not cover gets 401.

## Deploy from GitHub Actions

`.github/workflows/ci.yml` runs on every pull request and on `main`: Biome,
type check, build, Vitest in workerd, then Playwright + axe (desktop and
phone) against `vite preview`. `.github/workflows/deploy.yml` deploys `main`
after a green CI run.
1. Create an API token from the **Edit Cloudflare Workers** template.
2. In the repository: Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Settings → Environments → create `production` (add yourself as a
   required reviewer if you want a manual gate).
4. Settings → Branches (or Rules) → protect `main`: require a pull request
   and the `check` and `e2e` status checks. GitHub only offers a check once
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
and GitHub Actions, labelled `dependencies`. They run CI like any other PR
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
or remove an applied one.
