# Changelog

Every release of Datapad, newest first, in the shape of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are
[tags](https://github.com/jbouder/datapad/tags) on `main`; each has a
[GitHub release](https://github.com/jbouder/datapad/releases). The milestone
numbers (M0–M24) are the
[GitHub milestones](https://github.com/jbouder/datapad/milestones) the work
was planned under.

Datapad has no API version. The only format other software reads is the
export file (`datapad-YYYY-MM-DD.json`, [docs/data.md](docs/data.md#the-format)),
and every release imports every earlier one: old shapes are migrated on
the way in, never refused. The file carries its `format` number; one from
a newer release is refused with a message saying so. A release that
changes the format says so here under **Export format**.

## [Unreleased]

### Added

- `/` commands that make things, in the capture line and in the note
  composer: `/meeting`, `/milestone`, `/project`, `/person`, `/note`,
  `/task`, `/decide` and `/waiting`. The capture line opens a menu of them
  when a line starts with `/`. Each reads the line the way the capture line
  does (`#project`, `@Name`, a day, a meeting's time) and offers Undo.

- A **+** beside Rooms, in the rail and on the phone's Rooms page, adds a
  project or a person and opens the new room.
- All's rooms (the **Rooms** chip) has **New person** beside People, and
  search (⌘K) has **New person**. Each opens the new person's room.
- The **Rooms** heading in the rail opens the Rooms page.
- In the capture line, a `#word` no project is called offers
  **Create project “…”**. It creates the project in your default org and
  files the line under it.
- Today lists your open high-priority tasks under **High priority**,
  below Due. A task that is already due or late shows once, under Due.
  MCP's `get_today` returns the same list.
- Settings → Capture → **New tasks are due** sets the due date a new
  task gets when you give none: No date, Tomorrow, In 3 days, In a week
  or In 2 weeks. Every way of adding a task uses it, MCP's `add_task`
  included (`due: "none"` still adds one with no date).
- **Hide from rail** in a project room's menu keeps an active project
  off the rail's list. Hiding also unpins it. Settings → Rooms lists the
  hidden projects, each with **Show**; pinning one shows it again.
- **Move to…** in a note's menu moves a project note to another project,
  or out of any project, with Undo. A meeting's or a task's note stays
  where it is.
- On desktop, **Back** and **Forward** arrows sit at the left of the top
  bar. They walk this tab's history in Datapad, and each is disabled
  when there is nowhere to go. Phones keep their own gestures.

### Changed

- New tasks are due a week from today by default. Pick No date in
  Settings → Capture to go back to undated tasks.

- Staging is now a lasting environment. The `staging` branch deploys it
  after CI passes, so a change can be tried there before it reaches
  production from `main` ([docs/self-hosting.md](docs/self-hosting.md#staging)).

### Export format

- Settings may carry `defaultDueDays` (0 to 365). Absent reads as 7, so
  older files import unchanged.
- Settings may carry `hiddenRooms`, the ids of the projects hidden from
  the rail. Absent hides none, so older files import unchanged.

## [2.0.0] — 2026-11-17

Datapad v2 (M24) rebuilds the app around four places and one input.
**Today** is the home page: the day as a timeline with the open loops
beside it. **Rooms** are a page for each project and each person, and a
meeting opens in meeting mode. **All** is every item of every kind in
one list. **Scratch** holds the notes with no home yet. The capture
line on Today and in every room takes notes, tasks, things to decide
and waiting-ons. The type-by-type pages (Focus, Projects, Tasks, Notes,
Meetings, Lists, the Notepad and the Weekly digest) are gone, and every
old address lands on its new home. The export format goes to 3 and the
Durable Object's schema to 5. Nothing is deleted: lists become
checklist notes and retired settings are kept as stored.

### Added

- **Today** (#331), the home page at `/`: one day at a time. The header
  has the long day, a line that counts it ("2 meetings, 3 due, 4 waiting
  on others, 1 to decide") and Previous day, Today and Next day at the
  right. Then the capture line, a **Next up** card with Enter meeting
  while a meeting is ahead, what is due (and late, on today) and the
  **Timeline**: the day's meetings as anchors, untimed ones first, and
  the tasks added and done and the notes written that day at their
  times, with a Now line on today and the meetings that are over dimmed.
  Beside it on desktop and below it on phones: the Scratch card and the
  three lanes of open loops. **Mine** is yours or no one's, **Waiting
  on** is blocked on someone (or no one listed) or assigned to someone
  else, grouped by person, and **To decide** is every task marked to
  decide. A loop's checkbox closes it at once, with Undo. On a phone the
  day line stays on one line, the capture line runs full width with its
  expand button inside it, and the recap's line is held on every day, so
  the header keeps its height as you step between days.
- Today's **week zoom**, **recap** and **Brief me** (#332). **Day** and
  **Week** switch the zoom (`v` cycles). Week shows Monday to Sunday,
  seven columns on desktop and seven rows on phones, each day with its
  meetings and its counts of due, done and notes; a day's name opens it,
  and Previous and Next step a week. Under the days is the week's
  digest with Copy as Markdown, Save as note and Summarize. It replaces
  the Weekly digest page, and `/digest` lands on it. Stepping back to
  the last working day shows the recap (Since yesterday) above its
  timeline, and today's line links to it. Brief me is on today, and its
  brief includes the three lanes.
- **The capture line** (#330): one input at the top of Today and of each
  room. Type anything and chips say what it will become and where it
  goes. A plain line is a note; `[ ]`, `todo` or a date makes a task;
  `?` or `decide:` something to decide; `waiting on @Name` a task
  blocked on them. `#project` files it, `@Name` mentions someone (and
  assigns a task to them), and `@` and `#` open a menu, where a new name
  can be added to People. Enter saves with Undo, Esc clears, Tab or the
  kind chip changes the kind, and Shift+Enter or the expand button opens
  the full note composer. `n` goes to it.
- **Scratch** (#333) replaces the Notepad: one running pad of the notes
  with no home, newest first, at `/scratch`. Write at the top and
  ⌘Enter, or Add block, makes a note. Each block shows when it was
  written and has **File to…** (a project picker; the note moves, same
  id and time, with Undo), **Make task** and **To decide** (a task
  titled from its first line, pointing back at it; the block stays),
  Edit in place and Delete with Undo. Checklists tick in place, so old
  lists work here. Adding a mention files a block too. It was called
  Unfiled on the v2 staging deploy: `/unfiled` lands on `/scratch`, and
  MCP's `list_unfiled` still answers.
- **The v2 shell** (#329): the rail has Today, Scratch (with its count)
  and All, then Rooms: the rooms you pin, or the active projects until
  you pin one, then the people who owe you something. **Pin** in a
  project's or a person's header puts it in the rail; Settings → Rooms
  orders and unpins them.
- **Rooms on phones**: the tab bar has Today, Scratch, Rooms and All.
  The Rooms tab (`/rooms`) lists what the desktop rail does: the pinned
  rooms (or the active projects before anything is pinned) with their
  open counts, then the people you are waiting on, and links to All to
  find and pin the rest. The tab stays lit inside a room. With nothing
  to list it points to All.
- **The project room** (#334) replaces the project page. The header has
  the org, the name and a state line (health, status when not active,
  target date, next milestone, how many loops are open), with Pin,
  Schedule meeting, Edit and a menu with Summarize, Pause, Mark active
  or Mark done, Move to…, Save as template, Archive and Delete. Under
  it: the people to narrow the room to, the **Next meeting** card with
  Enter meeting, and three tabs. **Stream** has the three lanes beside
  one stream of everything attached (Coming up first, then notes, tasks
  added and done, meetings and milestones, newest first, older ones
  with Show older), with the capture line on top. Notes are open and
  their checkboxes tick in place. **Plan** (`/projects/:id/plan`) has
  the description, details and health, the timeline bar, milestones,
  members, links and Activity. **Whiteboard**
  (`/projects/:id/whiteboard`) is the project's board in the room.
  Picking a person narrows the lanes and the stream to what touches them
  (`?person=`); capture then mentions them, or on a task assigns them,
  and Pin pins the pair.
- **The person room** (#335) replaces the person page at `/people/:id`,
  and is the 1:1 prep. The header has the orgs of their projects, the
  name and a state line (role, how many projects, how many loops are
  open), with Pin, Schedule meeting, Edit and Remove. Under it: their
  projects to narrow the room to, the **Next meeting** card, then three
  lanes beside one stream. **You owe** is your open tasks that touch
  them. **They owe you** is what waits on them (assigned to them or
  blocked on them), then anything else of theirs that waits on someone.
  **To discuss** is the to-decide tasks that touch them and the open
  topics of their meetings ahead. The stream has the notes that mention
  them, the tasks that touch them and the meetings they attend, newest
  first. Capture there mentions them on a note and assigns them a task.
  Picking a project narrows the lanes and the stream to the same items
  as the project room narrowed to them (`?project=`); capture then files
  to the project too, and Pin pins the same pair the project room does.
  Meeting mode's 1:1 column shows the same lanes. Settings → People
  still lists, adds and removes people, and each row opens the room.
- **Meeting mode** (#336) replaces the meeting page. A meeting opens full
  screen: the phase (Prep, Live or Debrief), the day, time, room and
  attendees (each a link to their room), Join, Previous and Next in the
  series, Edit and Leave. The agenda and topics are on the left, with
  Carry forward from the last meeting of the series. The note composer
  is always open in the middle, with the saved notes and the action
  items under it. The open loops are on the right: the other person's
  for a 1:1, otherwise the project's. Leave, or Esc, goes back to where
  you came from, or to Today. `/task` in a meeting's note, and Make
  task on one, make an action item of that meeting.
- **All** (#337): every task, note, meeting, project and person in one
  list. Kind chips pick some kinds (none is every kind). Find, then the
  filters that fit the kinds picked: Room, Person, Status (Open, Done or
  past, Archived, All), Due, Tag, and To decide or Waiting on. Tasks or
  projects alone sort as their pages did; several kinds sort together by
  Recently updated, Title or Date. Everything stays in the address. The
  space's whiteboard is linked from the header. It replaces the Tasks,
  Notes, Meetings, Projects and Archived pages, whose addresses land on
  it with their filters.
- **Rooms on All**: a Rooms chip sits beside the kind chips. It shows
  every project room under its org and every person, each with Pin, in
  place of the item list (`/all?show=rooms`), with **New project**.
  Picking a kind turns it off.
- **All's layouts, saved views and bulk actions** (#338). Tasks alone
  show as a list, a table or a board (by status or by priority), meetings
  as a list or a calendar, projects as a list, cards or a timeline. The
  layout is in the address, and each kind remembers the last one picked,
  also set in Settings → All. Save view names the kinds, filters, sort
  and layout shown as a chip above the list, synced with the space; each
  chip's menu renames it, pins it to the rail like a room, or deletes it
  with Undo. Every task row has a select box: the bar that appears
  completes or reopens, marks to decide, moves to a room, assigns, sets
  the due date or deletes, each as one change with Undo.
- **Summaries in rooms and meeting mode** (#339): Summarize in a project's
  or a person's room writes a sentence or two on where things stand, under
  the state line, from what the room shows (the state line, the lanes,
  what is coming up and the last 14 days of the stream). In meeting mode,
  Summarize (in More) writes a short recap from the notes, the covered
  topics and the action items. Both show in a card with Stop, Regenerate,
  Save as note and Dismiss. Save as note files to the room (a person's as
  a note that mentions them) or to the meeting. Everything still runs on
  the device. Summarize stays in the task panel.
- **Settings for v2** (#343). The sections follow the app: Appearance,
  Today, Rooms, Capture, All, then Templates, Summaries, Spaces, People,
  Orgs, Data, Connected apps and Account, each at its own address.
  Today sets who Mine means (with unassigned, or only what is assigned
  to you), how far Next up looks ahead, the day the week starts on (the
  week zoom and the recap's weekend follow it), Brief me on or off, the
  lanes shown and their order, and meeting mode's sections. Rooms keeps
  the pinned rooms and adds whether the people who owe you show in the
  rail, each room's lanes shown and their order, the tab a project room
  opens on from the rail, All and Search, and the person room's lane
  names, which the room shows. Capture sets what a plain line becomes,
  whether `@Name` assigns a task, the priority a new task starts with
  when you do not pick one (from the New task panel, `/task`, Make task,
  action items and MCP's `add_task`) and where a note typed in a room
  goes. All sets the kinds it opens on (Tasks to start with: the rail's
  All opens there), each kind's layout, the sort tasks and projects
  start with, and renames, reorders and deletes saved views. Appearance,
  Today, Rooms, Capture and All each have Reset to defaults, with Undo;
  All's keeps the saved views. Every default is in one place in
  `shared/`. What Focus saved is Today's, and the old Tasks, Meetings
  and Projects pages' saved layouts and sorts become All's (the Durable
  Object's schema goes to 5).
- Datapad v2's data model (#328): a task can be marked to decide
  (`setDecide`), and a note can be filed to another project or to
  General without being copied (`moveNote`), keeping its id and time.
  Lists retire into checklist notes and the Notepad becomes an ordinary
  General note. On first start after the upgrade, each space is
  migrated once (the Durable Object's schema goes to 4, then 5 with
  the settings above). Nothing is deleted: the lists are kept in the
  data.
- **MCP tools for v2** (#340). `get_today` reads Today: the day's line,
  its meetings, what is due, the next meeting, the three lanes and how
  many notes are in Scratch. `get_loops` reads the lanes, for a project
  or a person too. `list_scratch` lists Scratch. `get_room` reads a
  project's or a person's room: for a project, what `get_project` gives
  plus its state line, lanes and stream. `set_decide` marks a task to
  decide or decided, and `add_task` and `edit_task` take `decide`.
  `file_note` files a note to a project. Tasks now carry `decide` and
  notes `scratch` (and `unfiled`, its old name) in every tool's results.
- A note being written under a task, a meeting or a meeting row asks
  "Save this note?" (Discard or Save note) when you click away, and holds
  any link, Back or panel close until you answer, then goes on.
- A staging deploy: the `v2` branch deploys to its own Worker,
  `datapad-v2`, with its own data, backups and Access application, after
  CI passes. Production still deploys from `main` only. See
  docs/self-hosting.md § Staging.

### Changed

- Every old address lands on its new home: `/focus` on Today, `/digest`
  on Today's week zoom, `/notepad` and `/unfiled` on Scratch,
  `/projects`, `/tasks`, `/notes`, `/meetings` and `/archive` on All
  with that kind (filters kept), `/lists` on All's notes, `/tasks/:id`
  on the task's project with its panel open, and `/settings/people/:id`
  on the person's room. A task opens in its panel everywhere.
- Focus is gone, with its agenda strip, Attention and Follow-ups; Today
  replaces it, with Since yesterday and Brief me (#332). The rail's
  Waiting on counts what Today's Waiting on lane holds, so a task to
  decide no longer counts there, and a task blocked on you is yours.
- Adding without the + (#341): the capture line takes tasks and notes,
  ⌘K has New task, New note, New meeting and New project, **Add meeting**
  sits beside Today's timeline (on the day shown) and **New project**
  beside All's project rooms. On All filtered to a room, ⌘K's New task,
  New note and New meeting start in that room.
- `n` goes to the capture line where there is one (elsewhere it still
  opens the new-task panel). Shift+N and Shift+L are gone: write a note
  from the capture line or ⌘K.
- New list is gone from ⌘K and Shift+L, and the Lists, Notepad, Weekly
  digest and task pages are gone, as lists and the Notepad became notes.
  ⌘K no longer finds lists; it finds the checklist notes they became.
- Summarizing a single note is gone: rooms and meetings cover it.
- New tasks start at Medium priority instead of none.
- MCP's `get_focus` is now an alias of `get_today` and returns the same
  thing: the old Focus shape (due buckets, follow-ups, attention,
  agenda) is gone, and `assignee` is ignored. `add_note` with no
  project, meeting, task or mention lands in Scratch. `get_project` and
  `get_overview` no longer show lists. The server's `initialize`
  instructions describe loops, Scratch and rooms, and the tools'
  descriptions name All in place of the old pages.
- MCP's list tools (`list_lists`, `get_list`, `add_list`,
  `add_list_item`, `check_list_item`) are retired: each answers with an
  error pointing to checklist notes and changes nothing. They go in the
  next release. A connected app can no longer send the list ops; it can
  now send `setDecide` and `moveNote`.
- The phone's tab bar is opaque, so its labels keep their contrast over
  whatever scrolls under it.
- Help describes v2 only, with a new **How Datapad works** section on
  Today, Rooms, All, Scratch and the capture line. Its Layouts table
  lists only All's kinds and People. The docs and the README, with new
  screenshots, describe v2 only.
- An installed app starts at `/` (Today); one installed before still
  starts at `/focus`, which lands there too.
- All loads on demand, like Settings and Help, and is fetched once the
  browser is idle. The entry script is 388.4 KB gzipped, down from
  407.3 KB.
- The components in `src/components/ui` now come from the
  [Beskar](https://github.com/jbouder/beskar) registry in place of stock
  shadcn. Nothing looks different. Combobox buttons gain accessible names,
  and calendar days are named with the full date ("Sunday, November 1,
  2026").

### Removed

- The project page and its sections, with Show done, Show past, the
  tasks board and the Lists section; Settings no longer lists
  them. Their saved settings are kept and ignored. Dragging tasks into
  order went with it: the room's lanes sort by due date, as Today's do.
- Settings → Navigation. Pinned rooms are the only navigation setting.
  Saved navigation preferences are kept and ignored, and an export that
  has them still imports.
- Settings → Pages (#343). Its options moved to Today, Rooms, Capture and
  All, and `/settings/pages` opens Settings → Today. The task page's
  and Lists' settings are no longer shown; what they saved is
  kept.
- The top bar's + menu (#341). See Changed for where adding went.
- What the classic pages left behind (#341): the tasks list and timeline
  layouts (All shows tasks as a list, table or board), dragging a task's
  due date on a timeline, the notes grid, the list panel, and Move up,
  Move down and Move to top on a task. An older client's `reorderTasks`
  still applies, and the export still carries what the retired pages
  saved.

### Fixed

- After a save in the task panel moves a task to another lane (Today's
  or a room's), focus goes to the task in its new lane instead of being
  lost.
- The destructive buttons (Remove, Delete) reach 4.5:1 contrast in the
  Light theme; their red label on its red tint was about 4:1.

### Export format

- The format is now 3 (#328). Tasks may carry `decide: true`, absent
  reading as false. A format 1 or 2 file (or one without `format`) is
  migrated on import: open tasks tagged `decide` get `decide: true`
  (the tag is kept), each list becomes a note on its project under the
  list's id (`## <title>`, then a `- [ ]` or `- [x]` line per item, the
  list's `createdAt`, its `updatedAt` as `editedAt`), and the Notepad's
  `scratch` is cleared. `lists` is still written and read; a format 3
  file's lists are not migrated again. A Datapad that reads up to 2
  refuses a format 3 file.
- The rest is additive within format 3:
  - `settings.user` may carry `pinned` (#329): the pinned rooms in
    order, each a project id, a person id or `<projectId>+<personId>`,
    each once, at most 50. Absent until something is pinned. A pinned
    room may also be `view:<id>`, a saved view of All.
    `settings.user.nav` is kept as it was and no longer read.
  - `settings.user.pages` may carry the page key `all` (#338), with the
    settings `taskView`, `meetingView` and `projectView` under `filters`
    and `views`, a list of `{ id, name, query }` saved views.
  - `settings.user` may carry `captureAs`, `mentionAssigns`, `roomNotes`,
    `railOwed`, `roomTab` and `laneLabels` (#343), each absent at its
    default. `settings.user.pages.focus` may carry `weekStart` and
    `brief`, and `settings.user.pages.all` `kinds`, `taskSort` and
    `projectSort`, under `filters`. An older file whose space saved
    nothing for All has its old Tasks, Meetings and Projects layouts and
    sorts carried into All on import; the old entries are kept.
  - `settings.user` may carry `defaultPriority` (`none`, `low`, `med` or
    `high`). Absent reads as `med`.

## [1.0.0] — 2026-11-06

The first stable release. Page settings: Focus, the project, task,
meeting and list pages can hide and reorder their sections and keep
their own options in Settings → Pages. The project page gets Show done
in place of its Done group; People and Orgs become sections in the rail
and Settings → Navigation. The export format is still 2, with additive
page settings; the Durable Object's schema is still version 3.

### Added

- **Page settings, the groundwork** (#310): saved page preferences can
  now hide a page's sections, put them in your own order, and hold
  settings that never go in the address. Settings → Pages gets a Show
  switch and Move up / Move down for each section of a page that has
  them, with Reset and Undo; at least one section stays shown. Focus and
  the project, task, meeting and list pages adopt it next. Settings →
  Pages lists a page only once it has something to set.
- **Focus settings** (#311): in Settings → Pages, hide Focus's sections
  (Since yesterday, Agenda, Waiting on, Attention, Follow-ups, Due) and
  put them in your own order. **Tasks for: Mine** (also a switch in
  Focus's header, and `?who=mine`) narrows Due, Waiting on, Follow-ups
  and Since yesterday to your tasks. **Group Due by: Date** shows Overdue,
  Today and Upcoming. Attention's rules (target within 7, 14 or 30 days;
  quiet after 7, 14 or 30 days, or off; yellow health in or out) and how
  far back Follow-ups looks (7 or 14 days) are yours to set. Brief me
  and the MCP tools `get_focus` and `get_recap` follow the same settings;
  a hidden section still feeds Brief me.
- **Project and task page settings** (#312): Settings → Pages hides and
  reorders the project page's sections (on desktop each keeps its
  column). The task page's source note can be expanded, collapsed or
  hidden (a link to it stays in the details), and its Notes section
  opens and closes and is remembered. The panels are unchanged.
- **Meeting and list page settings** (#313): in Settings → Pages, the
  meeting page can hide and reorder Topics, Action items, Notes and
  Series, and hide covered topics and done action items, with one line
  in their place when every one is hidden. The list page shows its done
  items collapsed under Done (n), as before, expanded, or hidden with
  "n done" in their place. The meeting panel shows everything, as
  before.

### Export format

- `settings.user.pages` may carry `hidden` and `order` (lists of section
  keys) on any page, and the page keys `task`, `meeting` and `list`
  (#310). Additive: older files import unchanged.

### Changed

- **Show done on the project page** (#318): the Done group inside Tasks
  is gone. A Show done toggle in the Tasks header lists the done tasks
  after the open ones, in the same list, and shows the board's Done
  column. It is remembered with the project page and is also in
  Settings → Pages. The Tasks count is still the open count.
- **Show past on the project page** (#320): the Past group inside
  Meetings is gone. A Show past toggle in the Meetings header lists the
  past meetings after the upcoming ones, in the same list, by month,
  newest first. It is remembered with the project page and is also in
  Settings → Pages, where it replaces Meetings shows; a saved Meetings
  shows reads as Hide. The Meetings count is still the upcoming count.
- **People and Orgs are sections**: in the rail after Lists, and in
  Settings → Navigation like the rest (Show, Phone, order). Off the
  phone's tab bar by default. Still Settings sections at the same
  addresses.
- **Refresh moved to Settings → Account** (and stays in ⌘K); the account
  menu no longer has it.
- **Pages in the phone's account menu**: the shown sections and tools the
  tab bar leaves out (Lists, People, Orgs and the tools, by default) sit
  in their own Pages group.

### Removed

- **The bundle budget check** (`scripts/budget.ts`, `npm run budget`):
  CI no longer fails on the entry's gzip size, nor checks that WebLLM
  stays out of the entry.

### Fixed

- **Rows no longer slide on their own**: Focus's rows (and other lists
  that slide when they reorder) jumped and slid back when the live data
  arrived after loading, or after a section was toggled while scrolled.
  Their positions are now measured inside the list, so scrolling and the
  page's entrance no longer read as a move.

## [0.4.0] — 2026-11-05

Lists: titled checklists on a project or in General, with their own
pages, quick add, search, a section on the project page, Make task from
an item, and MCP tools to read and add to them. The export format is now
2 and may carry `lists`; older Datapads refuse a format 2 file rather
than drop its lists. The Durable Object's schema is still version 3.

### Added

- **Lists, the data** (#298): a new collection for titled checklists of
  one-line items, each done or not, in an order you choose, on a project
  or in General. Adding and deleting a list log a line in its project's
  activity (or General's); renaming it and every item change do not.
  Deleting a project deletes its lists, and moving one to another space
  takes them along. Nothing in the app shows lists yet; the page, quick
  add, search and the project page follow (#299 to #301).
- **Lists pages** (#299): a Lists section in the rail after Notes, with
  `/lists` (Cards or Table; Find, Project, Show and Sort, saved per space)
  and a page for each list at `/lists/<id>`. New list asks for a title
  and a project and opens the new list. On a list's page, add items,
  tick them off (done ones fold under Done (n)), edit them in place,
  reorder them by dragging, Alt+↑ / Alt+↓ or the item's menu, and delete
  them with Undo; Edit renames or moves the list, and More → Delete asks
  first and offers Undo. Settings → Navigation can hide Lists. It is off
  the phone's tab bar by default, so the tab bar does not change; the
  account menu has it on a phone, as it now has any shown section the
  tab bar leaves out.
- **Lists from anywhere** (#300): New list joins the top bar's + (hidden
  until shown in Settings → Navigation, so + does not change), ⌘K has
  New list, and Shift+L opens the new-list panel (on a list's page, it
  opens Add an item). Hiding the Lists section takes New list out of +
  and ⌘K too. ⌘K and the MCP `search` tool find lists by their title
  and by any item's text; a hit on an item shows that item.
- **Lists on the project page; Make task from an item** (#301): a Lists
  section on the right under Notes, with Add list and a row per
  list (progress and its next open item; done lists last and muted),
  collapsible and remembered. An item's menu has Make task, which opens
  the new-task panel with the item's text and the list's project; the
  toast offers Open, and the item stays as it was.
- **MCP list tools** (#302): `list_lists` and `get_list` read lists (by
  project, in progress or done, or text; one by id or title with its
  items in order). With the write scope, `add_list`, `add_list_item` and
  `check_list_item` add a list, add an item and check one off. Nothing
  renames, reorders or deletes a list from MCP. `get_project` shows the
  project's lists with their progress, and `get_overview` counts lists in
  progress (`counts.listsInProgress`).

### Export format

- **Format 2** (#298): exports and backups now write `"format": 2` and may
  carry `lists`, a map by id of `{ id, projectId, title, items,
  createdAt, updatedAt }`, each item `{ id, text, done, createdAt, doneAt
  }`. A Datapad that reads format 1 drops keys it does not know, so it
  would import such a file and lose its lists without a word; with the
  bump it refuses the file and says to update instead. Every format 1
  file, and every legacy one, imports unchanged, with no lists. The
  Durable Object's schema is still version 3: lists are stored like every
  other document.

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

[Unreleased]: https://github.com/jbouder/datapad/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/jbouder/datapad/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/jbouder/datapad/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/jbouder/datapad/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jbouder/datapad/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jbouder/datapad/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jbouder/datapad/releases/tag/v0.1.0
