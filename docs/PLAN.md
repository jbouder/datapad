# Datapad — build plan

As of 2026-10-23. The functional spec is [SPEC.md](SPEC.md); this document
decides _how_ it gets built. Where the two disagree on product behaviour the
spec wins; where they disagree on look, feel, motion and plumbing, this plan
wins (see "Deliberate departures from the spec").

Datapad is a single-user project tracker for an engineering leader: projects,
tasks, notes, events, people, cross-project views, search, and on-device
summaries. It is built the way [holocron](https://github.com/jbouder/holocron)
is built, deploys to Cloudflare the same way, and shares its design system,
motion rules and UX bar. The two things that are different on purpose: the
data is _kept_ (holocron wipes daily), and nobody but the owner can reach it
(holocron has no accounts). Both follow from the data being personal.

## Decisions

| Area          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo          | `jbouder/datapad` (exists, empty). Local folder `repos/jbouder/datapad`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Runtime       | One Cloudflare Worker serves the SPA and the API; one SQLite-backed Durable Object per user holds all data and fans out live updates over a WebSocket. Same shape as holocron's `BoardObject`, keyed by the signed-in email instead of a board code.                                                                                                                                                                                                                                       |
| Auth          | Cloudflare Access (Zero Trust) in front of the hostname, policy = allow one email. The Worker _also_ verifies the `Cf-Access-Jwt-Assertion` JWT on every request (assets, API, socket) so a misconfigured Access app can never leak. The verified email names the Durable Object.                                                                                                                                                                                                          |
| Data changes  | Every change is a typed op through a shared `reduce()` (`shared/reducer.ts`), run optimistically on the client and authoritatively in the DO, exactly like holocron. Compound ops (delete project cascade, move task, toggle task, reorder, activity append) live there so two devices never clobber each other with whole-document last-writer-wins.                                                                                                                                      |
| Persistence   | DO SQLite: `docs(col, id, json, updated_at)` + `meta(seq)`. Whole document per row. Snapshot on connect; ops broadcast with a sequence number; clients resync on a gap. A nightly alarm writes a JSON export to R2 (30 kept).                                                                                                                                                                                                                                                              |
| Client state  | `useDatapad()` hook: `confirmed` snapshot + `pending` ops, rendered state = `pending.reduce(reduce, confirmed)`. Memoised selectors (open counts, orgs, me, Focus buckets). Last snapshot cached in IndexedDB for instant first paint.                                                                                                                                                                                                                                                     |
| Stack         | React 19 · TypeScript · Vite · Tailwind v4 (CSS-first) · stock shadcn `base-lyra` on Base UI (CLI-managed `src/components/ui`) · Phosphor icons · `cmdk` for ⌘K · zod · Biome · **bun** · `@cloudflare/vite-plugin` · Vitest in workerd · Playwright + axe.                                                                                                                                                                                                                                |
| Look and feel | Holocron's: Oxanium Variable for UI and headings, JetBrains Mono for code, square Lyra radii, themes System / Light / Dark only (holocron's light set and a neutral dark that mirrors it; owner's calls 2026-10-23 and 2026-10-24), an account menu with Settings, Theme, Motion and Sign out.                                                                                                                                                                                             |
| Motion        | Holocron's rules verbatim: no animation libraries; View Transitions for route and theme changes, `@starting-style` entrances, FLIP for reorders and section moves, WAAPI exits, `linear()` springs; tokens not literals; `opacity`/`transform` only; `html[data-motion="off"]` and `prefers-reduced-motion` gate everything.                                                                                                                                                               |
| Summaries     | In the browser on a local WebLLM model, the same model and configuration holocron uses for retro analysis: `@mlc-ai/web-llm` in a Web Worker, Qwen3 1.7B by default (4B and 8B selectable), `temperature` 0.3, `max_tokens` 900, thinking off, streamed. Consent step before the weights download from Hugging Face; hidden behind an "unsupported" state without WebGPU. Context builders are pure functions in `shared/summaries.ts`. Nothing leaves the device and there is no API key. |
| Quality gate  | `npm run check && npm run build && npm test`, plus `npm run e2e` for UI changes. CI runs all of it; deploy follows a green `main`.                                                                                                                                                                                                                                                                                                                                                         |

### Why a Durable Object and not D1

The spec asks for a reactive store, offline-capable local adapter and a remote
adapter. A single DO per user gives all three cheaply: it _is_ the database,
it pushes changes to every open tab and device over one socket, the client
already has an optimistic layer from holocron to reuse, and there is no
second schema or migration tool to maintain. Data volume is low thousands of
documents, well inside DO SQLite. D1 would add a query layer and polling for
nothing the product needs.

### Why Access at the edge _and_ a JWT check in the Worker

Access alone is enough when it is configured; the Worker check makes the
default safe. A Worker that cannot find a valid JWT answers 401 for
everything, including `index.html`, so forgetting to attach the Access
application to a new hostname (a preview Worker, a renamed route) fails
closed. Locally, `.dev.vars` sets `DEV_ACCESS_EMAIL`, honoured only when no
`ACCESS_AUD` is configured, so dev and e2e run without Access.

## Deliberate departures from the spec

| Spec says                                                                          | Datapad does                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude summaries through the Anthropic API                                         | Local WebLLM summaries in the browser, holocron's model and settings                                                                                                                                                                                                   | Owner's call (2026-10-23): keep every word on the device, no API key or per-request cost, and reuse what holocron already proved.                                                                                                                                                                                                                |
| Instrument Sans / Instrument Serif, cool-neutral palette, 10px radii               | Holocron tokens: Oxanium, JetBrains Mono, Lyra square radii, holocron's light and dark tokens                                                                                                                                                                          | Same look and feel as holocron is a requirement. The spec's _structural_ rules (density, dots, pills, 44px mobile rows, visible focus) carry over; its colours and fonts do not.                                                                                                                                                                 |
| Hash routing (`#focus`)                                                            | Path routing (`/` is Focus, `/projects/:id`) with holocron's pushState router                                                                                                                                                                                          | Deep links work with view transitions and Access redirects; hash routes get lost through the Access login round trip.                                                                                                                                                                                                                            |
| `localStorage` fallback + optional remote store                                    | Always remote (the DO), with IndexedDB as a cache and a persisted pending-op queue                                                                                                                                                                                     | There is exactly one user and one backend; the local adapter is for speed and offline tolerance, not an alternative home for the data.                                                                                                                                                                                                           |
| Whole-document `write`/`remove`                                                    | Typed ops through a reducer, including compound ops                                                                                                                                                                                                                    | Two devices (phone and desktop) editing the same project must not overwrite each other's activity log or task order.                                                                                                                                                                                                                             |
| Serif italic "current state" line                                                  | Oxanium, medium weight, `muted-foreground` colour, larger size                                                                                                                                                                                                         | Oxanium has no italic; the line still reads as the one expressive element on the card.                                                                                                                                                                                                                                                           |
| Priority dots / status pills in spec colours                                       | Mapped to semantic tokens: `destructive`, new `--warn`, new `--ok`, `muted-foreground`, `border`                                                                                                                                                                       | Every theme must define every token; the themes test enforces it.                                                                                                                                                                                                                                                                                |
| Markdown subset: one heading style, no fenced code, no quotes                      | Three heading levels, fenced mono blocks, block quotes, dividers, strike, plus a `/` command menu and keyboard toggles in the composer                                                                                                                                 | Notes are a primary job of the app; the storage stays plain Markdown so exports and imports are unchanged. Nested lists, tables and images remain out.                                                                                                                                                                                           |
| People view in the main nav (`#people`); Export / Import in the rail footer        | Settings page (`/settings/…`, from the account menu) with Appearance, People, Orgs, Data and Account; the main nav is Focus, Projects, Tasks, Notes, Events                                                                                                            | Owner's call (2026-10-24): people and orgs are reference data, not daily work, and data in/out is rare. `/people` redirects to `/settings/people`; a selected person is `/settings/people/:id` (list beside a detail pane). Removing a person also clears their assignments, project memberships and event attendance; mentions read `@unknown`. |
| No per-user settings                                                               | A `settings` document (`defaultOrg`, default "OpenTeams Internal") stored with the data and in exports; theme and motion stay per device                                                                                                                               | Owner's call (2026-10-24): new projects start in the owner's own org. The artifact's export has no settings and imports unchanged.                                                                                                                                                                                                               |
| Event row actions inline; attendees in a PersonPicker (multi)                      | Edit and Delete in the row's ⋯ menu (Delete confirms in the row); attendees are the same toggle chips as project members                                                                                                                                               | Phone rows stay readable at 412px; one multi-select pattern across the app.                                                                                                                                                                                                                                                                      |
| Summarize hidden when no model is available; errors `not_granted` / `rate_limited` | Summarize is always there; without WebGPU its panel says summaries are unsupported, and before the first download it asks (model picker, size, source). A Settings → Summaries section picks the model and removes the weights. Event Summarize is in the row's ⋯ menu | The model is local and opt-in, so "not available" is a state to explain, not to hide; there is no account to grant or rate-limit                                                                                                                                                                                                                 |

## Data model

The six spec collections (project, task, note, event, person, activity) plus
`Link`, as typed in `shared/types.ts` with zod schemas in
`shared/protocol.ts` (used for import validation and for every op). Ids,
mention tokens and `order` values are kept so a JSON export from the
artifact imports unchanged.

Fields added in later milestones (all optional, absent on import):
- `project.health`: `none | green | yellow | red` (deferred feature 1; M7,
  `setHealth` op, read with `healthOf()` so an absent field is `none`).
- `task.blocked`: `{ on: personId | null, note: string } | null` (deferred 3).
- `project.orgId`: once orgs become first class.

New collections, agreed as worth having (milestone 7):

| Collection   | Fields                                                                                                                                                                                      | Where it shows                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision** | id, projectId (null = General), title, rationale (markdown, mentions), status `proposed \| decided \| revisited`, decidedAt (date), deciders personId[], links Link[], createdAt, updatedAt | Project detail (right column, under Notes), ⌘K search, project summaries, People view (decisions they took part in), activity log                                                                                                                   |
| **Org**      | id, name, kind `client \| internal \| vendor \| partner`, links Link[], notes (markdown), contacts personId[], archived, createdAt, updatedAt                                               | Orgs view (list + detail with its projects, people, upcoming events), the org dropdown on Projects, project header chip. `project.org` (string) stays for import; a one-time migration creates Org docs from the distinct strings and sets `orgId`. |
| **Template** | id, name, tasks `{title, priority, tags}[]`, defaultTags string[]                                                                                                                           | "Start from template" in the new-project form (deferred 4)                                                                                                                                                                                          |

Not added, still rejected: recurring tasks, subtasks, time tracking, comments
on tasks, multi-user.

## Architecture

```
Browser ──HTTP──▶ Worker (worker/index.ts)
   │               ├─ verifyAccess(): Cf-Access-Jwt-Assertion → email, else 401
   │               ├─ GET  /api/config              { email }
   │               ├─ GET  /api/export.json         DO.export()
   │               ├─ POST /api/import              DO.import(json)   (merge by id)
   │               ├─ GET  /ws                      DO.fetch() → acceptWebSocket()
   │               └─ everything else: static assets (SPA fallback), still behind verifyAccess
   └──WebSocket──▶ DatapadObject (worker/datapad.ts), name = email
                     ├─ SQLite: docs(col,id,json,updated_at), meta(seq)
                     ├─ onMessage: zod parse → reduce() → persist changed rows → broadcast {op, seq}
                     ├─ snapshot on connect, {type:'sync'} on gap
                     └─ alarm(): nightly export to R2 BACKUPS bucket, prune to 30
```

### Layout (mirrors holocron)

- `shared/` — `types.ts`, `protocol.ts` (ops + messages, zod), `reducer.ts`
  (**the only place state changes**), `markdown.ts` (renderer + mention
  conversions), `summaries.ts` (context builders + prompt), `select.ts`
  (pure selectors: buckets, counts, orgs, mentions), `limits.ts`,
  `dates.ts` (shorthand parsing, overdue/today).
- `worker/` — `index.ts` (routes, Access check, headers), `access.ts` (JWT
  verification with JWKS cache), `datapad.ts` (the DO), `env.ts`.
- `src/` — `hooks/useDatapad.ts` (socket, optimistic ops, IndexedDB cache),
  `lib/router.ts`, `lib/motion.ts`, `hooks/useFlip.ts`, `providers/*`
  (Motion, Theme, Toast, Datapad), `components/` (AppShell, Rail, TabBar,
  TopBar, PreferencesMenu, TaskRow, QuickAdd, NoteCard, NoteComposer,
  EventRow, SidePanel, Palette, Toast, DatePicker, PersonPicker,
  ProjectPicker, TagInput, LinksEditor), `pages/` (Focus, Projects,
  ProjectDetail, Tasks, Notes, Events, People, Archive, Orgs, Digest, Help).
- `test/` — Vitest in workerd: reducer, markdown, selectors, dates, DO
  storage and sync, Access verification, headers/CSP.
- `e2e/` — Playwright + axe against `vite preview` with the dev Access
  bypass; one spec per view plus keyboard, motion, reflow and a11y suites.
- `docs/` — SPEC, this PLAN, architecture, self-hosting (Access setup
  included), security (threat model), data (what is stored where, backups,
  export).

## Tasks and notes come first

Tracking tasks and taking notes are the two jobs this app exists for, so they
get the most depth and ship before everything else (milestones 2 and 3).
Beyond the spec:
- **Tasks.** Quick-add on every list; list keyboard navigation (`j` / `k`
  move, `x` toggles, `e` opens the panel, `d` sets due); inline popovers for
  priority, due and assignee from the row; a dense sortable table on desktop
  with multi-select and bulk close / move / assign / delete; undo on close
  and delete; keyboard and touch reorder, not only mouse drag; a task's
  source note shown in its panel; "Mine" as a one-key filter.
- **Notes.** Composer that feels like a text editor: `@` mentions, a `/`
  command menu for formatting (`/h1` `/h2` `/h3`, `/bullet`, `/numbered`,
  `/checklist`, `/code`, `/quote`, `/divider`, `/date`, `/mention`, `/task`),
  ⌘B / ⌘I / ⌘E (code) / ⌘⇧7 / ⌘⇧8 toggles, a compact formatting bar on
  touch, list and checklist continuation, paste of Markdown preserved,
  ⌘/Ctrl+Enter to add, drafts kept per project across navigation. Rendered
  notes support distinct text styles: three heading levels, body, inline
  code, fenced mono blocks, block quotes, dividers, bold, italic, strike,
  links, mention chips, and checklists that are _clickable_ (fixes the
  spec's known gap). Pinned notes; full-text filter on the Notes page and in
  ⌘K; select-text → Make task; notes linked to events and to the task they
  produced; edit in place with the same editor.

## Mobile is a first-class target

Datapad will be used a lot on a phone (owner's requirement, 2026-10-23), so
every view is designed and tested at phone width, not adapted afterwards:
- **Tested on a phone viewport by default.** Playwright runs every spec in
  two projects, desktop Chromium and a mobile project (Pixel 7: 412px, touch,
  mobile user agent). A view is not done until both pass, axe included.
  `reflow.spec.ts` also checks 320px.
- **Navigation for thumbs.** Below 820px the rail is replaced by a bottom tab
  bar (Focus, Projects, Tasks, Notes, More) that respects
  `env(safe-area-inset-bottom)`; the top bar keeps search and **+**. Toasts
  and the quick-add sit above the tab bar, never under it.
- **Touch targets.** 44px rows and at least 44px hit areas for every control
  on touch (`@media (pointer: coarse)`), WCAG 2.5.8 measured in e2e.
- **No hover-only affordances.** Anything revealed on hover is always
  visible on `hover: none` devices (the `hover-none` variant).
- **Panels are full screen** below 820px, with a sticky footer for Save and
  Cancel that stays above the on-screen keyboard (`interactive-widget=
  resizes-content` and `dvh` units).
- **Inputs behave on phones.** 16px minimum font size in inputs (no iOS
  zoom), the right `inputmode` / `enterkeyhint` / `autocapitalize`, and the
  notes composer's compact formatting bar replaces keyboard shortcuts.
- **Tables collapse to rows.** Dense desktop tables (Tasks, Projects) render
  as stacked rows on mobile; board and timeline layouts scroll horizontally
  inside their own container, never the page.
- **Touch reorder and swipe.** Drag reorder has a long-press handle on touch
  plus Move up / Move down in the row menu.
- **Installable.** The PWA manifest (see design.md § Installing) makes it a home-screen app with
  standalone display and theme colours per theme.

## UX standards (data entry first)

Datapad is mostly typing things in and reading them back, so the entry path
gets the most care:
- **Enter adds, stays put.** Every list has a quick-add that creates on Enter
  and keeps focus. `n` focuses the nearest one. No modal on the common path.
- **Panels, not pages, for editing.** Side panel (460px, full width on
  mobile) slides in with `@starting-style`; ⌘/Ctrl+Enter saves, Esc cancels,
  a dirty panel asks before closing. The panel renders once on open, so a
  background sync never clobbers an edit in progress.
- **Pickers are comboboxes.** Project, assignee, org, tags and template
  pickers are typeahead comboboxes (Base UI), fully keyboard operable, with
  "Create '…'" at the bottom where it makes sense (tags, org, person).
- **Dates accept typing.** `today`, `tomorrow`, `fri`, `next tue`, `+3d`,
  `10/31`, `2026-10-31` all parse; a calendar popover is there for the mouse.
  Overdue is `destructive`, today is `warn`, both with text not only colour.
- **Inline edits in rows.** Priority, due and assignee open a small popover
  from the row itself on desktop; the title click still opens the panel.
- **Tasks view is a dense table on desktop** (sortable columns, grouped
  headers, sticky header) and rows on mobile. Multi-select with shift-click
  for close / move / assign / delete in bulk.
- **Switchable layouts behind a button group.** Pages that show a
  collection offer more than one way to look at it, picked from a segmented
  `ViewSwitcher` in the page toolbar and remembered per page (URL query +
  `localStorage`): Projects = Cards · Table · Timeline (target dates and
  milestones on a time axis); Tasks = List · Table · Board (columns by due
  bucket, project or assignee) · Timeline (by due date); Notes = Feed ·
  Grid; Events = List · Calendar (month grid) · Timeline; People = List ·
  Cards. Switching runs inside a `layout` view transition and FLIPs items
  that exist in both layouts, so the same task is seen moving rather than
  re-appearing. Every layout exposes the same actions (open, close, inline
  edit, drag where it applies) so none is a dead end.
- **Undo instead of confirm** for close, delete and archive: the toast
  carries Undo (holocron's `Toast` already supports it). Only project delete
  and person delete keep a confirmation.
- **Density.** 15px base, 36px rows on desktop, 44px on mobile, 232px rail,
  1040px content max; project detail is a 3:2 grid above 820px.
- **Accessibility.** WCAG 2.2 AA via axe in every theme; visible focus rings;
  live region for toasts and sync status; drag reorder has keyboard and
  touch equivalents (move up / down in the row menu).
- **Sync status is visible but quiet.** Rail footer shows "Saved", "Saving…"
  or "Offline, 3 changes waiting"; never a blocking spinner.

## Milestones

Each milestone ends with: CI green, deployed, an e2e spec for every flow it
added, axe clean in every theme, and the docs updated. M8 is the deliberate
follow-up pass once the product is in daily use: it audits the whole rather
than each piece.

| #   | Milestone                              | Outcome                                                                                                                                                                                                                                                   |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Scaffold, pipeline, Access             | Repo matches holocron's tooling; CI + deploy; Access in front, Worker verifies JWT; empty DO answers; AGENTS.md, docs skeleton                                                                                                                            |
| 1   | Domain and sync                        | Types, ops, reducer with tests; DO storage, snapshot, broadcast, resync; `useDatapad`; IndexedDB cache; JSON import/export so existing data loads on day one                                                                                              |
| 2   | Shell, Projects, Tasks                 | Rail / tab bar / top bar / Preferences; router with view transitions; Projects grid + filters; Project detail; task rows, quick-add, close, task panel, drag reorder, state line                                                                          |
| 3   | Notes and mentions                     | Markdown renderer; mention tokens and autocomplete; composer with list continuation; Notes view; make task from note                                                                                                                                      |
| 4   | Events                                 | Events view and project events; event form; prep / debrief linkage; agenda strip                                                                                                                                                                          |
| 5   | Focus, People, Search                  | Focus buckets + assignee filter; People list and detail; ⌘K palette                                                                                                                                                                                       |
| 6   | Summaries, backups, polish             | Local streaming summaries (WebLLM); nightly R2 backup; undo; touch / keyboard reorder; persisted offline queue; PWA manifest; Help page; security review                                                                                                  |
| 7   | Extensions                             | Health flag; blocked / waiting-on; Decisions; Orgs; weekly Digest; Templates                                                                                                                                                                              |
| 8   | Quality, security, accessibility, docs | Full a11y audit and WCAG 2.2 AA statement; security review and threat model; web-app maturity audit; performance budgets in CI; coverage thresholds and WebKit e2e; CodeQL; observability and error handling; docs and Help refresh; first tagged release |

## Setting up Cloudflare Access (once)

1. Zero Trust dashboard → Access → Applications → Add → Self-hosted.
   Domain: the Worker's hostname (`datapad.<account>.workers.dev` or a custom
   domain). Session duration: 1 month is fine for a personal device.
2. Policy: Allow, include _Emails_ = the owner's address. Identity provider:
   One-time PIN is enough; add Google if preferred.
3. Copy the application's **AUD tag** and the team domain
   (`<team>.cloudflareaccess.com`). Put them in `wrangler.jsonc` vars as
   `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (both are public values).
4. Deploy. The Worker validates every request's JWT against
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
5. Sign out from the account menu (or Settings → Account), which goes to
   `/cdn-cgi/access/logout`.

PR preview Workers (`datapad-pr-<n>`) are only safe if a wildcard Access
application (`datapad-pr-*.<account>.workers.dev`) covers them and they share
its AUD; until that is verified the preview workflow stays off and PRs are
checked locally.

## Privacy notes

- The repository is public; it never contains data. Fixtures and e2e data
  are fictional. `.dev.vars` is git-ignored.
- All data lives in the owner's Durable Object and the nightly R2 backup,
  both inside the owner's Cloudflare account.
- Summaries run on-device (WebLLM). The only thing fetched is the model's
  weights, from Hugging Face, after the owner agrees; no item data is sent
  anywhere.
- Request logs follow the account's Workers observability settings; the
  email appears in Access logs by design.

## Migration from the artifact

Export from the artifact's sidebar footer → Settings → Data → Import in Datapad.
Ids, mention tokens, `order` values, `sourceNoteId`, `eventId` / `phase` and
`links[]` carry over unchanged; `archived` projects stay archived. Import
merges by id, so it is safe to repeat.
