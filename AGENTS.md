# AGENTS.md — datapad

Guidance for AI agents working in this repository.

## What this is

A private, single-user project tracker for an engineering leader, built
around three places and one input: **Today** (the day as a timeline,
the open loops beside it), the **rooms** (one per project and per
person), **All** (every item of every kind in one list) and the
**capture line**. Lines with no home go to **Scratch**; a meeting opens
in full-screen **meeting mode**. Search and summaries run on the device. Built the way [holocron](https://github.com/jbouder/holocron) is
built. Runs entirely on Cloudflare: Cloudflare Access sits in front of the
hostname, a Worker verifies the Access JWT on every request and serves the
SPA and API, and one SQLite-backed Durable Object per signed-in email holds
all of that user's data and fans out live updates. Inside it the data is
split into one or more spaces, each a complete, separate Datapad (the
first is `main`). Data is **kept**: nothing is wiped. `docs/SPEC.md` is the product spec, `docs/PLAN.md` the build plan
(it wins on look, feel and plumbing).

## Layout

- `shared/` — the domain, used by both sides. `types.ts` (the twelve
  collections, `COLLECTIONS`; `Milestone` embedded in `Project`, `Topic`
  in `Meeting`, `ListItem` in `List`; `lists` and `decisions` are
  retired but kept in the data), `protocol.ts` (zod schemas for
  documents, the export file, ops and socket messages), `reducer.ts`
  (**the only place state changes**; also `merge()` for imports; it
  still handles retired ops such as `reorderTasks` and the list ops for
  old clients), `limits.ts`, `select.ts` (memoizable selectors),
  `dates.ts`, `markdown.ts`, `migrate.ts` (old shapes in: the typed
  collection → meetings and milestones, format 3's to decide, lists as
  checklist notes and no Notepad, and old page settings → All's; every
  import and the DO's schema migrations run it),
  `today.ts` (Today: a day's timeline, what is due, Next up, the day's
  line, the week zoom's days), `loops.ts` (the open loops: Mine, Waiting
  on, To decide; `lanesOf()`), `recap.ts` (Since yesterday,
  `buildRecap()`), `digest.ts` (the week's digest and its Markdown, under
  the week zoom and `get_digest`), `capture.ts` (the capture line, pure:
  what a line means, its chips, the ops that save and undo it),
  `rooms.ts` (rooms, pins and the rail; `owedBy()`, the people who owe
  you), `stream.ts` (a room's stream and
  its person or project filter), `all.ts` (All: kinds, filters, sorts,
  layouts, saved views), `settings.ts` (Settings' sections, defaults and
  Reset), `pages.ts` (saved page preferences, pure: what each page
  remembers, the address over what is saved, what a change saves;
  `PAGES` is also where Help's Layouts table comes from; it keeps the
  retired pages' keys so their saved data still parses),
  `meetings.ts` (meeting filters and order; topics: the form's
  line-to-ops mapping, counts; a meeting's series and carrying topics
  forward), `milestones.ts` (they live on the project), `board.ts`
  (whiteboards: stroke simplification, bounds, hit-testing, z order, a
  board's items, arrows' attachment and re-aiming), `summaries.ts` (the
  models, prompts and contexts Summarize sends for a room, a meeting and
  a task, and Today's Brief me), `schedule.ts` (the nightly backup's
  time, DST-safe), `search.ts` (the ⌘K index and ranking), `routes.ts`
  (the app's addresses, pure: parse, paths, every redirect from an old
  address (`landRoute()`), titles; `src/lib/router.ts` re-exports it),
  `spaces.ts` (space names and order, and the pure halves of moving a
  project between spaces), `shortcuts.ts` (every keyboard shortcut and
  the rule that keeps single letters out of inputs and overlays; Help
  and the `?` sheet list it), `composer.ts` (the note composer's commands as pure
  functions: the `/` commands and what each does (`planCommand`), the
  formatting keys; Help's tables come from it), `note-doc.ts` (the note
  editor's document as JSON and the Markdown both ways, one line one
  block, so a note round-trips unchanged), `mentions.ts` (`@{id}` tokens ↔ `@Name`),
  `notes.ts`, `tasks.ts`, `projects.ts` (filters, sorts and selection),
  `people.ts` and `orgs.ts` (records by name, inline add), `lists.ts`
  (what is left of lists: the helpers the migration and MCP's retired
  list tools read), `templates.ts` (project and note templates).
- `worker/` — `index.ts` (Access check first, then routes), `access.ts`
  (JWT verification with a JWKS cache, the dev bypass), `datapad.ts` (the
  `DatapadObject` Durable Object: per-space state and seq, the schema
  migrations in `ensureTables()`, the space RPCs,
  its nightly R2 backup alarm), `env.ts` (bindings), `log.ts` (request
  ids from `cf-ray`, the JSON error and security-event lines). `mcp/` is the MCP
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
  `/settings/…`), `lib/nav.ts` (`PLACES`: Today, Scratch and All for the
  rail, the tab bar and ⌘K; `ROOMS_TAB`, the phone's fourth tab),
  `hooks/useRooms.ts` + `components/RoomLists.tsx` (the rail's rooms
  and Waiting on, shared with the phone's Rooms page, `/rooms`), `lib/capture.ts` (focusing the capture
  line), `lib/leave.ts` (holding a link, Back or a panel close while an
  inline note asks "Save this note?"),
  `lib/motion.ts` + `hooks/useFlip.ts` (motion helpers;
  `lib/motion-tokens.ts` is the durations and easings script uses, equal
  to the CSS tokens), `hooks/useNow.ts` (a shared minute clock;
  date-bucketed views read `useToday()` so they roll over at midnight),
  `hooks/usePins.ts` (pinned rooms), `hooks/usePlaces.ts`,
  `lib/themes.ts` (System, Light, Dark: neutral, no tint),
  `lib/spaces.ts` (the active space key, per-space cache keys),
  `providers/*` (Motion, Theme, Toast, Datapad with `useSpaces()`,
  PagePrefs), `pages/*` (`TodayPage` is `/`, `ScratchPage` `/scratch`,
  `AllPage` `/all`, `ProjectRoom` `/projects/:id` (Stream, `/plan` and
  `/whiteboard` tabs), `PersonRoom` `/people/:id`, `MeetingMode`
  `/meetings/:id` (full screen: no rail, top bar or tab bar),
  `WhiteboardPage` `/whiteboard`, `SettingsPage`, `HelpPage`; a task opens
  in its panel everywhere), `components/*`: `capture/CaptureLine` (the
  capture line on Today and in each room), `today/` (the day timeline,
  the loop lanes and rows, the recap, the week zoom, Brief me),
  `rooms/` (`RoomFrame`, the frame both rooms share, `RoomStream`, and `PinnedNotes`: the pinned notes in the tab row and the one open at the top),
  `scratch/ScratchBlock` (one note on Scratch, with File to…, Make task
  and To decide), `all/SavedViews` (All's saved view chips),
  `settings/` (the v2 sections: Today, Rooms' options, Capture, All),
  shared layouts in `components/layouts/` (ViewSwitcher, ListToolbar
  (with `inputs/FindField` and `inputs/SortField`; Find, filters, Sort
  and Clear filters), DataTable, CardGrid, Board, Timeline, Calendar),
  `tasks/` (`TaskRow`, `TaskLayouts` for All's list, table and board,
  `BulkBar`, the task panel), `SpaceSwitcher`, `SpacesSettings`,
  `RoomsSettings`, `PinButton`, `projects/MoveProjectDialog`,
  `projects/Milestones`, `projects/ProjectPlan` (the room's Plan tab);
  `meetings/` holds the meeting form, row, list, layouts, the topics
  (`MeetingTopics` in meeting mode and in the meeting's panel), the
  action items, the open loops column (`MeetingLoops`) and the meeting
  note composer; `board/` is the whiteboard canvas (`Board`, composition
  and render; `gesture.ts`, the pointer gestures as a pure state machine
  whose steps return effects as data, driven by `useBoardGestures`;
  `useBoardKeys`, the keyboard map and arrows drawn from the keys;
  `ops.ts`, the pure op builders; `tools.ts`, the tools; its toolbar,
  Edit bar, zoom, `useViewport`, `useHistory` for undo; `BoardMenu` with
  `export.ts`, the pure SVG serializer, and `download.ts`, its browser
  half: tokens resolved, the PNG on a canvas); `notes/LinkedNoteList` is
  the Notes section a task's panel and a meeting share; `notes/NoteRow`
  is the compact note row the rooms, meeting mode and All use, and
  `notes/noteParts` what they share: the actions, editing in place,
  Make task, `?note=`.
- `scripts/` — `licenses.ts` (CI's license check, above),
  `check-deploy.ts` (the deploy workflow's refusal of a config without
  Access or with the dev bypass) over `deploy-config.ts` (its pure rules,
  which `test/workflows.test.ts` runs), `icons.ts` (draws the PWA icons,
  favicon and og image).
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
  one compares with the last), `screenshots/` (the README's).

## Stack

React 19 + TypeScript + Vite · Tailwind CSS v4 (CSS-first, `src/index.css`)
· [Beskar](https://github.com/jbouder/beskar), a shadcn `base-lyra` registry on
Base UI (`src/components/ui`, CLI-managed, do not hand-edit; add or update one
with `bunx shadcn@latest add @beskar/<name> --overwrite`, and see the
`beskar-ui` skill in `.claude/skills`) · Phosphor icons · `cmdk` · zod · Tiptap v3 on ProseMirror for the note editor (`src/components/note-editor/`, its own Markdown serializer in `shared/note-doc.ts`; injected CSS off, styles in `src/index.css`) · Biome · Cloudflare Workers +
Durable Objects via `@cloudflare/vite-plugin` · **bun** for installs (npm's
resolver fails on Vitest 4.1 peers; one version, `packageManager` in
`package.json`, which every workflow uses) · WebLLM for summaries (in-browser, `src/lib/summary-*.ts`; its downloads
pinned with integrity hashes in `summary-pins.ts`)
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
  `DEV_ACCESS_EMAIL` is set (only ever in `.dev.vars`), on a localhost
  hostname. Never set `DEV_ACCESS_EMAIL` as a deployed var; the deploy
  workflow refuses one, and an empty `ACCESS_AUD`
  (`scripts/check-deploy.ts`).
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
  The one exception is the README's own screenshots, committed in
  `docs/screenshots/`: taken the same way, light theme, from the seed.
- **No animation libraries for app motion.** View Transitions, WAAPI,
  `@starting-style`, CSS `linear()` springs. Helpers in `src/lib/motion.ts`,
  `src/hooks/useFlip.ts`. (`tw-animate-css` is imported only because the
  stock shadcn overlays in `src/components/ui/*` use it; do not reach for it.)
  Tokens, not literals (`var(--duration-base)`, `var(--ease-emphasized)`;
  in script `DURATION.base`, `EASE.emphasized` from `@/lib/motion`).
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
npm run e2e          # playwright: build, vite preview, desktop + phone (CI runs this; locally use e2e:changed)
npm run e2e:changed  # only the specs changed since main (npx playwright test --only-changed=main)
npm run preview -- --port 4318   # in another terminal: the e2e runs reuse it, no rebuild
npm run check        # biome check --write
npm run build        # wrangler types + tsc -b + vite build
npm run deploy       # build + wrangler deploy
npm run knip         # unused files, exports, dependencies (knip.jsonc)
npm run licenses     # every installed package's license against the allowlist
npm run test:coverage  # vitest with the coverage floors on shared/ and worker/
```

**Branches and deploys.** `main` deploys production and `staging`
deploys the staging Worker (`env.staging` in `wrangler.jsonc`), each
after CI passes on a push (`.github/workflows/deploy.yml`). The usual
flow is a feature branch into `staging` to try it, then `staging` into
`main`; a small fix can go straight to `main`. Open PRs against `main`
unless asked otherwise.

**Biome checks the code, not the docs.** CI runs `bunx biome ci .`, which
fails on any file Biome would format differently; Markdown is excluded in
`biome.json`, so docs and `CHANGELOG.md` are formatted by hand. Run
`npm run check` after the last code edit, and `bunx biome ci .` before
every commit; it must print no errors.

Run `npm run check && npm run build && npm test` before finishing any change.
When it touches the UI, also run the specs for what changed with
`npm run e2e:changed`, against a running preview (build it with
`VITE_DEV_COMPONENTS=1 npx vite build`, as the e2e server does, and again
after app changes; first time: `bunx playwright install chromium`). Do not
run the full `npm run e2e` locally: CI runs every spec, desktop and phone, on
every pull request, and that is the gate. Check UI changes at phone width in
the browser too, and add an e2e spec for every flow worth keeping.

Each e2e test signs in as a new user, and the local Worker keeps that user's
database and backups in `.wrangler/state` for good. If the build gets slow
(a minute in the CSS step), delete `.wrangler/state`: it is local dev data
only, and the next run recreates it.

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
