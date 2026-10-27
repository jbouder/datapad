# Datapad — functional spec for rebuild

As of 2026-10-23. Reference implementation: `datapad-reference.html` (single-file artifact, vanilla JS). Where this spec and the source disagree, the source wins.

## Purpose and scope

Datapad is a single-user project tracker for an engineering leader who runs several concurrent projects and client engagements. It is one place to see across projects, plan the week, drill into one project, and search everything.

What it is:
- Projects with metadata, an org/client and team members
- Tasks that are open or done, inside a project or in a General bucket
- Notes (markdown, @mentions) on projects, meetings, or General
- Meetings with their notes, and dated milestones on each project
- A people list used for assignment, membership, and mentions
- Cross-project views: Focus, Tasks, Notes, Meetings, People, Search
- Claude-generated summaries of any item

What it is not: multi-user collaboration, recurring tasks, subtasks, time tracking, notifications, or calendar sync. Those were deliberately deferred (see Known gaps).

## Data model

Six collections, each a flat map of id → document. Ids are client-generated random strings; timestamps are ISO 8601; dates are `YYYY-MM-DD`; times are `HH:MM` 24-hour local (stored that way; shown on a 12-hour clock by default, or 24-hour, per Settings → Appearance → Time, remembered per device). In the rebuild every collection lives inside a space, and each space holds a complete, separate set of them (see Spaces).

### Project

| Field                | Type                               | Notes                                                              |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| id                   | string                             |                                                                    |
| name                 | string                             | required                                                           |
| org                  | string                             | client or org; free text with autocomplete from existing values    |
| status               | `active` \| `paused` \| `done`     |                                                                    |
| priority             | `none` \| `low` \| `med` \| `high` |                                                                    |
| startDate            | date or empty                      | optional; not after targetDate; timeline falls back to created     |
| targetDate           | date or empty                      |                                                                    |
| tags                 | string[]                           |                                                                    |
| desc                 | string                             | markdown                                                           |
| state                | string                             | retired: the one-line "current state"; kept in data, shown nowhere |
| members              | personId[]                         |                                                                    |
| links                | Link[]                             |                                                                    |
| milestones           | Milestone[], optional              | by date then title, 50 at most; absent reads as none               |
| archived             | boolean                            | archived projects leave default views but stay searchable          |
| createdAt, updatedAt | timestamp                          | updatedAt also bumps on task, note, meeting and milestone changes  |

### Milestone (embedded in projects)

`{id: string, title: string, date: date}`: a dated marker on the project. A deadline is the project's `targetDate`, not a milestone.

### Task

| Field                             | Type                               | Notes                                         |
| --------------------------------- | ---------------------------------- | --------------------------------------------- |
| id                                | string                             |                                               |
| title                             | string                             | required; the only field needed to create     |
| projectId                         | string or null                     | null = General                                |
| status                            | `open` \| `done`                   | two states only, by design                    |
| priority                          | `none` \| `low` \| `med` \| `high` |                                               |
| due                               | date or empty                      |                                               |
| desc                              | string                             | markdown with mentions                        |
| tags                              | string[]                           |                                               |
| assignee                          | personId or empty                  | single assignee                               |
| links                             | Link[]                             |                                               |
| order                             | number                             | manual position among a project's open tasks  |
| sourceNoteId                      | string, optional                   | set when created from a note                  |
| meetingId                         | string or null, optional           | an action item of that meeting; absent = null |
| createdAt, updatedAt, completedAt | timestamp                          | completedAt null while open                   |

### Note

