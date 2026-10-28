# AGENTS.md — datapad

Guidance for AI agents working in this repository.

## What this is

A private, single-user project tracker for an engineering leader: projects,
tasks, notes, meetings and milestones, people, cross-project views, search and on-device
summaries. Built the way [holocron](https://github.com/jbouder/holocron) is
built. Runs entirely on Cloudflare: Cloudflare Access sits in front of the
hostname, a Worker verifies the Access JWT on every request and serves the
SPA and API, and one SQLite-backed Durable Object per signed-in email holds
all of that user's data and fans out live updates. Inside it the data is
split into one or more spaces, each a complete, separate Datapad (the
first is `main`). Data is **kept**: nothing is wiped. `docs/SPEC.md` is the product spec, `docs/PLAN.md` the build plan
(it wins on look, feel and plumbing).

## Layout

- `shared/` — the domain, used by both sides. `types.ts` (the six
  collections; `Milestone` embedded in `Project`, `Topic` in `Meeting`), `protocol.ts` (zod schemas for documents, the export file,
  ops and socket messages), `reducer.ts` (**the only place state
  changes**; also `merge()` for imports), `limits.ts`, `select.ts`
  (memoizable selectors), `dates.ts`, `markdown.ts`, `meetings.ts` (meeting filters and order; topics: the form's line-to-ops
  mapping, counts; a meeting's series and carrying topics
  forward),
  `milestones.ts` (they live on the project), `board.ts` (whiteboards:
  stroke simplification, bounds, hit-testing, z order, a board's items,
  arrows' attachment and re-aiming), `migrate.ts` (the typed
  collection from before meetings → meetings and milestones; every import
  and the DO's schema 3 run it),
  `summaries.ts` (the models, prompt and per-item context Summarize
  sends), `schedule.ts` (the nightly backup's time, DST-safe), `search.ts`
  (the ⌘K index and ranking), `pages.ts` (saved page preferences, pure:
  what each page remembers, the address over what is saved, what a change
  saves; `PAGES` is also where Help's Layouts table comes from), `nav.ts`
  (navigation preferences: the rail's and tab bar's sections and order,
  what the phone's tab bar leaves out, the + menu), `routes.ts` (the app's
  addresses, pure: parse, paths, redirects from old addresses, titles;
  `src/lib/router.ts` re-exports it), `spaces.ts` (space names and order,
  and the pure halves of moving a project between spaces),
  `shortcuts.ts` (every keyboard shortcut and the rule that keeps single
  letters out of inputs and overlays; Help and the `?` sheet list it),
  `composer.ts` (the note composer as pure functions: the `/` commands,
  the formatting keys, list continuation; Help's tables come from it),
  `mentions.ts` (`@{id}` tokens ↔ `@Name`), `notes.ts`, `tasks.ts`,
  `projects.ts` (each view's filters, sorts and selection), `people.ts`
  and `orgs.ts` (records by name, inline add), `templates.ts` (project
  and note templates), `digest.ts` (the weekly digest and its Markdown).
- `worker/` — `index.ts` (Access check first, then routes), `access.ts`
  (JWT verification with a JWKS cache, the dev bypass), `datapad.ts` (the
  `DatapadObject` Durable Object: per-space state and seq, the schema
  migrations in `ensureTables()`, the space RPCs,
  its nightly R2 backup alarm), `env.ts` (bindings). `mcp/` is the MCP
  server (#152): `oauth.ts` (the provider per origin, its paths, scopes
  `read`/`write`, token lifetimes), `authorize.ts` + `consent.ts` (the
  consent page behind Access, no script), `server.ts` (`/mcp` after the
  bearer check: the DO from `props.email`, the rate limit, the
  `initialize` instructions), `protocol.ts` (stateless JSON-RPC, after
  holotable's), `tool.ts` (`defineTool`, `ToolError`, `requireSpace`) and
  `tools/` (one file per area; `tools/index.ts` is the registry;
  `tools/read.ts` is what the read tools (#153) share: `readSpace()` over
  the DO's `snapshot(space)` RPC, the id-or-name rule `resolveByName()`,
  the 200-item `cap()`, documents read out with mentions as `@Name`;
  `tools/write.ts` is what the write tools (#154) share: `write()` over
  the DO's `apply()` RPC, words to dates, `@Name` to tokens), and
  `connections.ts` (Settings → Connected apps: the email's grants, revoke).
  Tools select with `shared/`, never their own copy of a filter.
- `src/` — React 19 + Vite app. `lib/router.ts` (pushState router;
  `SETTINGS_SECTIONS` lists Settings' sections, `spaces`, `people` and
  `orgs` among them; People and Orgs are their own routes under
  `/settings/…`),
  `lib/motion.ts` + `hooks/useFlip.ts` (motion helpers), `hooks/useNow.ts` (a shared minute clock;
  date-bucketed views read `useToday()` so they roll over at midnight), `lib/themes.ts` (System, Light, Dark: neutral, no tint),
  `lib/spaces.ts` (the active space key, per-space cache keys),
  `providers/*` (Motion, Theme, Toast, Datapad with `useSpaces()`, PagePrefs),
  `components/*` (shared layouts in `components/layouts/`: ViewSwitcher,
  DataTable, CardGrid, Board, Timeline, Calendar; `SpaceSwitcher`,
  `SpacesSettings`, `projects/MoveProjectDialog`, `projects/Milestones`;
  `meetings/` holds the meeting form, row, list, layouts,
  the topics (`MeetingTopics` on the meeting's page and in its panel,
  `PendingTopics` for a new meeting's), the meeting note composer and
  the Focus agenda strip;
  `board/` is the whiteboard canvas (`Board`, composition and render;
  `gesture.ts`, the pointer gestures as a pure state machine whose steps
  return effects as data, driven by `useBoardGestures`; `useBoardKeys`,
  the keyboard map and arrows drawn from the keys; `ops.ts`, the pure op
  builders; `tools.ts`, the tools; its toolbar, Edit bar,
  zoom, `useViewport`, `useHistory` for undo; `BoardMenu` with
  `export.ts`, the pure SVG serialiser, and `download.ts`, its browser
  half: tokens resolved, the PNG on a canvas);
  `notes/LinkedNoteList` is the Notes section a task's page and panel and
  a meeting's page and panel share), `pages/*` (`MeetingPage` is
  `/meetings/:id` and `TaskPage` `/tasks/:id`, as `ProjectPage` is
  `/projects/:id`; a task opens its page only from Tasks, its panel
  everywhere else).
- `test/` — Vitest inside workerd (`@cloudflare/vitest-plugin`): Access,
  the DO, routes, headers/CSP, theme tokens, MCP (`mcp.test.ts`: OAuth
  and the SDK client over `SELF`; `mcp-tools.test.ts`: each tool over a
  seeded object).
- `e2e/` — Playwright + axe against `vite preview`, in a **desktop and a
  phone project**. `fixtures.ts` signs each test in as its own address
  (fresh DO), blocks every request off localhost, has `expectAccessible`.
  `seed.ts` is fictional data, shifted to today before every test.
- `docs/` — SPEC, PLAN, architecture, data, design, security, self-hosting, mcp,
  accessibility (the conformance statement, what checks it, every drag's
  keyboard and touch way), `audits/` (dated web-app audit reports; the next
  one compares with the last).

## Stack

React 19 + TypeScript + Vite · Tailwind CSS v4 (CSS-first, `src/index.css`)
· stock shadcn `base-lyra` on Base UI (`src/components/ui`, CLI-managed, do
not hand-edit) · Phosphor icons · `cmdk` · zod · Biome · Cloudflare Workers +
Durable Objects via `@cloudflare/vite-plugin` · **bun** for installs (npm's
resolver fails on Vitest 4.1 peers) · WebLLM for summaries (in-browser, `src/lib/summary-*.ts`)
· `@cloudflare/workers-oauth-provider` (MCP sign-in, KV `OAUTH_KV`) ·
`@modelcontextprotocol/sdk` (dev only: the client the MCP tests drive).

## Rules

- **Access fails closed.** `verifyAccess()` runs before anything else on
  every path, assets included (`run_worker_first: true`). No route may skip
  it. A request without a verified email gets 401. **The one exception is
  MCP** (`worker/mcp/`, `docs/mcp.md`): exactly the paths in
  `isProviderPath()` (`/mcp`, `/oauth/token`, `/oauth/register`,
  `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource`, and below them) go to the OAuth
  provider before `verifyAccess()`, because an MCP client cannot sign in
  with Access. It still fails closed: the provider answers those paths
  itself and admits nothing without a credential it issued, `/mcp` only
  with an unexpired, unrevoked bearer for this origin (no cookie fallback:
  an Access cookie alone is 401), and a token exists only after the owner
  approved the client at `/oauth/authorize`, which stays behind Access. Do
  not add a path to that list, or let a bearer reach `/api/*` or `/ws`.
- **The DO is named only by the verified email.** `env.DATAPAD.getByName()`
  takes `identity.email` (or, on `/mcp`, the grant's `props.email`, which
  only `completeAuthorization()` in `worker/mcp/authorize.ts` writes, from
  the identity Access verified) and nothing else: no query string, header, body or
  socket message may choose or influence the name. `?space=` on `/ws` and
  on the scoped routes (export, import, backups, erase) and the ids in the
  `/api/spaces*` bodies select a space _within_ that object, never the
  object; an unknown space is 404 (`/ws` opens the first space instead).
  The space id is not a credential.
- **`main` keeps the paths from before spaces.** Its backups stay at
  `<email>/datapad-….json` and its browser keys unsuffixed
  (`datapad:snapshot`); other spaces use `<email>/<id>/` and `:<id>`
  (`keyFor()`). The active space is per device (`datapad:space`), not in
  the URL.
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
  come in the op, the time as `now`. Milestone ops (`addMilestone`,
  `editMilestone`, `deleteMilestone`) are project ops: they rewrite the
  project's `milestones` and bump its `updatedAt`; topic ops rewrite
  their meeting's `topics` and bump the meeting's and the project's. An op changes one space; moving a
  project spans two, so it is `merge()` plus `removeSubtree()` in one
  transaction (`shared/spaces.ts`), not an op. Whiteboard ops are
  silent in Activity except the daily line (the first item added to a
  project's board each day logs "Drew on the whiteboard"); keep it that
  way. The canvas sends its changes through `sendOps`, almost all by
  way of `useHistory`'s `run`, so ⌘Z can undo them.
- **MCP writes go through `apply()` and `reduce()` only.** A write tool
  (`worker/mcp/tools/write*.ts`, scope `write`) builds ops with ids from
  `shared/ids` and hands them to the DO's `apply(space, opId, ops)`, which
  takes the socket path (`OpSchema`, size limit, op-id dedupe, `reduce()`,
  commit, fan-out to the space's sockets). No tool or RPC changes a space
  for MCP any other way, and no MCP tool deletes, archives, erases,
  imports, restores, moves between spaces or touches spaces or settings.
  That rule lives in `MCP_OP_TYPES` (`shared/protocol.ts`), the op types
  `apply()` lets through, alone or inside a `batch`; anything else refuses
  the whole change. A new tool that needs another op adds it there
  deliberately (`test/mcp-tools.test.ts` holds the list to exactly what
  the tools send), and never a delete, archive, `put` or `remove`.
- **The repository is public.** No real data in fixtures, tests or docs;
  never commit `.dev.vars`.
- **Help and the docs stay true.** Help's shortcut, `/` command,
  formatting and layout tables are generated (`SHORTCUTS`, `COMMANDS`,
  `FORMAT_SHORTCUTS`, `PAGES`); never hand-write one. A change the owner
  would notice gets a line under Unreleased in `CHANGELOG.md`, and a
  change to the export file's shape says so there under **Export
  format**. Releases are tags on `main` (`v0.1.0`, …) with a GitHub
  release whose notes are that version's changelog section.
- **Mobile is first class.** Every view is built and tested at phone width:
  e2e runs desktop _and_ phone; 44px touch targets on touch; no hover-only
  affordances; tables collapse to rows; nothing scrolls the page sideways.
- **Every PR that changes the UI shows it.** Embed screenshots in the PR
  body, desktop _and_ phone (Pixel 7 width), as a "### Screenshots" table
  of GitHub attachments (`https://github.com/user-attachments/assets/…`)
  with descriptive alt text. Never commit screenshots or push them to a
  branch. Take them with seeded, fictional data (`e2e/seed.ts`); `gh`
  cannot upload images, so attach them through the PR's comment box in a
  browser, copy the asset URLs into the body and discard the comment.
- **No animation libraries for app motion.** View Transitions, WAAPI,
  `@starting-style`, CSS `linear()` springs. Helpers in `src/lib/motion.ts`,
  `src/hooks/useFlip.ts`. (`tw-animate-css` is imported only because the
  stock shadcn overlays in `src/components/ui/*` use it; do not reach for it.)
  Tokens, not literals (`var(--duration-base)`, `var(--ease-emphasized)`).
  Animate `opacity`/`transform` only; position changes go through FLIP or View
  Transitions. Scope `view-transition-name`s with `html[data-vt="…"]`
  (types in use: `page`, `theme`, `filter`, `layout`, `space`). Panels use `@starting-style`,
  not a view transition. Counts never animate.
- **Motion respects two switches:** Settings → Appearance → Motion (also in the account menu)
  (`html[data-motion="off"]`) and `prefers-reduced-motion` (hard override).
  JS helpers take `enabled` from `useMotion().active`.
- Motion styling belongs in `src/index.css` or at the call site, never in
  `src/components/ui/*`.
- **Colors are tokens.** Light and Dark define every token
  (`test/themes.test.ts`); use `text-warn`, `bg-ok/15`, etc., never a literal.
- Self-hosting docs live in `docs/`, not in the app.

## Commands

```bash
bun install
cp .dev.vars.example .dev.vars   # once: the dev sign-in
npm run dev          # Vite + Worker + DO locally (Miniflare)
npm test             # wrangler types + vitest (runs in workerd)
npm run e2e          # playwright: build, vite preview, desktop + phone
npm run e2e:changed  # only the specs changed since main (npx playwright test --only-changed=main)
npm run preview -- --port 4318   # in another terminal: the e2e runs reuse it, no rebuild
npm run check        # biome check --write
npm run build        # wrangler types + tsc -b + vite build
npm run deploy       # build + wrangler deploy
```

**Biome checks the code, not the docs.** CI runs `bunx biome ci .`, which
fails on any file Biome would format differently; Markdown is excluded in
`biome.json`, so docs and `CHANGELOG.md` are formatted by hand. Run
`npm run check` after the last code edit, and `bunx biome ci .` before
every commit; it must print no errors.

Run `npm run check && npm run build && npm test` before finishing any change,
and `npm run e2e` when it touches the UI. Iterate with `npm run e2e:changed`
against a running preview (build it with `VITE_DEV_COMPONENTS=1 npx vite
build`, as the e2e server does, and again after app changes), but the full
`npm run e2e` is still the gate before finishing (first time: `bunx playwright
install chromium`). Check UI changes at phone width in the browser too, and
add an e2e spec for every flow worth keeping.

The e2e suite passes on any date, at any time of day, in any timezone, with
no fake clock. The runner and the browser share one zone: `E2E_TZ`, UTC by
default (as in CI). The seed (`e2e/seed.ts`) is shifted by the days between
`SEED_ANCHOR` and today, so it always sits in the same place relative to
today. In a spec:
- never compute `today` when the file loads; call `today()` (from
  `e2e/fixtures.ts`) inside the test or its helpers;
- never write a literal or formatted date for something the seed holds:
  `seedDay('2026-11-14')` (`seedTime()` for timestamps) is where it landed,
  and the app's formatters (`formatDay`, `longDay`, `formatTimestamp`) say
  how it reads;
- set up dates relative to `today()` (`addDays(today(), 3)`), allowing for
  the seed's own around them.

A change that touches dates runs the full suite under
`E2E_TZ=Pacific/Kiritimati` (UTC+14) and `E2E_TZ=Pacific/Pago_Pago` (UTC−11)
as well as UTC.
