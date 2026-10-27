# Datapad — build plan

Written 2026-10-23, kept current through v1.0.0 (2026-10-27). The
functional spec is [SPEC.md](SPEC.md); this document decides _how_ it gets
built. Where the two disagree on product behavior the spec wins; where they
disagree on look, feel, motion and plumbing, this plan wins (see
"Deliberate departures from the spec"). The spec has been updated as the
product changed, so the departures table below is also the record of what
changed during the build and why.

Datapad is a single-user project tracker for an engineering leader: projects,
tasks, notes, meetings and milestones, people, cross-project views, search, and on-device
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
| Persistence   | DO SQLite: `docs(space, col, id, json, updated_at)` + `spaces(…, seq)` + `meta`. Whole document per row. Snapshot on connect; ops broadcast with a per-space sequence number; clients resync on a gap. A nightly alarm writes each space's JSON export to R2 (30 kept per space).                                                                                                                                                                                                          |
| Client state  | `useDatapad()` hook: `confirmed` snapshot + `pending` ops, rendered state = `pending.reduce(reduce, confirmed)`. Memoized selectors (open counts, orgs, me, Focus buckets). Last snapshot cached in IndexedDB for instant first paint.                                                                                                                                                                                                                                                     |
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
closed. Locally, `.dev.vars` sets `DEV_ACCESS_EMAIL`, honored only when no
`ACCESS_AUD` is configured, so dev and e2e run without Access.

## Deliberate departures from the spec