| Field     | Type                     | Notes                                                                                                                            |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| id        | string                   |                                                                                                                                  |
| projectId | string or null           | null = General                                                                                                                   |
| body      | string                   | markdown; mentions stored as `@{personId}`                                                                                       |
| pinned    | boolean                  | pinned notes sort first within a project                                                                                         |
| meetingId | string or null           | links the note to a meeting                                                                                                      |
| phase     | `pre` \| `post` \| null  | legacy (#163): kept and round-tripped, never set or shown since #167; new notes have null                                        |
| taskId    | string or null, optional | a running note on that task (never with `meetingId`); `projectId` is the task's. Absent on older notes and exports, read as null |
| createdAt | timestamp                |                                                                                                                                  |
| editedAt  | timestamp, optional      |                                                                                                                                  |

### Meeting

A dated meeting, in a project or General (the collection is `meetings`). Milestones are not meetings: they live on their project, and a deadline is the project's `targetDate`. Files from before meetings carry the old typed collection instead; import migrates them (see [data.md](data.md#the-format)).

| Field                | Type              | Notes                                             |
| -------------------- | ----------------- | ------------------------------------------------- |
| id                   | string            |                                                   |
| projectId            | string or null    | null = General                                    |
| title                | string            | required                                          |
| date                 | date              | required                                          |
| time, end            | time or empty     |                                                   |
| attendees            | personId[]        |                                                   |
| link                 | string            | URL                                               |
| note                 | string            | short agenda/context, plain text                  |
| topics               | Topic[], optional | in agenda order, 50 at most; absent reads as none |
| createdAt, updatedAt | timestamp         |                                                   |

### Topic (embedded in meetings)

`{id: string, title: string, done: boolean, outcome: string, carriedFrom?: date}`: one item on the meeting's agenda, whether it was covered, and a one-line outcome (300 characters at most; titles use the usual title limit). `done` defaults to false and `outcome` to empty; the two are independent, so recording an outcome does not tick the topic. `carriedFrom` is set only on a topic carried forward from an earlier meeting (see [Topics and carrying forward](#topics-and-carrying-forward)) and holds the day of the meeting it was **first** raised in, which it keeps as it rolls on. A topic is not searched on its own; its title counts toward its meeting's match.

Topic ops (each names its `meetingId`, and each bumps the meeting's and its project's `updatedAt`):

| Op              | Fields                                  | Behavior                                                                                                                                                  |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addTopic`      | `id`, `title`, `after?`, `carriedFrom?` | Appends, or inserts right after the topic `after`; refused for an unknown `after`, an id already there, or a meeting that has 50 topics                   |
| `editTopic`     | `id`, `patch: {title?, outcome?}`       | An empty patch is refused                                                                                                                                 |
| `toggleTopic`   | `id`, `done`                            | States the result, so repeating it changes nothing                                                                                                        |
| `reorderTopics` | `ids`                                   | Every topic id exactly once, in the new order; a list that omits, repeats or invents one is refused ("The topics changed; try again") and nothing changes |
| `deleteTopic`   | `id`                                    |                                                                                                                                                           |

Deleting a meeting takes its topics with it; they live on the document.

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

task → project (optional), task → assignee, task → source note; note → project (optional), note → meeting or task (optional, not both); meeting → project (optional), meeting → attendees; project → members, project → milestones (embedded). Deleting a project deletes its tasks, notes, milestones and activity; its meetings move to General. Deleting a meeting keeps its notes, and so does deleting a task. Moving a task to another project moves its notes with it. Deleting a person leaves mentions rendering as "@unknown".

## Views

Routing is by hash: `#focus` (default), `#projects`, `#archive`, `#tasks`, `#notes`, `#meetings`, `#people`, `#project-<id>`. Desktop has a left rail (nav with counts, active project list, Archived if any, Export/Import and sync status). Mobile hides the rail and shows a bottom tab bar: Focus, Projects, Tasks, Notes, Meetings, People. A top bar carries the current title, a search button, a + button that opens the new-task panel preset to the current project, and a Write a note button that opens the new-note panel, preset the same way. In the rebuild, routes are paths (`/`, `/projects/<id>`, `/meetings/<id>`, `/tasks`, `/tasks/<id>`, …) and People and Orgs are reference data under Settings: `/settings/people(/<id>)` and `/settings/orgs(/<id>)`, in neither the rail nor the tab bar (Focus, Projects, Tasks, Meetings, Notes); `/people(/<id>)` and `/orgs(/<id>)` redirect there (#159). In the rebuild the sync status sits in the top bar at every width, led by a dot colored by state (`ok` saved, `warn` connecting or saving, `destructive` offline) with its word beside it on desktop and in its accessible name on phones (shown on phones too when offline); the Weekly digest link is pinned at the foot of the rail (#187). See [Navigation preferences](#navigation-preferences).

| View           | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Controls                                                                                                                                                           | Empty state                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Focus          | Day (the default) or Week, from a switcher (`?view=`, remembered per browser, `v` cycles). Open tasks across all projects bucketed Overdue / Today / This week, with Later and No date collapsed (Day collapses This week too); an Agenda strip of meetings and milestones today (Day) or in the next 7 days (Week), by day with all-day items first, a meeting with topics showing its count (excluding archived projects)                                                                                    | Quick-add with project picker; assignee filter (Anyone / Mine / Unassigned / each person)                                                                          | "Nothing open. Add a task above or open a project."       |
| Projects       | Card grid: org, status pill, priority dot, name (serif), open count, target date, next milestone (nothing when none is ahead), member initials                                                                                                                                                                                                                                                                                                                                                                 | Status segment (Active / Paused / Done / All, default Active); org dropdown; sort (Recently updated, Priority, Name, Target date, Next milestone); Add project     | Distinguishes "no projects yet" from "none match filters" |
| Archived       | Same cards for archived projects                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | none                                                                                                                                                               | "Nothing archived."                                       |
| Project detail | Header: org, name, status, priority, target, members, tags, links, Summarize / Edit / Archive / Move to… / Save as template (with open tasks: a kickoff template from them); description (markdown). Two columns: left = Milestones (title and date to add; by date, past ones muted; edit in place; delete with Undo), then Tasks (quick-add, open list with drag reorder, Done collapsed), then Meetings (upcoming, Past collapsed); right = Notes (composer + list, pinned first) then Activity (collapsed) | All inline                                                                                                                                                         | Per section                                               |
| Tasks          | Every task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Add task (the new-task panel, assigned to the filtered person); a task opens its page; Open / Done / All; group by Project, Due date, or Assignee; assignee filter | "No tasks here."                                          |
| Notes          | Every note grouped by day, newest first, each linking to its project or General                                                                                                                                                                                                                                                                                                                                                                                                                                | Add note (the new-note panel, preset to the filtered project, else General; `N` too); project filter; Pinned toggle; text filter                                   | Distinguishes none vs. no match                           |
| Meetings       | Upcoming meetings grouped by month, Past collapsed; each row shows project, date/time, attendees, link, Add note, Summarize and its topic count ("2 of 4 topics"); the title opens the meeting's page                                                                                                                                                                                                                                                                                                          | Add meeting (with project picker); project filter                                                                                                                  | Distinguishes none vs. no match                           |
| People         | Settings → People in the rebuild. List (name, role, "you" tag) and a detail pane: projects they're on, open tasks assigned, every note and task that mentions them                                                                                                                                                                                                                                                                                                                                             | Add / Edit / Remove person; "This is me" checkbox                                                                                                                  | Prompts to add team members                               |
| Search         | ⌘K palette: Projects (recent when query empty), Tasks, Notes, Meetings, People; arrow keys and Enter                                                                                                                                                                                                                                                                                                                                                                                                           | Opens the item: project page, task panel, notes page, meeting page, or person                                                                                      | "Nothing matches."                                        |

Task row (shared by Focus, Tasks, project detail, People): drag handle (desktop, project detail only), circular checkbox, priority dot, title (click opens panel), a small note count when the task has running notes (it does not animate), project chip (hidden on mobile and when grouped by project), assignee initials, due date colored red when overdue and amber when today. Done rows strike through.

Project card ordering by priority uses high → med → low → none, then name. "Recently updated" uses `updatedAt`, which bumps when tasks, notes, meetings, or milestones in the project change.

## Interactions

The common path never opens a modal: Enter adds, a checkbox closes, click drills in, Escape backs out.

**Quick add.** A single input with a + glyph. Enter creates a task with just a title and refocuses the input. On Focus the input has a project picker (default General); on a project page it is bound to that project. If the assignee filter is set to Mine or a person, the new task is assigned to them. New open tasks get `order` = max order in that project + 1.

**Close / reopen.** Clicking the circle toggles `status`, sets or clears `completedAt`, logs activity, and bumps the project's `updatedAt`. No confirmation.

**Task panel** (slide-over from the right, 460px, full width on mobile): title, project, status, priority, due, assignee, tags (comma separated), details (markdown textarea with @mention autocomplete), a **Notes** section (its running notes; see [Task notes](#task-notes)), links editor, created/closed timestamps. Footer: Summarize, Delete (confirm), Cancel, Save. Moving a task between projects logs an entry in both projects' activity. The panel renders once on open and is not re-rendered by data updates, so in-progress edits survive background sync.

**New task panel** (the + button, Tasks' **Add task**, or `n` when no quick-add is visible): title, project, priority, due, assignee (preset on Tasks to the person the view is filtered to), details.

**New note panel** (the top bar's Write a note button, Shift+N, or New note in ⌘K): the note composer and its project, preset to the current project or General. Adding closes it with a toast; closing with text asks first.

**Project form panel**: name, org (datalist of existing orgs), status, priority, target date, tags, team members (chip checkboxes from People), description, links. Create navigates to the new project. Delete confirms (naming its milestones when it has any) and removes tasks, notes, milestones, and activity, moving its meetings to General; Archive is the non-destructive alternative in the header.

**Current state line (retired).** Projects used to carry a one-line "current state" under the header and on the card. It is no longer shown, edited, searched, summarized or in the digest; the field and the `setState` op remain so old data and old clients still load.

**Decisions (retired).** Datapad used to keep a decision log: a Decisions page, a Decisions section on each project page, **Record a decision** on a meeting topic, `/decision` in the note composer, and decisions on a person's page, in ⌘K search, in the weekly digest and in what Summarize sends. All of that is gone, and `/decisions` (and anything under it) lands on Focus. The `decisions` collection and its four ops (`addDecision`, `editDecision`, `setDecisionStatus`, `deleteDecision`) remain, so old data, exports and old clients' queued ops still load and round-trip.

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

**Markdown subset.** Rendered in note bodies, meeting-linked notes, project descriptions, and Claude summaries. Parsing is line-based; everything is HTML-escaped first.

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

## Task notes

Added in the rebuild (#164). Running notes on a task: dated entries such as "pinged legal, waiting on the redline", instead of rewriting the one **Details** field. They are ordinary notes with `taskId` set, so they also show on Notes and the project page, are found by ⌘K as notes, and go into summaries.
1. In the task panel, under Details, a **Notes** section lists the task's notes newest first, each rendered (Markdown, mentions, checkboxes) with its relative time, "edited" when it was, **Edit** (in place: the composer, Save note or ⌘Enter, Cancel or Esc) and **Delete** (with Undo). With none, it says "No notes yet".
2. **Add note** beside the heading opens the inline composer (`InlineNoteComposer`) after the list; pressing it again returns to the composer. **Save note** (or ⌘Enter) sends `addNote` with the task's `taskId` and closes the composer, leaving the panel open; **Cancel** or Esc closes the composer, not the panel. The draft is kept per task in sessionStorage until Save or Cancel.
3. `addNote` with `taskId` checks the task exists ("That task no longer exists"), takes the task's project (the op's `projectId` is ignored), refuses a `meetingId` alongside it ("A note goes on a meeting or a task, not both"), bumps the task's and the project's `updatedAt`, and logs `Added a note to "<task title>"`. The bump alone does not show the panel's "Updated elsewhere" line.
4. A note card with `taskId` shows a chip naming its task; it opens the task panel. When the task has been deleted the chip reads "Task deleted" and the note stays.
5. `moveTask` moves the task's notes to the new project in the same op; moving a project to another space carries them with it, `taskId` and all.

## Action items

Added in the rebuild (#185). A meeting's **action items** are real tasks linked to it (`Task.meetingId`), so they also show on Focus, Tasks, the project page and a person's page, and are found by ⌘K as tasks.
1. The meeting's page (under Topics, in the left column) and its panel (between Topics and Notes) each have an **Action items** section, in the same inline style as Topics and Notes: the heading, the open count ("2 open"; nothing once all are done; it does not animate) and **Add an action item**, which opens a one-line field (Enter adds one and keeps the field open for the next; Escape closes it and returns focus to the button). The list is the shared task row: open first, oldest first, then done (struck through), the most recently closed first. Its checkbox closes and reopens (with Undo), and the title opens the task's panel. With none and the field closed it reads "No action items yet".
2. A topic's **Make a task** opens the new-task panel with the topic's title, as an action item of the meeting: the panel says "An action item of <meeting>" in place of the project picker.
3. `addTask` with `meetingId` checks the meeting exists ("That meeting no longer exists"), takes the meeting's project (General for a General meeting; the op's `projectId` is ignored) and logs `Added action item "<title>" to "<meeting>"`. The meeting itself is not changed. `meetingId` is optional in the schema and the type, and is written only on tasks that have one, so exports from before it import unchanged.
4. A task with a meeting shows "From <meeting> · <day>" on its panel and its page, linking to the meeting's page. Moving the task to another project keeps the link.
5. Deleting a meeting keeps its action items as plain tasks: the same op sets their `meetingId` to null. The delete question says so ("Its 2 notes and 3 action items are kept.").
6. Moving a project to another space carries its tasks, action items among them; an action item keeps its meeting when the meeting goes too, and loses the link when it does not (in either space).
7. Summarize for a meeting lists its action items; for a task, the meeting it came from.

Carrying open action items forward to the next meeting in a series is out of scope.

## Meetings and notes linkage

Notes on a meeting are written on the meeting, never by going somewhere else, and work as a task's do ([Task notes](#task-notes)): one kind of note, added as needed (#167; the Prep / Debrief / Note split of #163 is gone from the UI).
1. Every meeting row offers **Add note** (beside the row on wide screens, and in its ⋯ menu everywhere, which is how a phone reaches it). It opens the inline composer (`InlineNoteComposer`, via `MeetingNoteComposer`) right under the row; the URL does not change. The composer is the notes editor (Markdown, `/` styles, `@` mentions, `/task`) and starts empty. One composer per meeting: Add note again focuses it. The draft is kept per meeting in sessionStorage until Save or Cancel.
2. **Save note** (or ⌘Enter) sends `addNote` with the meeting's `projectId` and `meetingId` (never a `phase`) and closes the composer; a toast confirms it (the row does not list notes; the meeting's page does). **Cancel** or Esc closes it and drops the draft.
3. On Focus, each agenda card's **Add note** opens the same composer under the strip (one at a time); saving confirms with a toast.
4. The meeting's page (see [Meeting page](#meeting-page)) and its panel (editing an existing meeting) each have a **Notes** section, the same component as the task panel's: **Add note** beside the heading, the meeting's notes newest first, each rendered with when it was written, **Edit** in place and **Delete** with Undo, and the composer after the list. Notes save on their own; they do not make the form dirty.
5. The composer opens with `@starting-style` (a panel, not a view transition), so the motion switches apply. On a phone it fits the width, with 44px targets.

Display rules:
- A meeting row shows no notes; its page lists them all, newest first.
- In the Notes page and project notes list, a linked note shows a chip naming its meeting, which goes to the meeting's page.
- A note's legacy `phase` (`pre` / `post`, from #163 or older imports) is kept, exported and imported unchanged, but never shown: those notes list with the rest.
- Claude summaries of a meeting include all its linked notes, each labeled `[note]`.
- Deleting a meeting keeps the notes; the chip disappears because the lookup fails.

Meetings are created from a project page (project fixed) or the Meetings page (project picker, General allowed). Required: title and date. Editing re-opens the same form; deleting asks for confirmation. Creating, editing, and deleting log activity on the meeting's project (or General).

### Meeting page

Each meeting has a page of its own at `/meetings/<id>`, as a project does, under Meetings in the nav and titled with the meeting's title. Everything that opens a meeting goes there: the title on a row (Meetings page, project page, a calendar day's popover), a calendar chip, a timeline point, an agenda card on Focus, ⌘K, a note's meeting chip and an org's meetings. `/meetings?meeting=<id>` and `/events?event=<id>`, the addresses that used to open the row, redirect to it.
- **Header**: the project (a link) or General; the title; **Summarize**, **Edit** (the meeting's panel), **Carry forward** (when it applies; see below) and **Delete** (asks in place, keeps the notes and the action items, then goes to Meetings); then the day and times, the attendees and the link; then the agenda note.
- **Body**: **Topics** and **Action items** on the left and **Notes** on the right (3:2 above 820px, one column below), the same sections as the meeting's panel.
- **Series**: at the foot, **Previous** and **Next** link to the neighbouring meetings of its series, by day.
- An unknown id shows Not found with Back to Meetings.

### Task page

A task opened from the Tasks page (its title in any layout, a board card, a timeline bar, `e` on a row) goes to its page at `/tasks/<id>`, under Tasks in the nav and titled with the task's title. Anywhere else (Focus, a project page, a person, a note's task chip, ⌘K) a task opens in its panel, and adding a task always uses the new-task panel.
- **Header**: the project (a link) or General; "From <meeting>" when it is an action item; the title (struck through when done); **Close** / **Reopen** (with Undo), **Summarize**, **Edit** (the task's panel) and **Delete** (with Undo, then goes to Tasks); then its status, priority, due date, assignee, blocker (which edits it), tags and links.
- **Body**: **Details** (the markdown) and the note it was made from on the left, **Notes** on the right (3:2 above 820px, one column below), the same Notes section as the task's panel; created and closed times at the foot.
- An unknown id shows Not found with Back to Tasks. Switching spaces on a task or meeting page goes to Tasks or Meetings.

### Topics and carrying forward

Added in the rebuild (M11). A meeting's agenda as a list of topics (see [Topic](#topic-embedded-in-meetings)), beside its free-text note.
- **On the meeting's page and in its panel** (the row shows only the count, "2 of 4 topics"; covered of all; counts do not animate): each topic has a checkbox (covered), its title (click to edit; Enter saves, Escape cancels), its outcome (muted, when set; click to edit), an **Outcome** button that opens a one-line input, and a menu: **Make a task**, **Move up** / **Move down** and **Delete**.
- **Reorder**: drag the handle with a mouse (desktop); on touch and keyboard, Move up / Move down in the menu or Alt+↑ / Alt+↓ on a topic. Each move is announced.
- **Delete** has no confirm step; the toast's Undo puts the topic back where it was, with its checkbox and outcome.
- **Make a task** opens the new-task panel with the topic's title, as an action item of the meeting (see [Action items](#action-items)). It does not change the topic.
- **Topics section** (the page's left column; above Notes in the panel), laid out like Notes: the heading, the count ("1 of 3 topics") and an **Add topic** button, which opens an inline one-line field (Enter adds and keeps the field open for the next; Escape closes it and returns focus to the button; pressing Add topic again goes back to the field). With no topics and the field closed it reads "No topics yet". On an **existing** meeting every change is an op at once, as the meeting's notes are, not on Save. On a **new** meeting, which has no id yet, each Enter adds a pending topic (shown with a **Remove** button); on save they become `addTopic` ops in the same batch as `addMeeting`. More than 50 topics in all (the carried ones counted) is refused as you add, and again on save.
- **Focus agenda and Calendar**: a meeting with topics shows its count (" · 1 of 3 topics" on the agenda card, "1/3" on a calendar chip, read as "1 of 3 topics").

**Carrying forward.** There is no recurrence model. Two meetings are in the same **series** when they have the same project, the same title (trimmed, any case) and the same attendees (in any order); earlier and later are by day, then time.
- **New meeting.** When the form's project, title, attendees and day match an earlier meeting in the series, the most recent one is taken; if it has uncovered topics, a line "Carry forward n topics from <day>" with a checkbox (on by default) appears above Topics, the titles muted under it. On save the copies (new ids, not covered, no outcome, `carriedFrom` set) go into the same batch as `addMeeting`, before any typed ones, and count toward the 50. This path only copies: the earlier meeting's topics stay as they are.
- **Carry forward** in an existing meeting's row menu and on its page targets the **soonest later** meeting in the series, and shows only when this meeting has uncovered topics that the target does not already have by title (any case). It copies those there and marks them covered here with the outcome "Carried forward", in one batch; titles the target already has are skipped, so carrying twice, or after creating a meeting with carried topics, adds nothing. The toast says "Carried n topics to <day>"; its Undo restores both meetings.
- A carried topic's `carriedFrom` is the day it was first raised: a copy of a topic that was itself carried keeps the original day. The topic shows "from <day>" muted beside its title (read as "carried forward from <day>").

### Milestones

Milestones are added, edited and deleted only in the project page's Milestones section: a title and a date (the shared date field, so `fri` and `+3d` work); Enter adds and keeps focus in the title, Esc clears. Edit changes title and date in place (Enter saves, Esc cancels). Delete has no confirm step; the toast offers Undo, which re-adds the milestone with the same id. Each change logs activity on the project. A milestone shows on the project card (the next one on or after today), on the Projects Timeline as a point with its title and day on hover or keyboard focus, on the Focus agenda, and in the weekly digest (the digest week and the 7 days after it). Clicking one on the Timeline or the agenda opens the project page with `?milestone=<id>`, which opens the section, scrolls to the row and highlights it. Search does not index milestones. A project has at most 50.

## Claude summaries

A **Summarize** action exists on four item types: project (header), task (panel footer), meeting (row), note (footer). It is hidden when no model is available. In the artifact this uses the viewer's own Claude account through the platform's `sample` capability; in a standalone app it becomes a server-side call to the Messages API with the same prompt and context.

**Flow.** Click opens the side panel titled `Summary · <item>` showing "Thinking…", with Stop, Copy (disabled until text arrives), and Save as note. Output streams in and is rendered with the markdown subset. On completion Stop is disabled and Copy / Save enable. Closing the panel aborts the request. Errors: `not_granted` hides the feature for the session; `canceled` keeps partial text and appends "Stopped."; `rate_limited` shows a toast; anything else shows partial text or a one-line failure message.

**Save as note** writes a note to the item's project (or General) with body `Summary of <item>` followed by the markdown, converts any `@Name` back to mention tokens, links it to the meeting when summarizing a meeting, and logs activity.

**Context assembled per item** (plain text, labeled sections):

| Item    | Included                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project | name, org, status, priority, target date, team names, description; open tasks with priority/due/assignee/details; last 15 done tasks; milestones by date; all meetings (with "n of m topics covered" when a meeting has topics); last 20 notes newest first; last 25 activity lines |
| Task    | title, project, the meeting it is an action item of, status, priority, due, assignee, tags, details, link labels, source note body if any, its running notes oldest first (the last 20)                                                                                             |
| Meeting | title, date and times, project, attendees, agenda note, topics in order (`- [x] <title> — <outcome>` once covered, `- [ ] <title>` otherwise), action items (`- [ ]` open, then `- [x]` done, with due, assignee and when closed), all linked notes, oldest first                   |
| Note    | date, project, meeting title if linked, task title if it is a task's note, body                                                                                                                                                                                                     |

Mentions are expanded to names before sending. Nothing outside the item is included.

**Prompt** (single user turn; context appended after two newlines):

> You are summarizing one item from a personal project tracker used by an engineering leader. Write a concise summary in plain markdown using short paragraphs and "- " bullets (headings, if any, as "### "). Structure: a 1–3 sentence overview; then bullets for key points; then "Open items" and "Suggested next steps" when the data supports them. Be specific, keep names and dates, do not invent anything not in the data, and stay under 220 words.

Model tier is the default (not the quick tier); the artifact caches identical requests for five minutes.

## Page preferences

Added in the rebuild (#186). Each page remembers how you left it: Focus, Projects, Archived, Tasks, Meetings, Notes, People, and the project page (one set for every project, not one per project). What is remembered:
- **Layout:** Cards / Table / Board / Timeline / Calendar, Focus's Day / Week, the project page's task List / Board.
- **Sort, direction and grouping.**
- **Filters:** status, project, org, health, assignee, pinned. Never the search text, and never an id that points at one item (`?note=`, `?milestone=`, `?to=`).
- **Sections:** open or closed for each collapsible section (Focus's buckets, the project page's sections, its Done list).

They are stored with the space's data (`settings.user.pages`), so they follow you to every device and come along in exports; each space has its own. Changing a control updates the address as before and saves the preference; quick changes go out together after half a second. The address wins key by key, then what is saved, then the page's defaults: a link or Back shows what it names, and a bare address shows the saved settings without rewriting it. Before a change pushes a new history entry, the entry being left is given what it showed, so Back returns to it. A page reads what is saved once, when it opens with the server's state: another tab or device changing a preference changes what the page opens with next time, never a page already open. A saved value the page no longer has (a layout it dropped, a deleted project or person, an org no longer in use) is ignored, and the page shows its default.

**Settings → Pages** (`/settings/pages`) shows each page as a card with the controls the page uses, its saved or default values, and how many sections are saved closed or open. Changes there are saved at once. Reset puts one page back to its defaults, Reset all every page; both offer Undo.

The first time a space with no saved preferences opens in a browser that remembered choices before #186 (`datapad:view:*`, `datapad:focus:*`, `datapad:section:*` in `localStorage`), those are saved once as its preferences; a project page's sections, kept per project before, become the one set, closed where most projects had them closed. After that `localStorage` is not read for them.

## Persistence, sync, import/export

**Store shape.** In-memory state is `{projects, tasks, notes, people, activity, meetings}`, each a map by id. All views are pure renders of that state; the whole main region re-renders on every change (cheap at this scale; a rebuilt app should use a reactive store).

**Write path.** `write(col, id, doc)` applies optimistically to memory, re-renders, then persists; `remove(col, id)` likewise. Failures toast and the next snapshot corrects the view. Whole-document writes only.

**Backends.** The artifact subscribes to each of the six collections on a per-artifact realtime document store and treats a snapshot as the source of truth. When that store is unavailable it falls back to `localStorage` under `ledger:v1` with the same shape. On first sync, if local data exists and the remote store is empty, the user is offered a one-time migration. A rebuilt app should keep this split: one storage interface with a local adapter (offline, tests) and a remote adapter.

**Read-only.** If the platform reports the viewer cannot write, `readOnly` hides every mutating control (quick-adds, buttons, composers, drag) and shows a banner; Summarize remains available.

**Export** writes `{exportedAt, projects, tasks, notes, people, activity, meetings}` as pretty JSON named `ledger-YYYY-MM-DD.json` through a download, falling back to the clipboard. **Import** reads such a file, confirms, and merges by id (same id replaces). This JSON is also the migration path from the artifact to the new app; the artifact's file has the older typed collection in place of `meetings`, and import migrates it.

**Caps to respect** when designing the remote store: documents under 256 KiB (activity logs are capped at 150 entries for this reason), collections scanned without indexes (keep to low thousands of documents), last-writer-wins with no transactions.

## Spaces

Added in the rebuild (M9). A space is a complete, separate Datapad under the one signed-in user: its own projects, tasks, notes, meetings, people, orgs, templates, settings and activity (and any retired decisions). Nothing is shared or searched across spaces; every view, count, summary and ⌘K result is the open space's.

| Topic     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model     | `{id, name, position, createdAt}`. Every user starts with Main (`main`), which holds any data from before spaces. Names are trimmed, not empty, at most 40 characters and unique ignoring case; at most 12 spaces. `position` is the switcher order.                                                                                                                                                                                                                                                                                         |
| Switching | The rail header (desktop), the account menu (every width; the switcher on phones) and ⌘K list the spaces; the rail and ⌘K have New space…, and the rail Manage spaces. The account menu only switches (#159). The choice is remembered per device, not in the URL. Switching from a project, person or org page goes to Focus; section pages stay. The page and rail crossfade. With more than one space, the tab title carries its name ("Tasks · Personal · Datapad").                                                                     |
| Settings  | Settings → Spaces (`/settings/spaces`) lists them in switcher order: rename in place (Enter saves, Esc or leaving the field reverts), Move up / Move down, New space, Delete…. Settings → Data acts on the open space: Export <space>, Import into <space>, Backups of <space>.                                                                                                                                                                                                                                                              |
| Moving    | Move to… on a project page (with more than one space). The project goes with its tasks (action items among them, linked to its meetings), notes, meetings (with their topics), milestones, activity log and any retired decisions; the people it refers to and its org are copied, and the source keeps its copies. A same-named org in the target is reused; a copied person is not `me` if the target has one. The log gains "Moved from <space>". One transaction across both spaces; not undoable from the toast, but moving back works. |
| Deleting  | Delete… asks for the space's name typed exactly, then deletes it with a one-time token issued for that space (good for five minutes). The last space cannot be deleted; Main can, once another exists. Tabs open on it go to the first space left. Its nightly backups stay in R2 but are no longer listed in the app.                                                                                                                                                                                                                       |
| Backups   | Nightly, per space, 30 kept each: Main at `<email>/datapad-YYYY-MM-DD.json` as before, others at `<email>/<spaceId>/datapad-YYYY-MM-DD.json`.                                                                                                                                                                                                                                                                                                                                                                                                |

## Navigation preferences

Added in the rebuild (#187), per space: Settings → Navigation (`/settings/navigation`) chooses which sections the rail and the tab bar show, and in what order, and whether the rail shows Active projects, Weekly digest and Archived (each still only when there is something to show). Changes save as they are made.

| Part     | Behaviour                                                                                                                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sections | One row each (Focus, Projects, Tasks, Meetings, Notes): a **Show** switch and **Move up** / **Move down** buttons; rows slide into place (FLIP, off with motion). The last visible section cannot be hidden. The rail and the tab bar follow the order at once; the tab bar lays the visible sections out in one to five even columns, 44px targets kept. |
| Hidden   | Still opens from its address, ⌘K and Help; nothing in the nav is marked current on it. `/` is Focus even when Focus is hidden.                                                                                                                                                                                                                            |
| Reset    | **Reset to default** puts today's nav back, with Undo in the toast.                                                                                                                                                                                                                                                                                       |
| Stored   | `settings.user.nav`: `{ order?, hidden?, extras? }`, absent by default, set by the `setNav { patch }` op (not logged; `null` clears a key). `navOf(settings)` in `shared/nav.ts` gives the visible sections in order: unknown names are ignored, and a section missing from a saved order (one a later release adds) shows at its default place.          |



One log per project plus one for General. Entries are `{t, text}`, prepended, capped at 150; the project page shows the latest 40 in a collapsed Activity section, and project summaries read the latest 25.

| Trigger                                       | Text                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Task created                                  | Added task "<title>"                                                                                                  |
| Action item added                             | Added action item "<title>" to "<meeting>" (in place of Added task)                                                   |
| Task closed / reopened                        | Closed "<title>" / Reopened "<title>"                                                                                 |
| Task edited                                   | Edited task "<title>"                                                                                                 |
| Task moved                                    | Moved "<title>" to <project> (old project) and Moved "<title>" here from <project> (new project)                      |
| Task deleted                                  | Deleted task "<title>"                                                                                                |
| Note added / deleted                          | Added a note / Deleted a note                                                                                         |
| Note added to a task                          | Added a note to "<task title>"                                                                                        |
| Summary saved                                 | Saved a Claude summary as a note                                                                                      |
| State line changed (retired; older logs only) | Updated current state                                                                                                 |
| Project created / edited                      | Created project / Edited project details                                                                              |
| Status changed                                | Status changed to <status>                                                                                            |
| Archived / restored                           | Archived project / Unarchived project                                                                                 |
| Meeting added / edited / deleted              | Added meeting "<title>" / Edited meeting "<title>" / Deleted meeting "<title>"                                        |
| Milestone added / edited / deleted            | Added milestone "<title>" (<day>) / Edited milestone "<title>" / Deleted milestone "<title>"                          |
| Topic added / removed                         | Added topic "<title>" to "<meeting>" / Removed topic "<title>" from "<meeting>" (on the meeting's project or General) |
| Topic carried forward                         | Carried topic "<title>" forward to "<meeting>" (in place of Added topic, on the target meeting's project or General)  |
| Project moved in from a space                 | Moved from <space> (rebuild only, in the target space)                                                                |

Pinning a note, reordering tasks, and editing, ticking or reordering topics are not logged. The log is the data source for the deferred weekly digest.

## Design system

Quiet, dense, cool-neutral. The one expressive element is the serif used for project names; everything else is small, disciplined sans. No decorative shadows on cards, no gradients; borders carry structure.

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

Dark mode follows the OS by default and can be forced by `data-theme` on the root. Radius 10px on cards and panels, 8px on controls, pills fully round. Priority dots: high = danger, med = warn, low = ink3, none = line. Status pills: active = accent-soft fill, paused = dashed border, done = ok tint. Meetings carry no type pill; a milestone is marked by a flag glyph (a filled diamond on timelines), and past milestones are muted.

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
| `views/`      | Focus, Projects, ProjectDetail, Tasks, Notes, Meetings, People, Archive                                                                                                                                                                  |
| `components/` | TaskRow, QuickAdd, NoteCard, NoteComposer (mentions + list continuation), MeetingRow, Milestones, SidePanel, Palette, Toast                                                                                                              |

**Order of work.** 1) model + store + local adapter + JSON import so existing data loads on day one; 2) Projects, ProjectDetail, Tasks with quick-add and close; 3) Notes and mentions; 4) Meetings with prep/debrief, and milestones; 5) Focus, People, Search; 6) remote adapter and summaries; 7) polish items from Known gaps.

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
5. Reminders: in-app due reminders and an .ics export per task, meeting or milestone; true push notifications need a native or server component.
6. Snooze a task to a date; a per-project "next up" marker shown on the card.
7. Recurring tasks, subtasks, time tracking, and comments on tasks were considered and rejected for now.
