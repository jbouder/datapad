# Changelog

Every release of Datapad, newest first, in the shape of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are
[tags](https://github.com/jbouder/datapad/tags) on `main`; each has a
[GitHub release](https://github.com/jbouder/datapad/releases). The milestone
numbers (M0–M20) are the
[GitHub milestones](https://github.com/jbouder/datapad/milestones) the work
was planned under.

Datapad has no API version. The only format other software reads is the
export file (`datapad-YYYY-MM-DD.json`, [docs/data.md](docs/data.md#the-format)),
and every release imports every earlier one: old shapes are migrated on
the way in, never refused. The file carries its `format` number; one from
a newer release is refused with a message saying so. A release that
changes the format says so here under **Export format**.

## [Unreleased]

## [0.3.0] — 2026-10-30

Focus looks a set number of days ahead (seven by default, or 3, 5, 10 or
14) and shows every High priority task whatever its due date; new tasks
can go to you by default (Settings → People → Assign new tasks to me),
however they are added. MCP `get_focus` renames `due.thisWeek` to
`due.upcoming`. The export format adds `settings.assignToMe`; the Durable
Object's schema is still version 3.

### Changed

- Focus's Week shows tasks due in the next seven days, the same window as
  its agenda, instead of stopping at Sunday: on a Friday you now see
  Monday's. MCP `get_focus` returns them as `due.upcoming` (was
  `due.thisWeek`).
- Focus's Due shows every open High priority task, whatever its due
  date: one due after the window, or with no date, is in High priority
  too, in Day and Week. MCP `get_focus` returns those as `due.high`.
- Add task on Tasks starts with the default assignee (you, with Assign
  new tasks to me on; else nobody) even when Tasks is filtered by
  Assignee, like every other way of adding a task. It used to start with
  the filtered person.

### Added

- Settings → Pages → Focus → **Week shows**: how many days Focus's Week
  looks ahead, 3, 5, 7, 10 or 14 (7 by default), for both the agenda and
  Due. It is saved with the space, and MCP `get_focus` follows it (and
  says which, as `days`).
- Settings → People → **Assign new tasks to me**: new tasks go to the
  person marked as you unless you pick someone else. The New task panel
  starts with you as the assignee, and `/task`, Make task, a meeting's
  action items and MCP `add_task` without an assignee give you the task.
  Off by default, saved with the space, and needs someone marked “This is
  me”.

### Export format

- `settings.user` may carry `assignToMe: true` (Assign new tasks to me).
  Absent means off, so earlier files import unchanged and older Datapads
  ignore it.

## [0.2.0] — 2026-10-30

Datapad as an MCP server, so Claude can read and add to it; a morning
briefing on Focus (Since yesterday, and Brief me with summaries on);
Tools in the rail; one look across pages (the same header actions, list
toolbar and compact notes); and the follow-ups from the 2026-10-28 audit.
The export format gains a version number; the Durable Object's schema is
still version 3.

### Added

- **`get_recap` for MCP** (#260): a read tool that returns Focus's Since
  yesterday for a space, so Claude can write the morning briefing from the
  same facts: the window (yesterday, or Friday through Sunday on a
  Monday), its count line, tasks closed and added, meetings held with
  their action items and notes, notes written and the other activity
  lines. Takes a `date` to recap the working day before it and an
  `assignee` (an id, a name or `me`).
- **Brief me on Focus** (#259): with summaries on, a Brief me button has
  the on-device model write a short paragraph about the last working day,
  one about today, and up to three things to do first, from what Focus
  already shows, so the names and counts are
  Datapad's. It streams into a card at the top of Focus with Stop,
  Regenerate, Save as note (a General note, "Brief · <day>") and dismiss,
  and stays on this device for the rest of the day, per space, without
  running again. It is never synced and never runs by itself.
- **Since yesterday on Focus** (#258): the first section is what happened
  on the last working day (yesterday; Friday through Sunday on a Monday),
  worked out from the data with no model, so it works on phones and with
  summaries off. A line counts it ("Yesterday: 4 closed · 2 added · 2
  meetings · 3 notes"); below it, tasks closed and added, meetings held
  with their topics covered, action items and notes, notes written, and
  the other activity lines (health, status, blocked, milestones, 5 per
  project). The section
  closes and stays closed like the others.
- **An age limit for the copies kept before a destructive change** (#242):
  set `BEFORE_COPIES_MAX_DAYS` in `wrangler.jsonc` and the nightly backup
  deletes `before-*` copies older than that many days, in every space's
  folder. Off by default: they are kept until you delete them.
  docs/data.md has a checklist for deleting everything of one email
  across the object, R2 and KV.
- **`SECURITY.md`** (#230): what is in scope and how to report a
  vulnerability privately.
- **Which build is running** (#237): Settings → Account and Help → About
  show the version and commit, and `GET /api/health` returns them.
  docs/self-hosting.md sets up an error-rate notification and an alert for
  a failed nightly backup.

- **The whiteboard without a pointer** (#222): with S, T or R picked,
  Enter places a sticky, text or rectangle in the middle of the view, open
  to type in; Alt+arrow keys resize the selection (Shift: 10); with A
  picked, Enter draws an arrow from the selected item to the one you Tab
  to; Enter on an arrow re-aims its head and Shift+Enter its tail (Tab to
  an item, or the arrow keys). Each is read out, undone with ⌘Z, and Esc
  cancels. The whiteboard's keys are listed in Help and the `?` sheet.

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
- **Summaries can be turned off** (#219): Settings → Summaries has an
  on/off switch, remembered on this device. Off, nothing offers Summarize
  (task panel and page, note cards, meeting rows and page, project page,
  digest) and the model is never loaded; Settings still offers to remove
  weights already downloaded. Help says how to turn it back on.
- **Notepad** (#218): Notes opens on a Notepad, one running note for the
  space, written in place with the note composer (`/` styles, `@`
  mentions, `/task`) and saved as you type, a second after you stop and
  whenever you leave it. Saving it is silent in Activity. It is also a
  General note, first in List and Grid and labelled Notepad; emptying it
  removes it.
- **Find on People and Orgs** (#272): Settings → People finds by name,
  role or an org that lists them as a contact, and Settings → Orgs by
  name, kind or notes, in the same toolbar as Tasks and Notes (`?q=`,
  `f`, Clear filters, "None match these filters."). Picking someone keeps
  what you typed. The Default org picker stays where it was.

### Changed

- **Focus has no filters**: it always shows everyone's tasks, with no
  Assignee filter and no `m` shortcut, and Brief me writes about
  everyone's. Tasks keeps its Assignee filter, and a saved Assignee for
  Focus is ignored.
- **Compact notes on project, meeting and task pages** (#273): each note
  is a short row, its time and first two lines, that opens in place to
  the whole note. Edit, Pin, Make task, Summarize, Save as template and
  Delete are in the row's ⋯ menu, on meeting and task notes too. A link
  to a note (a task's "From note") opens its row. Notes keeps its cards.
- **Notes' List uses the same compact rows** (#274): under day headings
  again, each row with its time, project (or General) and meeting, its
  first two lines and the ⋯ menu, opening in place. When Find matches a
  note past the lines its row shows, the row opens, so the match is in
  sight. The Notepad's row still opens its page; Grid keeps its cards.
- **Projects and Archived on the list toolbar** (#270): Find on both
  (name, org, tags or description), then Projects' Status, Health and
  Org, then Sort; Archived gains a Sort, saved with the page as on
  Projects, and its table's headers sort. Clear filters on Projects no
  longer resets the sort. On phones the filters and Sort are in the
  Filters sheet.
- **One toolbar on Tasks and Notes** (#269): Find comes first, then the
  filters, then Sort (new on Tasks, beside the column headers it matches),
  then Clear filters whenever a filter is on or Find has words. Find on
  Tasks now waits for a pause in typing, as on Notes, and has a clear
  button on both; `f` goes to Find and Esc in it clears it, then leaves.
  Clear filters leaves the layout, sort and grouping alone. Tasks says
  "None match these filters." with Clear filters when filtered to
  nothing, as Notes now does (it said "No notes match."). Tasks' Show is
  now Status. On phones the toolbar is Find and a Filters (n) button that
  opens a sheet with the rest, instead of every filter stacked above the
  list.
- **Meetings and Focus on the list toolbar** (#271): Meetings has Find
  (a meeting's title, agenda, topics and attendees by name) beside its
  Project filter, and when nothing matches, the List, Calendar and
  Timeline each say "None match these filters." with Clear filters (the
  List said "No meetings match."). Focus's Assignee filter moves out of
  the title row into the same toolbar (on phones, the Filters sheet); `m`
  still toggles Mine.
- **One set of header actions on detail pages**: a project's, a meeting's
  and a task's page now show the same few buttons, the state action when
  there is one (Close or Reopen on a task), Edit, then a More menu (⋯)
  with the rest: Summarize, Move to…, Save as template, Carry forward, and
  Archive or Delete last. The meeting and task pages' buttons are 44px on
  phones now, as the project page's were.
- **All notes from the Notepad**: a link beside the Notepad's heading
  goes to Notes.
- **Date pickers start the week on Sunday**: the calendar behind every
  date field now shows Sunday first.
- **Tools in the rail** (#261): a **Tools** group under the sections
  holds the Notepad, the Whiteboard and the Weekly digest, in that order
  by default. Settings → Navigation has a Tools table like the sections'
  (Show, Phone, Move up / Move down), and any tool can be hidden; the
  heading goes when all are. On a phone each tool is off the tab bar
  until its Phone switch puts it there (after the sections, six tabs at
  most), and the account menu has every shown tool the tab bar leaves
  out. The Whiteboard is no longer a section, and the Weekly digest is
  no longer a rail extra: it shows whenever it is switched on, projects
  or not. A hidden Whiteboard or a switched-off digest stays that way.
- **The Notepad has its own page**, `/notepad` (#261). Notes is List
  (now the default) and Grid; the Notepad's note still comes first in
  both, and opens the Notepad. ⌘K has Go to Notepad. An old
  `/notes?view=notepad` link lands on `/notepad`, and a saved Notepad
  layout on Notes reads as List.
- **MCP writes are retry-safe** (#244): every write tool takes an
  optional `requestId`; calling again with the same one returns what the
  first call made instead of adding it twice, and one spent on a
  different change is refused. `edit_task` is now marked destructive (it
  replaces a task's details), and the instructions a client gets at
  `initialize` say that text in Datapad is the owner's data, never
  instructions (docs/mcp.md).
- **Quieter control edges**: selects, the layout switch, segmented
  choices and outline buttons (in Dark too) now share the cards' light
  border. Text fields and checkboxes keep the darker 3:1 edge that shows
  where to type.
- **Sections open and close without moving**: only the caret turns; the
  header no longer shrinks on press (it read as a jump to the right) and
  the body no longer fades in.

- **Focus is tidier** (#218): no quick-add at the top (`n` and the +
  menu open the new-task panel), agenda cards are all one height with no
  Add note (a meeting's notes are written on its page or panel), and Due
  is grouped by priority, High first, instead of Overdue, Today and This
  week; an overdue task still shows its date in red.
- **Notes' layouts are Notepad, List and Grid** (#218). List, which was
  Feed, is one compact row per note (its first line, project, day,
  pinned) that opens the note in place. Grid is a masonry grid: cards keep
  their height and pack into columns with no holes, in reading order, one
  column on phones. A saved or linked Feed reads as List.
- **Datapad starts lighter** (#234): Whiteboard, Help, Digest, Settings
  and a meeting's and a task's page load on demand (and in the background
  once the app is idle), so the first load downloads about 11% less
  script (377 KB gzipped, from 423 KB). CI fails a change that grows the
  first load past its budget or pulls the summary model's library into it.

### Export format

- **A format version** (#240): exports and backups now start with
  `"format": 1`. A file without it (every earlier export, and the
  artifact's) is legacy and imports as before. A file with a newer
  format than this Datapad knows is refused whole, on Import and on
  restoring a backup, with a message that says to update Datapad.
- A note may carry `scratch: true` (#218): the space's Notepad. Files
  from before it import unchanged; an export writes it only on that note.
  An import that brings a second Notepad keeps the older one as the
  Notepad and the other as an ordinary note.
- `settings.nav` may carry `tools` (#261): `{ order, hidden,
  phoneHidden }`, the rail's Tools (`notepad`, `whiteboard`, `digest`).
  Files without it import unchanged, and their `whiteboard` in `hidden` /
  `phoneHidden` and `extras.digest` still decide those two tools until
  `tools` is saved. An export writes it only once Settings → Navigation
  has changed a section or a tool.

### Fixed

- **Selecting tasks shows the selection bar again**: ticking a task's
  box on Tasks put the bar (Close, Move…, Assign…, Set due…, Delete) at
  the foot of the page instead of the window, out of sight below a long
  list, so the box seemed to do nothing. It stays at the bottom of the
  window now.
- **Layout switchers and segmented filters line up with their
  neighbours**: they were 2px taller than the buttons and selects beside
  them on phones (Brief me looked short next to Focus's switcher); the
  task panel's priority picker too.
- **Text fields have the same quiet edge as the other controls**: Find,
  and every text box and text area, now take the light border buttons and
  selects have, rather than a darker one. Checkboxes keep the darker edge
  that shows an unticked box.
- **Brief me and Summarize no longer show `<think>`** at the top of their
  text: Qwen3 opens with an empty thinking block even with thinking off,
  and it is now left out as it streams, in saved notes and in a brief
  kept from earlier in the day.

- **Undo keeps edits made since** (#235): Undo of a bulk close, move,
  assign, due date or delete, or of a drag on the Tasks board, puts back
  only what that change did, through the same checked changes the app
  makes, so an edit from another tab or MCP in between stays. It is
  refused, with the reason, when the task's project was deleted since,
  and Activity says what it did (a deleted task logs "Restored task").
- **Rolling back past a schema bump** (#227): a Worker older than your
  data's schema no longer runs over it. The object reads and writes
  nothing, the nightly backup included; every call, the socket and
  `GET /api/health` answer 503 "This Datapad's data is from a newer
  version; deploy that version again". docs/self-hosting.md has a
  **Rolling back** section: `wrangler rollback`, and what to do across a
  schema bump.
- **The phone's tab bar stays solid during transitions** (#219): it no
  longer goes see-through while a page, layout or space change animates;
  it holds still on top, as does the top bar.
- **The installed app shows the Datapad icon** (#219), not a letter "D":
  the home-screen icons are embedded in the manifest and the page, so a
  phone never has to fetch one past Access. Remove and re-add an icon
  installed before. The manifest's description says meetings and
  milestones, not events.
- **Segmented controls** (layout switcher, Theme and Time, Status,
  Priority): the selected segment no longer covers the frame's edge, and
  the dividers are the frame's colour.

### Security

- **MCP and Access hardening** (#232): `/oauth/authorize` requires PKCE
  (S256) of every client, confidential ones too; the consent page ticks
  **write** only when the app asked for it; the 60-calls-a-minute limit
  counts per grant, so refreshing a token no longer resets it; the Access
  key fetch times out after five seconds and is shared by concurrent
  requests; the dev bypass answers only on `localhost`, and the deploy
  workflow fails when `wrangler.jsonc` has an empty `ACCESS_AUD` or a
  `DEV_ACCESS_EMAIL`.
- **HSTS and asset caching** (#233): `Strict-Transport-Security` on every
  response, and the hashed files under `/assets/` are kept a year
  (`private, immutable`), so a launch no longer revalidates them.
- **Request ids and security logs** (#236): every Worker response carries
  `x-request-id` (the `cf-ray`), and a 500 shows it; a view that crashes
  reports its message and component stack to the Worker's log
  (`POST /api/client-error`, no document content); allowing or revoking an
  MCP app, erase, deleting a space, import and restore each log one line,
  with no email or token.

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
- **The summary model is pinned and checked** (#239): its WebGPU library
  comes from a fixed commit, not a moving branch, and its weights from a
  fixed Hugging Face revision; WebLLM checks the library, the model's
  config and its tokenizer against hashes and refuses one that differs.
  A model downloaded before downloads once more (it now comes from the
  pinned address); the old copy is freed once the new one has loaded.
- **Pinned tooling** (#238, #245): one Bun version everywhere
  (`packageManager` in `package.json`), the Playwright image by digest,
  and CI now checks every installed package's license against an
  allowlist, runs knip for unused code and dependencies, and holds
  coverage floors on `shared/` and `worker/`.

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

[Unreleased]: https://github.com/jbouder/datapad/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jbouder/datapad/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jbouder/datapad/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jbouder/datapad/releases/tag/v0.1.0
