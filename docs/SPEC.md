# Datapad — functional spec for rebuild

As of 2026-10-23. Reference implementation: `datapad-reference.html` (single-file artifact, vanilla JS). Where this spec and the source disagree, the source wins.

## Purpose and scope

Datapad is a single-user project tracker for an engineering leader who runs several concurrent projects and client engagements. It is one place to see across projects, plan the week, drill into one project, and search everything.

What it is:
- Projects with metadata, an org/client, team members, and a one-line "current state"
- Tasks that are open or done, inside a project or in a General bucket
- Notes (markdown, @mentions) on projects, events, or General
- Events (meetings, milestones, deadlines) with prep and debrief notes
- A people list used for assignment, membership, and mentions
- Cross-project views: Focus, Tasks, Notes, Events, People, Search
- Claude-generated summaries of any item

What it is not: multi-user collaboration, recurring tasks, subtasks, time tracking, notifications, or calendar sync. Those were deliberately deferred (see Known gaps).

## Data model

Six collections, each a flat map of id → document. Ids are client-generated random strings; timestamps are ISO 8601; dates are `YYYY-MM-DD`; times are `HH:MM` 24-hour local.

### Project

| Field                | Type                               | Notes                                                           |
| -------------------- | ---------------------------------- | --------------------------------------------------------------- |
| id                   | string                             |                                                                 |
| name                 | string                             | required                                                        |
| org                  | string                             | client or org; free text with autocomplete from existing values |
| status               | `active` \| `paused` \| `done`     |                                                                 |
| priority             | `none` \| `low` \| `med` \| `high` |                                                                 |
| startDate            | date or empty                      | optional; not after targetDate; timeline falls back to created  |
| targetDate           | date or empty                      |                                                                 |
| tags                 | string[]                           |                                                                 |
| desc                 | string                             | markdown                                                        |
| state                | string                             | the one-line "current state" shown on the card                  |
| members              | personId[]                         |                                                                 |
| links                | Link[]                             |                                                                 |
| archived             | boolean                            | archived projects leave default views but stay searchable       |
| createdAt, updatedAt | timestamp                          | updatedAt also bumps on task, note, and event changes           |

### Task

| Field                             | Type                               | Notes                                        |
| --------------------------------- | ---------------------------------- | -------------------------------------------- |
| id                                | string                             |                                              |
| title                             | string                             | required; the only field needed to create    |
| projectId                         | string or null                     | null = General                               |
| status                            | `open` \| `done`                   | two states only, by design                   |
| priority                          | `none` \| `low` \| `med` \| `high` |                                              |
| due                               | date or empty                      |                                              |
| desc                              | string                             | markdown with mentions                       |
| tags                              | string[]                           |                                              |
| assignee                          | personId or empty                  | single assignee                              |
| links                             | Link[]                             |                                              |
| order                             | number                             | manual position among a project's open tasks |
| sourceNoteId                      | string, optional                   | set when created from a note                 |
| createdAt, updatedAt, completedAt | timestamp                          | completedAt null while open                  |

### Note

| Field     | Type                    | Notes                                      |
| --------- | ----------------------- | ------------------------------------------ |
| id        | string                  |                                            |
| projectId | string or null          | null = General                             |
| body      | string                  | markdown; mentions stored as `@{personId}` |
| pinned    | boolean                 | pinned notes sort first within a project   |
| eventId   | string or null          | links the note to an event                 |
| phase     | `pre` \| `post` \| null | prep or debrief note for that event        |
| createdAt | timestamp               |                                            |
| editedAt  | timestamp, optional     |                                            |

### Event

| Field                | Type                                                        | Notes                            |
| -------------------- | ----------------------------------------------------------- | -------------------------------- |
| id                   | string                                                      |                                  |
| projectId            | string or null                                              | null = General                   |
| title                | string                                                      | required                         |
| type                 | `meeting` \| `milestone` \| `deadline` \| `demo` \| `other` |                                  |
| date                 | date                                                        | required                         |
| time, end            | time or empty                                               |                                  |
| attendees            | personId[]                                                  |                                  |
| link                 | string                                                      | URL                              |
| note                 | string                                                      | short agenda/context, plain text |
| createdAt, updatedAt | timestamp                                                   |                                  |

