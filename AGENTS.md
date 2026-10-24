# AGENTS.md — datapad

Guidance for AI agents working in this repository.

## What this is

A private, single-user project tracker for an engineering leader: projects,
tasks, notes, events, people, cross-project views, search and on-device
summaries. Built the way [holocron](https://github.com/jbouder/holocron) is
built. Runs entirely on Cloudflare: Cloudflare Access sits in front of the
hostname, a Worker verifies the Access JWT on every request and serves the
SPA and API, and one SQLite-backed Durable Object per signed-in email holds
all of that user's data and fans out live updates. Data is **kept**: nothing
is wiped. `docs/SPEC.md` is the product spec, `docs/PLAN.md` the build plan
(it wins on look, feel and plumbing).

## Layout

- `shared/` — the domain, used by both sides. `types.ts` (the six
  collections), `protocol.ts` (zod schemas for documents, the export file,
  ops and socket messages), `reducer.ts` (**the only place state
  changes**; also `merge()` for imports), `limits.ts`, `select.ts`
  (memoisable selectors), `dates.ts`. Later: `markdown.ts`, `summaries.ts`.
- `worker/` — `index.ts` (Access check first, then routes), `access.ts`
  (JWT verification with a JWKS cache, the dev bypass), `datapad.ts` (the
  `DatapadObject` Durable Object), `env.ts` (bindings).
- `src/` — React 19 + Vite app. `lib/router.ts` (pushState router),
  `lib/motion.ts` + `hooks/useFlip.ts` (motion helpers), `lib/themes.ts` (System, Light, Dark),
  `providers/*` (Motion, Theme, Toast), `components/*`, `pages/*`.
- `test/` — Vitest inside workerd (`@cloudflare/vitest-plugin`): Access,
  the DO, routes, headers/CSP, theme tokens.
- `e2e/` — Playwright + axe against `vite preview`, in a **desktop and a
  phone project**. `fixtures.ts` signs each test in as its own address
  (fresh DO), blocks every request off localhost, has `expectAccessible`.
  `seed.ts` is fictional data.
- `docs/` — SPEC, PLAN, architecture, data, design, security, self-hosting.

## Stack

React 19 + TypeScript + Vite · Tailwind CSS v4 (CSS-first, `src/index.css`)
· stock shadcn `base-lyra` on Base UI (`src/components/ui`, CLI-managed, do
not hand-edit) · Phosphor icons · `cmdk` · zod · Biome · Cloudflare Workers +
Durable Objects via `@cloudflare/vite-plugin` · **bun** for installs (npm's
resolver fails on Vitest 4.1 peers) · WebLLM for summaries (M6, in-browser).

## Rules

- **Access fails closed.** `verifyAccess()` runs before anything else on
  every path, assets included (`run_worker_first: true`). No route may skip
  it. A request without a verified email gets 401.
- **The DO is named only by the verified email.** `env.DATAPAD.getByName()`
  takes `identity.email` and nothing else: no query string, header, body or
  socket message may choose or influence the name.
- **The dev bypass is dev only.** `DEV_ACCESS_EMAIL` and the
  `x-dev-access-email` header work only while `ACCESS_AUD` is empty _and_
  `DEV_ACCESS_EMAIL` is set (only ever in `.dev.vars`). Never set
  `DEV_ACCESS_EMAIL` as a deployed var.
- **No credential on a URL.** Sessions are Access cookies; nothing secret
  goes in a path or query string.
- **Every change is an op through `reduce()`.** Add the op to
  `OpSchema` in `protocol.ts`, handle it in `reducer.ts`, test it in
  `test/reducer.test.ts` (including its activity text), and add the
  matching action to `useDatapad()`. Never mutate state in the DO or the UI
  directly; no component touches the socket. The reducer stays pure: ids
  come in the op, the time as `now`.
- **The repository is public.** No real data in fixtures, tests or docs;
  never commit `.dev.vars`.
- **Mobile is first class.** Every view is built and tested at phone width:
  e2e runs desktop _and_ phone; 44px touch targets on touch; no hover-only
  affordances; tables collapse to rows; nothing scrolls the page sideways.
- **No animation libraries for app motion.** View Transitions, WAAPI,
  `@starting-style`, CSS `linear()` springs. Helpers in `src/lib/motion.ts`,
  `src/hooks/useFlip.ts`. (`tw-animate-css` is imported only because the
  stock shadcn overlays in `src/components/ui/*` use it; do not reach for it.)
  Tokens, not literals (`var(--duration-base)`, `var(--ease-emphasized)`).
  Animate `opacity`/`transform` only; position changes go through FLIP or View
  Transitions. Scope `view-transition-name`s with `html[data-vt="…"]`
  (types in use: `page`, `theme`, `filter`). Panels use `@starting-style`,
  not a view transition. Counts never animate.
- **Motion respects two switches:** Preferences → Motion
  (`html[data-motion="off"]`) and `prefers-reduced-motion` (hard override).
  JS helpers take `enabled` from `useMotion().active`.
- Motion styling belongs in `src/index.css` or at the call site, never in
  `src/components/ui/*`.
- **Colours are tokens.** Light and Dark define every token
  (`test/themes.test.ts`); use `text-warn`, `bg-ok/15`, etc., never a literal.
- Self-hosting docs live in `docs/`, not in the app.

## Commands

```bash
bun install
cp .dev.vars.example .dev.vars   # once: the dev sign-in
npm run dev          # Vite + Worker + DO locally (Miniflare)
npm test             # wrangler types + vitest (runs in workerd)
npm run e2e          # playwright: build, vite preview, desktop + phone
npm run check        # biome check --write
npm run build        # wrangler types + tsc -b + vite build
npm run deploy       # build + wrangler deploy
```

Run `npm run check && npm run build && npm test` before finishing any change,
and `npm run e2e` when it touches the UI (first time: `bunx playwright
install chromium`). Check UI changes at phone width in the browser too, and
add an e2e spec for every flow worth keeping.
