# Changelog

Every release of Datapad, newest first, in the shape of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are
[tags](https://github.com/jbouder/datapad/tags) on `main`; each has a
[GitHub release](https://github.com/jbouder/datapad/releases). The milestone
numbers (M0–M17) are the
[GitHub milestones](https://github.com/jbouder/datapad/milestones) the work
was planned under.

Datapad has no API version. The only format other software reads is the
export file (`datapad-YYYY-MM-DD.json`, [docs/data.md](docs/data.md#the-format)),
and every release imports every earlier one: old shapes are migrated on
the way in, never refused. A release that changes the format says so here
under **Export format**.

## [Unreleased]

### Added

- **Datapad is an MCP server** at `/mcp` (M14, #152): Claude Code, Claude
  Desktop and claude.ai connect with `claude mcp add --transport http
  datapad https://<host>/mcp` or a custom connector, sign in through Access,
  approve the client on a consent page (read, and write if ticked), and get
  `whoami` and `list_spaces`. Datapad is its own OAuth 2.1 server for MCP
  clients; a deployment needs an Access Bypass application for the OAuth
  paths and the `OAUTH_KV` namespace (docs/self-hosting.md, docs/mcp.md).
- **MCP read tools** (#153): `get_overview`, `get_focus`, `list_projects`,
  `get_project`, `list_tasks`, `list_notes`, `list_meetings`,
  `list_people`, `list_orgs`, `get_digest` and `search`, over the same
  selectors the app's pages use. Each takes a space by id or name; projects,
  people, orgs and meetings can be named, and an ambiguous name returns the
  candidates.
- **MCP write tools** (#154), with the `write` scope: `add_task`,
  `complete_task`, `reopen_task`, `edit_task`, `set_blocked`, `add_note`,
  `add_meeting`, `add_topic`, `cover_topic`, `create_project`,
  `set_project_status`, `set_project_health` and `add_milestone`. Each
  sends one change through the same path as the app's own, so an open tab
  shows it at once and Activity logs it. Dates can be words ("fri",
  "+3d"), mentions `@Name`. Nothing can be deleted over MCP.
- **Settings → Connected apps** (#154): the MCP apps you approved, with
  what each may do, when it connected and was last used, and Revoke.
- **When something fails, Datapad says so and recovers** (#58). An ended
  Access session shows **Sign in again** instead of a socket that never
  reconnects; waiting changes and drafts are kept. A page that breaks shows
  **This view stopped working** with Reload this view, and the rest of the
  app keeps working. A call that gets no answer says "Could not reach
  Datapad" instead of the browser's "Failed to fetch".
- **A failed nightly backup is retried** after 15 minutes, an hour and four
  hours, and **Settings → Backups** shows when the last one ran, in warn
  colour when the latest attempt failed or a space has gone two days
  without one.
- `GET /api/health` answers whether your Datapad is reachable (no data);
  docs/architecture.md lists every failure path and every log line.
- **Accessibility** (#53): text fields have a visible edge and the focus
  ring is stronger, both at least 3:1 on every surface in Light and Dark.
  Focus is never lost when a panel closes, a toast goes or a link inside a
  page is followed. A toast stays while focus is in it. Selected and
  current items stay visible in forced colours (Windows High Contrast).
  docs/accessibility.md is the conformance statement, with every drag's
  keyboard and touch way.

### Fixed

- **Rolling back past a schema bump** (#227): a Worker older than your
  data's schema no longer runs over it. The object reads and writes
  nothing, the nightly backup included; every call, the socket and
  `GET /api/health` answer 503 "This Datapad's data is from a newer
  version; deploy that version again". docs/self-hosting.md has a
  **Rolling back** section: `wrangler rollback`, and what to do across a
  schema bump.

### Security

- **MCP client registration is capped** (#225): `/oauth/register`, open
  so an MCP client can sign in, takes five registrations a minute per
  client IP and answers `429` after that, so nobody can use up the KV
  write quota that sign-ins need. A registered client nobody approves
  expires after 60 days. The deployment binds a rate limiter,
  `REGISTER_LIMIT` (docs/self-hosting.md).
- **A live connection ends with its sign-in** (#228): a tab left open used
  to keep reading and saving after its Access session expired or was
  revoked. The connection now carries when the session ends and is closed
  at the next change after that; the tab then checks the session and shows
  **Sign in again**, or reconnects if it is still signed in. Nothing typed
  is lost either way.
- **Supply chain checks** (#57): CodeQL on every pull request and weekly;
  CI fails on a known advisory (`bun audit`, moderate and up); a test fails
  on any GitHub Action not pinned to a commit SHA; the Dependabot review
  policy is in docs/self-hosting.md. zod is now 4.6.6 or later (a
  memory-exhaustion advisory in validation, GHSA-mrhx-c7xc-m3w5), and
  the tooling's undici 7.30.1 or later.
- **Security review** (#39): docs/security.md lists every path with its
  check, reviews erase, import and restore, and records the findings. The
  live socket now refuses a connection from another site's page. A link
  saved on a project, task, org or meeting opens only if it is `https:`,
  `http:` or `mailto:`; anything else shows as text. Erasing or deleting a
  space, importing and restoring first save a copy of the space to R2
  (`before-<what>-<time>.json`) and do nothing if they cannot. Ids that
  every JavaScript object already has (`__proto__`, `toString`) are
  refused.
- **MCP can only add and edit, enforced where it writes** (#229): the
  Durable Object refuses any op from a connected app that is not one the
  write tools send (`MCP_OP_TYPES`), alone or inside a batch, so no client
  can delete, archive or overwrite a document even by building the op
  itself. The whole change is refused and nothing is written.

## [0.1.0] — 2026-10-27

The first tagged release: the whole product in daily use on a laptop and a
phone, behind Cloudflare Access, with nothing wiped.

### Added

- **Projects, tasks, notes, meetings, milestones and people** in one place
  (M1–M5), kept in one SQLite-backed Durable Object per signed-in email
  with live updates to every open tab and device, an optimistic client and
  an offline queue that survives a reload.
- **Cloudflare Access in front, verified again in the Worker** on every
  request (M0): without a valid sign-in nothing is served, assets included.
- **Focus**, a briefing of what needs you (M5, rebuilt in M17): the week's
  movement, today's or the week's meetings and milestones with where each
  meeting's prep stands, blocked tasks by who they wait on, projects that
  need attention, open action items and what is overdue or due today.
- **Layouts for every collection** (M2–M5): Projects as cards, a table or a
  timeline; Tasks as a list, a table, a board or a timeline, grouped and
  filtered; Meetings as a list, a month calendar or a timeline; Notes as a
  feed or a grid; People as a list or cards.
- **Notes as Markdown** (M3) with `@` mentions, a `/` command menu,
  formatting keys, clickable checklists, pinned notes, Make task from a
  selection, and note templates (M17).
- **Meetings** (M4, M10) with topics and carry-forward along a series
  (M11), action items (M17), as many linked notes as you like (M16), and a
  page of their own; **milestones** live on the project (M10).
- **Tasks** with a page of their own from Tasks and a panel everywhere else
  (M16), running notes (M16), blocked / waiting-on (M7), bulk close, move
  and assign from the table, keyboard and touch reorder, and undo instead
  of confirm.
- **⌘K search** across every collection, with actions (M5).
- **On-device summaries** of a project, task, meeting, note or digest with
  WebLLM in the browser, after you agree to the model download (M6).
- **Nightly backups** of every space to your own R2 bucket, 30 kept, with
  download and restore in Settings → Data; **export and import** of the
  JSON file, merged by id (M1, M6).
- **Project health**, **orgs**, the **weekly digest** and **project
  templates** (M7).
- **Spaces** (M9): one or more complete, separate Datapads in the same
  object, switched per device, with Settings → Spaces and Move to… on a
  project.
- **Whiteboards** (M12): a freeform canvas per project and one for the
  space, with stickies, text, rectangles, arrows and ink, undo and redo,
  ⌘K search of its text and download as PNG or SVG.
- **People and Orgs under Settings** (M15), added inline from any form.
- **Saved page and navigation preferences** (M17): each page remembers its
  layout, sort, grouping, filters and sections per space; Settings →
  Navigation chooses the rail's and tab bar's sections, what the phone's
  tab bar leaves out, and what the top bar's + offers.
- **System, Light and Dark themes**, motion that respects
  `prefers-reduced-motion` and a Motion switch, a 12-hour or 24-hour clock,
  an installable PWA manifest, and a Help page whose shortcut, `/` command,
  formatting and layout tables are generated from the app's own lists.
- **Quality gates** (M8, in progress): Biome, type check, Vitest in
  workerd, Playwright + axe at desktop and phone width split across four
  CI shards, and a deploy that follows a green `main`.

### Changed

- Events became meetings and milestones (M10); older exports and backups
  are migrated on import and on the object's first wake.
- Meeting notes lost their Prep / Debrief phases (M16): one Add note, as
  many times as you like. Notes written with a phase keep it.
- People and Orgs moved from the rail to Settings (M15).

### Retired

- Decisions (M17) and the project's current-state line are no longer
  shown. Their data is kept, exported, imported and moved with the
  project.

### Export format

The shape in [docs/data.md § The format](docs/data.md#the-format): the
`projects`, `tasks`, `notes`, `people`, `activity`, `meetings`, `settings`,
`decisions`, `orgs`, `templates` and `boardItems` collections, keyed by
id, with `exportedAt`. The Durable Object's schema is version 3. Files from
the original artifact (`ledger-*.json`, with `events`) and from every
earlier Datapad build import unchanged.

[Unreleased]: https://github.com/jbouder/datapad/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jbouder/datapad/releases/tag/v0.1.0