### Person

| Field | Type    | Notes                                                 |
| ----- | ------- | ----------------------------------------------------- |
| id    | string  |                                                       |
| name  | string  | required; mention matching is by name                 |
| role  | string  |                                                       |
| me    | boolean | at most one person is `me`; enables the "Mine" filter |

### Activity

One document per project, keyed by projectId, plus one keyed `general`.

| Field  | Type                             | Notes                       |
| ------ | -------------------------------- | --------------------------- |
| events | `{t: timestamp, text: string}[]` | newest first, capped at 150 |

### Link (embedded in projects and tasks)

`{type: string, url: string, label: string}`. `type` is free text with suggestions `link`, `meeting`, `issue`, `doc`, `pr`. This is the extension point for attaching external systems later.

### Relationships

task → project (optional), task → assignee, task → source note; note → project (optional), note → event (optional); event → project (optional), event → attendees; project → members. Deleting a project deletes its tasks, notes, and activity. Deleting an event keeps its notes. Deleting a person leaves mentions rendering as "@unknown".

## Views

Routing is by hash: `#focus` (default), `#projects`, `#archive`, `#tasks`, `#notes`, `#events`, `#people`, `#project-<id>`. Desktop has a left rail (nav with counts, active project list, Archived if any, Export/Import and sync status). Mobile hides the rail and shows a bottom tab bar: Focus, Projects, Tasks, Notes, Events, People. A top bar carries the current title, a search button, a + button that opens the new-task panel preset to the current project, and a Write a note button that opens the new-note panel, preset the same way.

| View           | Shows                                                                                                                                                                                                                                                                                                                                          | Controls                                                                                                                                       | Empty state                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Focus          | Open tasks across all projects bucketed Overdue / Today / This week, with Later and No date collapsed; an Agenda strip of events in the next 7 days (excluding archived projects)                                                                                                                                                              | Quick-add with project picker; assignee filter (Anyone / Mine / Unassigned / each person)                                                      | "Nothing open. Add a task above or open a project."       |
| Projects       | Card grid: org, status pill, priority dot, name (serif), current state (italic serif), open count, target date, next milestone or deadline, member initials                                                                                                                                                                                    | Status segment (Active / Paused / Done / All, default Active); org dropdown; sort (Recently updated, Priority, Name, Target date); New project | Distinguishes "no projects yet" from "none match filters" |
| Archived       | Same cards for archived projects                                                                                                                                                                                                                                                                                                               | none                                                                                                                                           | "Nothing archived."                                       |
| Project detail | Header: org, name, status, priority, target, members, tags, links, Summarize / Edit / Archive; description (markdown); current-state input. Two columns: left = Tasks (quick-add, open list with drag reorder, Done collapsed) then Events (upcoming, Past collapsed); right = Notes (composer + list, pinned first) then Activity (collapsed) | All inline                                                                                                                                     | Per section                                               |
| Tasks          | Every task                                                                                                                                                                                                                                                                                                                                     | Quick-add with project picker; Open / Done / All; group by Project, Due date, or Assignee; assignee filter                                     | "No tasks here."                                          |
| Notes          | Every note grouped by day, newest first, each linking to its project or General                                                                                                                                                                                                                                                                | Composer with project picker (defaults General); project filter; Pinned toggle; text filter                                                    | Distinguishes none vs. no match                           |
| Events         | Upcoming events grouped by month, Past collapsed; each row shows project, type, date/time, attendees, link, prep/debrief actions, Summarize, linked notes inline                                                                                                                                                                               | Add event (with project picker); project filter; type segment                                                                                  | Distinguishes none vs. no match                           |
| People         | List (name, role, "you" tag) and a detail pane: projects they're on, open tasks assigned, every note and task that mentions them                                                                                                                                                                                                               | Add / Edit / Remove person; "This is me" checkbox                                                                                              | Prompts to add team members                               |
| Search         | ⌘K palette: Projects (recent when query empty), Tasks, Notes, Events, People; arrow keys and Enter                                                                                                                                                                                                                                             | Opens the item: project page, task panel, notes page, events page, or person                                                                   | "Nothing matches."                                        |