| Spec says                                                                          | Datapad does                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude summaries through the Anthropic API                                         | Local WebLLM summaries in the browser, holocron's model and settings                                                                                                                                                                                                                                                            | Owner's call (2026-10-23): keep every word on the device, no API key or per-request cost, and reuse what holocron already proved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Instrument Sans / Instrument Serif, cool-neutral palette, 10px radii               | Holocron tokens: Oxanium, JetBrains Mono, Lyra square radii, holocron's light and dark tokens                                                                                                                                                                                                                                   | Same look and feel as holocron is a requirement. The spec's _structural_ rules (density, dots, pills, 44px mobile rows, visible focus) carry over; its colors and fonts do not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hash routing (`#focus`)                                                            | Path routing (`/` is Focus, `/projects/:id`) with holocron's pushState router                                                                                                                                                                                                                                                   | Deep links work with view transitions and Access redirects; hash routes get lost through the Access login round trip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `localStorage` fallback + optional remote store                                    | Always remote (the DO), with IndexedDB as a cache and a persisted pending-op queue                                                                                                                                                                                                                                              | There is exactly one user and one backend; the local adapter is for speed and offline tolerance, not an alternative home for the data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Whole-document `write`/`remove`                                                    | Typed ops through a reducer, including compound ops                                                                                                                                                                                                                                                                             | Two devices (phone and desktop) editing the same project must not overwrite each other's activity log or task order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Serif italic "current state" line                                                  | Oxanium, medium weight, `muted-foreground` color, larger size                                                                                                                                                                                                                                                                   | Oxanium has no italic; the line still reads as the one expressive element on the card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Priority dots / status pills in spec colors                                        | Mapped to semantic tokens: `destructive`, new `--warn`, new `--ok`, `muted-foreground`, `border`                                                                                                                                                                                                                                | Every theme must define every token; the themes test enforces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Markdown subset: one heading style, no fenced code, no quotes                      | Three heading levels, fenced mono blocks, block quotes, dividers, strike, plus a `/` command menu and keyboard toggles in the composer                                                                                                                                                                                          | Notes are a primary job of the app; the storage stays plain Markdown so exports and imports are unchanged. Nested lists, tables and images remain out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| People view in the main nav (`#people`); Export / Import in the rail footer        | Settings page (`/settings/…`, from the account menu) with Appearance, Pages, Navigation, Templates, Summaries, Spaces, People, Orgs, Data and Account. The rail and the phone tab bar are Focus, Projects, Tasks, Meetings, Notes; the account menu has the spaces (the phone's switcher), Motion, Theme, Settings and Sign out | Owner's calls: data in/out is rare, so it sits in Settings (2026-10-24). People and Orgs started there as reference data (2026-10-24), moved to the rail (#93) once People became a 1:1-prep view and Orgs got pages, and went back under Settings on 2026-10-26 (#159): the forms add people and orgs inline (#160), so the pages are for tidying, not daily navigation. `/settings/people(/:id)` and `/settings/orgs(/:id)` are canonical; `/people(/:id)` and `/orgs(/:id)` redirect. The account menu lost New space… and Manage spaces the same day; Settings → Spaces makes and manages spaces. Removing a person also clears their assignments, project memberships and meeting attendance; mentions read `@unknown`. |
| No per-user settings                                                               | A `settings` document (`defaultOrg`, empty until you pick one in Orgs; `pages`, each page's saved layout, sort, grouping, filters and sections, #186) stored with the data and in exports; theme and motion stay per device                                                                                                     | Owner's call (2026-10-24): new projects start in the org you pick; since 2026-10-25 nothing is the default until then, so a new space starts with no orgs. The artifact's export has no settings and imports unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Meeting row actions inline; attendees in a PersonPicker (multi)                    | Edit and Delete in the row's ⋯ menu (Delete confirms in the row); attendees are the same toggle chips as project members                                                                                                                                                                                                        | Phone rows stay readable at 412px; one multi-select pattern across the app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Summarize hidden when no model is available; errors `not_granted` / `rate_limited` | Summarize is always there; without WebGPU its panel says summaries are unsupported, and before the first download it asks (model picker, size, source). A Settings → Summaries section picks the model and removes the weights. Meeting Summarize is in the row's ⋯ menu                                                        | The model is local and opt-in, so "not available" is a state to explain, not to hide; there is no account to grant or rate-limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Departures made during the build

Each of these changed the spec after the fact (SPEC.md now says what the
app does); this is where they came from.

| Was                                                                                   | Is                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One `events` collection typed meeting, demo, milestone, deadline or other (M4)        | Meetings (a collection, untyped) and milestones (embedded in the project, `{id, title, date}`); `shared/migrate.ts` converts older files and the object's schema 3 converts stored data (M10, #130–#133)                                                                                                                | Owner's call (2026-10-25): events were only ever meetings, so the type goes; a milestone belongs to its project, with ops of its own; a deadline is the project's target date. Nothing is wiped. |
| A note is linked to a meeting as Prep or Debrief (`phase`, M4, redone in #163)        | One **Add note** on every meeting, as many times as you like, newest first, exactly like a task's running notes; `phase` is kept on old notes and never set (M16, #167)                                                                                                                                                 | Owner's call (2026-10-26): one kind of note, added whenever one is needed, is how meeting notes are taken.                                                                                       |
| Topics are not in the spec                                                            | A meeting has topics (an agenda line each: covered, outcome, order), a series (same title, project and people) and **carry forward** of uncovered topics to the next meeting (M11, #134–#137)                                                                                                                           | Owner's request (2026-10-25).                                                                                                                                                                    |
| A meeting and a task open in panels                                                   | A meeting has a page (`/meetings/:id`: header, topics, notes, previous and next in its series, #172); a task has a page from Tasks (`/tasks/:id`, #173) and its panel everywhere else                                                                                                                                   | Topics plus notes plus action items did not fit a 460px panel; the project page was the pattern to copy.                                                                                         |
| Decisions, a collection and page (M7)                                                 | Retired (#183): the data is kept, exported, imported and moved with the project; nothing shows it                                                                                                                                                                                                                       | Owner's call (2026-10-26): whole-feature removal rather than only the project section.                                                                                                           |
| The project's one-line current state (spec's card line)                               | Dropped from the UI (#181); `state` and `setState` are kept so queued ops still apply                                                                                                                                                                                                                                   | Owner's call (2026-10-26).                                                                                                                                                                       |
| Focus lists tasks in due buckets (Overdue, Today, This week, Later, No date, Blocked) | A **briefing** (#206, #207): the week's movement, the agenda with each meeting's prep line, Waiting on (blocked tasks by person), Attention (projects off health, near or past target, or quiet two weeks), Follow-ups (open action items) and Due (Overdue, Today, This week in Week); Later and No date stay on Tasks | Owner's call (2026-10-27): Focus had become a second Tasks page; the signals it should surface were already in the data.                                                                         |
| Action items are not in the spec                                                      | A task may carry `meetingId` (#185): added from the meeting's page or panel, or from a topic; ordinary tasks in the meeting's project that say where they came from                                                                                                                                                     | Owner's call (2026-10-26): real tasks rather than a checklist on the meeting.                                                                                                                    |
| Task notes are not in the spec                                                        | A note may carry `taskId` (#164): dated running notes on a task, in its panel and page, ordinary notes on Notes                                                                                                                                                                                                         | Owner's request (2026-10-26): a dated entry ("pinged legal, waiting on the redline") instead of rewriting the details.                                                                           |
| One Datapad per email                                                                 | **Spaces** (M9, #113–#119): one or more complete Datapads in the same object, `main` first, switched per device, each with its own socket, sequence and backups; Move to… takes a project across                                                                                                                        | Owner's request (2026-10-25). The object stays named by the email alone, so a space id is never a credential.                                                                                    |
| No whiteboard                                                                         | A freeform SVG canvas per project and one for the space (M12, #138–#141): stickies, text, rects, arrows, ink; undo and redo; ⌘K; PNG and SVG download. `boardItems` is a collection; board ops are silent in the activity log except one daily line                                                                     | Owner's choice (2026-10-25): a freeform canvas, hand-built on SVG, rather than a sticky board or tldraw / Excalidraw.                                                                            |
| Templates are project task lists (M7)                                                 | A template with `body` is a note template (#204): `/template` in the composer, the Template picker on a new note, Save as template on a note                                                                                                                                                                            | Owner's request (2026-10-27): 1:1s, retros and status updates are written the same way every time.                                                                                               |
| Filters live in the URL, layouts in `localStorage`                                    | Each page's layout, sort, grouping, filters and open sections are saved with the space (`settings.pages`, #186) and the rail, tab bar and + menu are configurable per space (`settings.nav`, #187, #201, #213); the URL still wins when it names a filter                                                               | Owner's request (2026-10-27): a page opens the way it was left on every device; six tabs crowd a phone, so the whiteboard stays off its tab bar unless chosen.                                   |
| Reporting (M13: status reports, metrics, charts)                                      | Not built; its issues were closed on 2026-10-27 with nothing merged. The weekly Digest remains the report                                                                                                                                                                                                               | Owner's call.                                                                                                                                                                                    |

## Data model

The six spec collections (project, task, note, meeting, person, activity) plus
`Link`, as typed in `shared/types.ts` with zod schemas in
`shared/protocol.ts` (used for import validation and for every op). Ids,
mention tokens and `order` values are kept so a JSON export from the
artifact imports unchanged.

Fields added in later milestones (all optional, absent on import):
- `project.health`: `none | green | yellow | red` (deferred feature 1; M7,
  `setHealth` op, read with `healthOf()` so an absent field is `none`).
- `task.blocked`: `{ on: personId | null, note: string } | null` (deferred 3;
  M7, `setBlocked` op, read with `blockedOf()`; removing the person keeps
  the task blocked on no one listed).
- `project.orgId`: the Org record `project.org` names (M7). The text stays
  what shows and what older exports carry; `organizeOrgs` links them by name,
  and renaming an Org renames its projects' text.

New collections, agreed as worth having (milestone 7):

| Collection                                               | Fields                                                                                                                                                                                      | Where it shows                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision** (retired in #183: data kept, shown nowhere) | id, projectId (null = General), title, rationale (markdown, mentions), status `proposed \| decided \| revisited`, decidedAt (date), deciders personId[], links Link[], createdAt, updatedAt | Project detail (right column, under Notes), ⌘K search, project summaries, People view (decisions they took part in), activity log                                                                                                                     |
| **Org**                                                  | id, name, kind `client \| internal \| vendor \| partner`, links Link[], notes (markdown), contacts personId[], archived, createdAt, updatedAt                                               | Orgs view (list + detail with its projects, people, upcoming meetings), the org dropdown on Projects, project header chip. `project.org` (string) stays for import; a one-time migration creates Org docs from the distinct strings and sets `orgId`. |
| **Template**                                             | id, name, tasks `{title, priority, tags}[]`, defaultTags string[]; or `body` (markdown) for a note template (#204)                                                                          | "Start from template" in the new-project form (deferred 4); the Template picker on a new note and `/template` in the composer                                                                                                                         |
| **BoardItem** (M12)                                      | id, boardId (a project id or `general`), kind `sticky \| text \| rect \| arrow \| ink`, x, y, w, h, z, color (one of five tokens), text, points `[x0, y0, …]` relative to x, y              | The project's whiteboard and the space's; ⌘K (sticky, text and rect labels)                                                                                                                                                                           |

Fields added since: `project.milestones` (M10, embedded), `project.startDate`
(#109), `meeting.topics` (M11, embedded), `note.taskId` (#164),
`task.meetingId` (#185), and `settings.nav` / `settings.pages` (#187, #186).
Every one is optional on import and absent in older files
([data.md § The format](data.md#the-format)).

Spaces (M9): every document belongs to one of the user's spaces, each a
complete, separate Datapad in the same Durable Object (`SpaceInfo`,
`MAIN_SPACE` in `shared/types.ts`; [SPEC.md § Spaces](SPEC.md#spaces)).

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
                     ├─ SQLite: docs(space,col,id,json,updated_at), spaces(…, seq), meta
                     ├─ onMessage: zod parse → reduce() → persist changed rows → broadcast {op, seq}
                     ├─ snapshot on connect, {type:'sync'} on gap
                     └─ alarm(): nightly export of each space to R2 BACKUPS bucket, prune to 30 each
```

### Layout (mirrors holocron)

The shape is holocron's: `shared/` (the domain, used by both sides, with
`reducer.ts` the only place state changes), `worker/` (Access check,
routes, the Durable Object), `src/` (the React app), `test/` (Vitest in
workerd), `e2e/` (Playwright + axe, desktop and phone) and `docs/`. The
file-by-file list is kept in [AGENTS.md](../AGENTS.md#layout), which every
change updates; this plan no longer repeats it.

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
  ⌘K; select-text → Make task; notes linked to meetings and to the task they
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
  standalone display and theme colors per theme.

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
  Overdue is `destructive`, today is `warn`, both with text not only color.
- **Inline edits in rows.** Priority, due and assignee open a small popover
  from the row itself on desktop; the title click still opens the panel.
- **Tasks view is a dense table on desktop** (sortable columns, grouped
  headers, sticky header) and rows on mobile. Multi-select with shift-click
  for close / move / assign / delete in bulk.
- **Switchable layouts behind a button group.** Pages that show a
  collection offer more than one way to look at it, picked from a segmented
  `ViewSwitcher` in the page toolbar and remembered per page (URL query +
  the space's saved page preferences, #186): Projects = Cards · Table · Timeline (target dates and
  milestones on a time axis); Tasks = List · Table · Board (columns by due
  bucket, project or assignee) · Timeline (by due date); Notes = Feed ·
  Grid; Meetings = List · Calendar (month grid) · Timeline; People = List ·
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
- **Sync status is visible but quiet.** The top bar shows a dot colored by
  state and "Saved", "Saving…" or "Offline, 3 changes waiting" (on phones
  the dot alone, unless offline); never a blocking spinner (#187).

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
| 4   | Meetings                               | Meetings view and project meetings; meeting form; prep / debrief linkage; agenda strip                                                                                                                                                                    |
| 5   | Focus, People, Search                  | Focus buckets + assignee filter; People list and detail; ⌘K palette                                                                                                                                                                                       |
| 6   | Summaries, backups, polish             | Local streaming summaries (WebLLM); nightly R2 backup; undo; touch / keyboard reorder; persisted offline queue; PWA manifest; Help page; security review                                                                                                  |
| 7   | Extensions                             | Health flag; blocked / waiting-on; Decisions; Orgs; weekly Digest; Templates                                                                                                                                                                              |
| 8   | Quality, security, accessibility, docs | Full a11y audit and WCAG 2.2 AA statement; security review and threat model; web-app maturity audit; performance budgets in CI; coverage thresholds and WebKit e2e; CodeQL; observability and error handling; docs and Help refresh; first tagged release |
| 9   | Spaces                                 | Separate spaces in the one Durable Object (migrated in place, `main` first); per-space sockets, seq and backups; switcher in the rail, account menu and ⌘K; Settings → Spaces; move a project between spaces; docs                                        |
| 10  | Meetings and milestones                | Events become meetings; milestones move onto the project; `migrate.ts` for files and schema 3 for stored data; Meetings page as list, calendar and timeline; milestones on the project page and timelines                                                 |
| 11  | Meeting topics                         | Topics beside the note (covered, outcome, order); a meeting's series; carry forward with Undo; the Focus agenda's topic count                                                                                                                             |
| 12  | Whiteboard                             | `boardItems` model and ops; the SVG canvas (viewport, select, move, resize); stickies, text, rects, arrows, ink; undo and redo; ⌘K; PNG and SVG download; a nav section of its own, off the phone's tab bar by default                                    |
| 13  | Reporting                              | Not built (closed 2026-10-27); see the departures table                                                                                                                                                                                                   |
| 14  | MCP                                    | Planned: OAuth on top of Access, a `/mcp` endpoint, read tools over the shared selectors, then write tools through `reduce()` and Settings → Connected apps                                                                                               |
| 15  | People and Orgs under Settings         | The two pages leave the rail for `/settings/people` and `/settings/orgs`; forms add a person or an org inline by name                                                                                                                                     |
| 16  | Notes on meetings and tasks            | Running notes on a task (`Note.taskId`); meeting notes the same way, Prep / Debrief gone; a meeting page and a task page                                                                                                                                  |
| 17  | Action items, a leaner project page    | Decisions retired; the project header holds Save as template; `Task.meetingId` action items; Focus as a briefing; saved page and navigation preferences; note templates; the top bar's + menu                                                             |

M8 is the one milestone still open at v1.0.0: the e2e shards and test
depth landed, and the accessibility, security, performance, supply-chain
and observability audits (#39, #53–#58) follow the release.

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
Ids, mention tokens, `order` values, `sourceNoteId`, `phase` and
`links[]` carry over unchanged (a note's link to its meeting becomes
`meetingId`, see [data.md](data.md#the-format)); `archived` projects stay archived. Import
merges by id, so it is safe to repeat.