Task row (shared by Focus, Tasks, project detail, People): drag handle (desktop, project detail only), circular checkbox, priority dot, title (click opens panel), project chip (hidden on mobile and when grouped by project), assignee initials, due date colored red when overdue and amber when today. Done rows strike through.

Project card ordering by priority uses high → med → low → none, then name. "Recently updated" uses `updatedAt`, which bumps when tasks, notes, or events in the project change.

## Interactions

The common path never opens a modal: Enter adds, a checkbox closes, click drills in, Escape backs out.

**Quick add.** A single input with a + glyph. Enter creates a task with just a title and refocuses the input. On Focus and Tasks the input has a project picker (default General); on a project page it is bound to that project. If the assignee filter is set to Mine or a person, the new task is assigned to them. New open tasks get `order` = max order in that project + 1.

**Close / reopen.** Clicking the circle toggles `status`, sets or clears `completedAt`, logs activity, and bumps the project's `updatedAt`. No confirmation.

**Task panel** (slide-over from the right, 460px, full width on mobile): title, project, status, priority, due, assignee, tags (comma separated), details (markdown textarea with @mention autocomplete), links editor, created/closed timestamps. Footer: Summarize, Delete (confirm), Cancel, Save. Moving a task between projects logs an entry in both projects' activity. The panel renders once on open and is not re-rendered by data updates, so in-progress edits survive background sync.

**New task panel** (the + button, or when no quick-add is visible): title, project, priority, due, assignee, details.

**New note panel** (the top bar's Write a note button, Shift+N, or New note in ⌘K): the note composer and its project, preset to the current project or General. Adding closes it with a toast; closing with text asks first.

**Project form panel**: name, org (datalist of existing orgs), status, priority, target date, tags, team members (chip checkboxes from People), description, links. Create navigates to the new project. Delete confirms and removes tasks, notes, and activity; Archive is the non-destructive alternative in the header.

**Current state line.** A single input under the project header. Enter blurs; blur saves if changed and logs "Updated current state".

**Drag reorder.** HTML5 drag on open task rows in project detail. Dropping onto a row inserts before it and rewrites `order` as 1..n for the project's open tasks, writing only rows whose order changed. Desktop only.

**Notes composer.** One line until it has focus or text: the formatting buttons, project picker and Add note appear then, and go again when it is left empty. Textarea with @mention popup; ⌘/Ctrl+Enter adds. Enter inside a list line continues the list (`- `, `* `, `1. `, `- [ ] `; numbers increment; a checked box continues as unchecked); Enter on an empty list marker removes it.

**Make task from a note.** Selecting text inside a note body shows a floating "Make task" button above the selection; clicking creates a task titled with the first line of the selection (max 200 chars) in the note's project and records `sourceNoteId`. A footer button does the same, falling back to a prompt prefilled with the note's first line.

### Keyboard

| Key               | Action                                                        |
| ----------------- | ------------------------------------------------------------- |
| ⌘K or Ctrl+K, `/` | Open search                                                   |
| `n`               | Focus the nearest quick-add; opens the new-task panel if none |
| Shift+N           | Open the new-note panel                                       |
| Esc               | Close search, then panel                                      |
| ↑ ↓ Enter         | Navigate search results and mention popup                     |
| Tab / Enter       | Accept a mention suggestion                                   |
| ⌘/Ctrl+Enter      | Add note from composer                                        |

Single-letter shortcuts are suppressed while an input, textarea, or select has focus, or while a panel or the palette is open.

Panels and palette share a scrim; clicking it closes the panel. Toasts are bottom-center, 2.4 s, used for saves, copies, errors, and quota messages.

## Mentions and markdown

**Storage.** Mentions are stored in note bodies and task details as `@{personId}` tokens. The editor shows `@Name`. On save, every `@Name` that matches a person (longest names first, not followed by a word character) is converted to its token; on edit the reverse. Renaming a person therefore updates every mention. A token whose person no longer exists renders as `@unknown`.

**Autocomplete.** Typing `@` followed by up to 30 letters, digits, or spaces at the caret opens a popup under the textarea listing up to 8 people whose names start with the query (case-insensitive), with role in small text. Arrow keys move, Enter or Tab accepts and inserts `@Name ` (trailing space), Escape closes, blur closes after 120 ms so clicks register. Mentions are extracted with `/@\{([^}]+)\}/g` for the People view.

**Markdown subset.** Rendered in note bodies, event-linked notes, project descriptions, and Claude summaries. Parsing is line-based; everything is HTML-escaped first.

| Syntax                             | Renders                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `- item`, `* item`, `• item`       | bullet list                                            |
| `- [ ] item`, `- [x] item`         | checklist; checked items show ☑, struck through, muted |
| `1. item`, `1) item`               | numbered list                                          |
| `# heading` through `#### heading` | a single small heading style (h4)                      |
| blank line                         | paragraph gap                                          |
| `**bold**`                         | strong                                                 |
| `_italic_`, `*italic*`             | em (word-boundary guarded)                             |
| `` `code` ``                       | inline code                                            |
| bare `https://` URL                | link, new tab                                          |
| `@{id}`                            | mention chip                                           |

Not supported and not needed yet: nested lists, block quotes, fenced code, images, tables. Checklists are display-only; ticking happens by editing the note.

## Events and notes linkage

Every event row offers **Prep note** and **Debrief note**. Either one routes to a notes composer, prefilled, and tags the resulting note with `eventId` and `phase`.
1. If the current page has a composer (project detail or Notes page), it is prefilled in place: the textarea gets `data-event` and `data-phase`, the body is seeded with `Prep: <title> — <date>` or `Debrief: <title> — <date>` on its own line if empty, the project picker (when present) is set to the event's project, and the textarea is focused and scrolled into view.
2. If not (Events page, Focus agenda), the intent is parked as `ui.pendingEv = {id, phase}`, the app navigates to the event's project page (or the Notes page for General events), and the next render applies step 1.
3. On add, the note is written with `eventId`, `phase` (`pre` | `post` | null) and the composer is cleared by the re-render.

Display rules:
- Under each event row, linked notes render inline, grouped **Prep**, **Debrief**, then **Notes** (phase-less), oldest first, each with a timestamp and an Edit link. This appears on both the project page and the Events page.
- In the Notes page and project notes list, a linked note shows a tag `Prep · <event title>` or `Debrief · <event title>`.
- Claude summaries of an event include its linked notes labeled `[prep]` or `[debrief]`.
- Deleting an event keeps the notes; the tag disappears because the lookup fails.

Events are created from a project page (project fixed) or the Events page (project picker, General allowed). Required: title and date. Editing re-opens the same form; deleting asks for confirmation. Creating, editing, and deleting log activity on the event's project (or General).

## Claude summaries

A **Summarize** action exists on four item types: project (header), task (panel footer), event (row), note (footer). It is hidden when no model is available. In the artifact this uses the viewer's own Claude account through the platform's `sample` capability; in a standalone app it becomes a server-side call to the Messages API with the same prompt and context.

**Flow.** Click opens the side panel titled `Summary · <item>` showing "Thinking…", with Stop, Copy (disabled until text arrives), and Save as note. Output streams in and is rendered with the markdown subset. On completion Stop is disabled and Copy / Save enable. Closing the panel aborts the request. Errors: `not_granted` hides the feature for the session; `canceled` keeps partial text and appends "Stopped."; `rate_limited` shows a toast; anything else shows partial text or a one-line failure message.

**Save as note** writes a note to the item's project (or General) with body `Summary of <item>` followed by the markdown, converts any `@Name` back to mention tokens, links it to the event when summarizing an event, and logs activity.

**Context assembled per item** (plain text, labeled sections):

| Item    | Included                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project | name, org, status, priority, target date, team names, current state, description; open tasks with priority/due/assignee/details; last 15 done tasks; all events; last 20 notes newest first with prep/debrief labels; last 25 activity lines |
| Task    | title, project, status, priority, due, assignee, tags, details, link labels, source note body if any                                                                                                                                         |
| Event   | title, type, date and times, project, attendees, agenda note, all linked notes with phase                                                                                                                                                    |
| Note    | date, project, event title if linked, body                                                                                                                                                                                                   |

Mentions are expanded to names before sending. Nothing outside the item is included.

**Prompt** (single user turn; context appended after two newlines):

> You are summarizing one item from a personal project tracker used by an engineering leader. Write a concise summary in plain markdown using short paragraphs and "- " bullets (headings, if any, as "### "). Structure: a 1–3 sentence overview; then bullets for key points; then "Open items" and "Suggested next steps" when the data supports them. Be specific, keep names and dates, do not invent anything not in the data, and stay under 220 words.

Model tier is the default (not the quick tier); the artifact caches identical requests for five minutes.

## Persistence, sync, import/export

**Store shape.** In-memory state is `{projects, tasks, notes, people, activity, events}`, each a map by id. All views are pure renders of that state; the whole main region re-renders on every change (cheap at this scale; a rebuilt app should use a reactive store).

**Write path.** `write(col, id, doc)` applies optimistically to memory, re-renders, then persists; `remove(col, id)` likewise. Failures toast and the next snapshot corrects the view. Whole-document writes only.

**Backends.** The artifact subscribes to each of the six collections on a per-artifact realtime document store and treats a snapshot as the source of truth. When that store is unavailable it falls back to `localStorage` under `ledger:v1` with the same shape. On first sync, if local data exists and the remote store is empty, the user is offered a one-time migration. A rebuilt app should keep this split: one storage interface with a local adapter (offline, tests) and a remote adapter.

**Read-only.** If the platform reports the viewer cannot write, `readOnly` hides every mutating control (quick-adds, buttons, composers, drag) and shows a banner; Summarize remains available.

**Export** writes `{exportedAt, projects, tasks, notes, people, activity, events}` as pretty JSON named `ledger-YYYY-MM-DD.json` through a download, falling back to the clipboard. **Import** reads such a file, confirms, and merges by id (same id replaces). This JSON is also the migration path from the artifact to the new app.

**Caps to respect** when designing the remote store: documents under 256 KiB (activity logs are capped at 150 entries for this reason), collections scanned without indexes (keep to low thousands of documents), last-writer-wins with no transactions.

## Activity log

One log per project plus one for General. Entries are `{t, text}`, prepended, capped at 150; the project page shows the latest 40 in a collapsed Activity section, and project summaries read the latest 25.

| Trigger                        | Text                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Task created                   | Added task "<title>"                                                                             |
| Task closed / reopened         | Closed "<title>" / Reopened "<title>"                                                            |
| Task edited                    | Edited task "<title>"                                                                            |
| Task moved                     | Moved "<title>" to <project> (old project) and Moved "<title>" here from <project> (new project) |
| Task deleted                   | Deleted task "<title>"                                                                           |
| Note added / deleted           | Added a note / Deleted a note                                                                    |
| Summary saved                  | Saved a Claude summary as a note                                                                 |
| State line changed             | Updated current state                                                                            |
| Project created / edited       | Created project / Edited project details                                                         |
| Status changed                 | Status changed to <status>                                                                       |
| Archived / restored            | Archived project / Unarchived project                                                            |
| Event added / edited / deleted | Added <type> "<title>" / Edited … / Deleted event "<title>"                                      |

Pinning a note and reordering tasks are not logged. The log is the data source for the deferred weekly digest.

## Design system

Quiet, dense, cool-neutral. The one expressive element is the serif used for project names and the italic "current state" line; everything else is small, disciplined sans. No decorative shadows on cards, no gradients; borders carry structure.

**Type.** Instrument Sans (400/500/600, italic 400) for UI; Instrument Serif (regular and italic) for page titles, project names on cards, and the state line. Base 15px / 1.45. Page title 34px serif (28px mobile), card name 24px serif, state line 17px italic serif on cards and 22px in the project header. Fallbacks: system-ui and Georgia.

### Color tokens

| Token       | Light   | Dark    |
| ----------- | ------- | ------- |
| bg          | #EEF0F3 | #14161B |
| surface     | #FFFFFF | #1C1F26 |
| surface2    | #F6F7F9 | #23272F |
| line        | #D9DDE3 | #333843 |
| line2       | #E7EAEE | #2A2F38 |
| ink         | #171A20 | #E9EBEF |
| ink2        | #4A5160 | #AEB4C0 |
| ink3        | #8A92A0 | #737B89 |
| accent      | #2B45C9 | #93A4FF |
| accent-ink  | #FFFFFF | #0F1330 |
| accent-soft | #E6EAFB | #262C48 |
| danger      | #B42318 | #F08A80 |
| warn        | #B7791F | #E3B45A |
| ok          | #1E7A4A | #6FCB95 |

Dark mode follows the OS by default and can be forced by `data-theme` on the root. Radius 10px on cards and panels, 8px on controls, pills fully round. Priority dots: high = danger, med = warn, low = ink3, none = line. Status pills: active = accent-soft fill, paused = dashed border, done = ok tint. Event type pills: milestone = accent-soft, deadline = danger outline, demo = ok outline.

**Layout.** Desktop: 232px rail + fluid main, content max-width 1040px; project detail is a 3:2 two-column grid. Breakpoint 820px: rail hidden, bottom tab bar, single column, project chips and drag handles hidden, task rows at least 44px tall. Safe-area insets respected top and bottom. Reduced-motion disables transitions. Visible focus rings in accent.

**Copy.** Sentence case, plain verbs, buttons name the action ("Add task", "Create project", "Save as note"). Empty states tell the user what to do next. Typographic apostrophes and quotes in UI text.

## Rebuild recommendations

Keep the product exactly as specified above and change only the plumbing.

**Stack.** React + TypeScript + Vite, Tailwind v4, shadcn/Base UI for panels, selects, and the command palette (the ⌘K palette maps cleanly onto `cmdk`). Keep it a PWA-capable SPA so it still works on the phone.

### Modules

| Module        | Responsibility                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/`      | TypeScript types for the six entities and Link; zod schemas for import validation                                                                                                                                                        |
| `store/`      | One store (Zustand or similar) holding the six maps; actions mirror `write`/`remove`; selectors for open counts, orgs, meId, buckets                                                                                                     |
| `storage/`    | `StorageAdapter` interface: `load()`, `subscribe(col, cb)`, `set(col, id, doc)`, `delete(col, id)`; adapters: `local` (IndexedDB via idb-keyval or localStorage) and `remote` (Supabase/Postgres, Firestore, or a small API over SQLite) |
| `markdown/`   | the line-based renderer and the `@{id}` ↔ `@Name` conversions; unit-test against the table in Mentions and markdown                                                                                                                      |
| `summaries/`  | context builders per item type (pure functions over state) and a server route that calls the Messages API with the prompt above and streams back                                                                                         |
| `views/`      | Focus, Projects, ProjectDetail, Tasks, Notes, Events, People, Archive                                                                                                                                                                    |
| `components/` | TaskRow, QuickAdd, NoteCard, NoteComposer (mentions + list continuation), EventRow, SidePanel, Palette, Toast                                                                                                                            |

**Order of work.** 1) model + store + local adapter + JSON import so existing data loads on day one; 2) Projects, ProjectDetail, Tasks with quick-add and close; 3) Notes and mentions; 4) Events with prep/debrief; 5) Focus, People, Search; 6) remote adapter and summaries; 7) polish items from Known gaps.

**Migration.** Export from the artifact (sidebar footer), import into the new app. Ids, mention tokens, and `order` values carry over unchanged. Keep the `links[]` field even though nothing writes typed links yet; it is where meetings and issues from external systems will attach.

**Auth.** Single user today. If the remote adapter is multi-tenant, scope every collection by owner and keep `readOnly` as the behavior for anyone without write access.

## Known gaps and deferred features

Shortcomings of the artifact that a rebuild should fix:
- Drag reorder is mouse-only; add touch reordering or up/down controls.
- The whole view re-renders on every change; fine at this size, wrong for a real app.
- Mention matching is by name at save time, so a person must exist before the note is written.
- Checklists in notes are display-only.
- Export relies on a platform download hook; make it a plain file download.
- No undo for close, delete, or archive.

Features discussed and intentionally deferred, roughly by value:
1. Project health flag (green / yellow / red) separate from status, shown on cards and filterable.
2. Weekly digest view built from the activity logs: per project, tasks closed, notes added, state changes.
3. Blocked / waiting-on flag on tasks with an optional person, surfaced at the top of Focus.
4. Project templates: a saved kickoff checklist applied on project creation.
5. Reminders: in-app due reminders and an .ics export per task or event; true push notifications need a native or server component.
6. Snooze a task to a date; a per-project "next up" marker shown on the card.
7. Recurring tasks, subtasks, time tracking, and comments on tasks were considered and rejected for now.
