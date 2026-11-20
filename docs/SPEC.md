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
- Three places and one input (v2, #326): Today, the rooms (one per project and per person) and All, with the capture line on top; Scratch for lines with no home; meeting mode for a meeting
- On-device summaries of a room, a meeting, a task and the day

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
| decide                            | boolean, optional                  | something to decide (#328); absent = false    |

**To decide** (#328, export format 3). `addTask` and `editTask` take `decide`. `setDecide { id, decide }` marks a task to decide or decided; it states the result, so repeating it changes nothing, and it logs `Marked "<title>" to decide` or `Decided "<title>"`. Read it with `decideOf()`. Before format 3 the prototype used a `decide` tag; the migration marks every open task with that tag, and keeps the tag.

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
| scratch   | boolean, optional        | the space's Notepad (#218): its one running General note. Absent on every other note, read as false. Retired in format 3 (#328): the migration clears it; only an old client's `writeNotepad` still sets it |
| createdAt | timestamp                |                                                                                                                                  |
| editedAt  | timestamp, optional      |                                                                                                                                  |

**Filing a note** (#328). `moveNote { id, projectId }` moves a General or project note to another project, or to General (`projectId: null`). It keeps the note's id and `createdAt`, bumps both projects' `updatedAt` and logs `Filed a note to "<project>"` in the destination's log. It refuses a meeting's note, a task's note and the Notepad; moving a note to where it is changes nothing. Every compact note row offers it as **Move to…** in its ⋯ menu (a picker of the other projects not archived, and **No project** for a project's note), with Undo; a meeting's or a task's note has no such item.

**Scratch** (#328). A note is in Scratch when it is General, on no meeting or task, and mentions nobody: `inScratch()` in `shared/notes.ts`. It is a selector, not a field, so filing is `moveNote` or adding a mention.

**The Scratch page** (#333, `/scratch`) replaces the Notepad. On top, a writing area with the full composer: ⌘Enter or **Add block** adds a General note (one that mentions someone is filed at once, and the toast says so). Below, the blocks (`scratchNotes()`: the notes in Scratch, newest first), each with its relative time, its rendered body (checklists tick in place, through `editNote`) and its actions, always shown: **File to…** (a picker of the projects not archived; `moveNote`, and the toast's Undo moves it back to General), **Make task** and **To decide** (a task in General titled `taskTitleFrom()` of the body, with `sourceNoteId`, and `decide` for To decide; the block stays), **Edit** in place and **Delete** with Undo. On a phone Edit and Delete are icons. Selected text offers Make task, as in any note.

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

### List

A titled checklist of one-line items, each done or not, in an order you choose (#298). Between a note and a set of tasks: items have no due date, assignee or priority, and they are structured, checkable and reorderable.

**Retired in format 3** (#328), as decisions were (#183). The schema 4 migration and the import of a format 1 or 2 file turn each list into a note on the same project (or General), under the list's id: `## <title>`, then one `- [ ]` or `- [x]` line per item, in order, with the list's `createdAt` and its `updatedAt` as the note's `editedAt` (see [data.md](data.md#the-format)). The `lists` collection is kept and still exports, and list ops from old clients still apply, so a stale tab does not fail. The classic Lists pages stay until v2 replaces them (#341).

| Field     | Type           | Notes                                                       |
| --------- | -------------- | ----------------------------------------------------------- |
| id        | string         |                                                             |
| projectId | string \| null | null = General                                              |
| title     | string         | required, trimmed, at most 200                              |
| items     | ListItem[]     | embedded, in the order chosen; at most 200 (`listItemsMax`) |
| createdAt | timestamp      |                                                             |
| updatedAt | timestamp      | bumps on every edit, items included                         |

### ListItem (embedded in lists)

`{id: string, text: string, done: boolean, createdAt: timestamp, doneAt: timestamp | null}`: one line (required, trimmed, at most 200), whether it is done, and when it was checked (null while open).

List ops (item ops name their `listId`; each bumps the list's and its project's `updatedAt`):

| Op                 | Fields                       | Behavior                                                                                                                                                  |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addList`          | `id`, `title`, `projectId`   | Logs "Added the list "…"" in its project's log, or General's                                                                                              |
| `editList`         | `id`, `title`, `projectId`   | Renames or moves it; not logged                                                                                                                           |
| `deleteList`       | `id`                         | Takes its items with it; logs "Deleted the list "…""                                                                                                      |
| `addListItem`      | `listId`, `id`, `text`       | Appended last; refused for an id already there, or a list that has 200 items; not logged                                                                  |
| `editListItem`     | `listId`, `id`, `text`       | Not logged                                                                                                                                                |
| `setListItemDone`  | `listId`, `id`, `done`       | Sets `doneAt` to now, or null; states the result, so repeating it changes nothing; not logged                                                             |
| `deleteListItem`   | `listId`, `id`               | Not logged                                                                                                                                                |
| `reorderListItems` | `listId`, `ids`              | Every item id exactly once, in the new order; a list that omits, repeats or invents one is refused ("The items changed; try again") and nothing changes |

An unknown list or item id is refused.

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

### BoardItem (whiteboards)

One thing on a whiteboard. A board has no document of its own: `boardId` is a project's id, or `general` for the space's board.

| Field   | Type     | Notes                                                                                       |
| ------- | -------- | ------------------------------------------------------------------------------------------- |
| id      | string   |                                                                                             |
| boardId | string   | a project's id, or `general`                                                                |
| kind    | enum     | `sticky`, `text`, `rect`, `arrow`, `ink`                                                    |
| x, y    | number   | board units (px at 100%), within ±100 000                                                   |
| w, h    | number   | the box; for an arrow or ink, the box around its points                                     |
| z       | number   | drawing order, higher on top (ties by id)                                                   |
| color   | enum     | `neutral`, `accent`, `ok`, `warn`, `danger`: a token, never a literal                       |
| text    | string   | a sticky's, a text's or a rect's label (mentions as tokens); empty otherwise; at most 2 000 |
| points  | number[] | flat `[x0, y0, x1, y1, …]` relative to `x, y`: an arrow's two ends, an ink stroke's points  |

A board holds at most 2 000 items (`boardItemsMax`), an ink stroke at most 1 000 coordinates (`inkPointsMax`; the client simplifies first). An arrow end lying on a sticky's or rect's border is attached to it and follows it; the model stores nothing more.

### Relationships

task → project (optional), task → assignee, task → source note; note → project (optional), note → meeting or task (optional, not both); meeting → project (optional), meeting → attendees; project → members, project → milestones (embedded); list → project (optional), list → items (embedded). Deleting a project deletes its tasks, notes, lists, milestones and activity; its meetings move to General. Moving a project to another space takes its lists. Deleting a meeting keeps its notes, and so does deleting a task. Moving a task to another project moves its notes with it. Deleting a person leaves mentions rendering as "@unknown".

## Views

v2 (#326) is built around three places and one input. Routes are paths; [The shell and pinned rooms](#the-shell-and-pinned-rooms) has the rail, the tab bar, every address and every redirect from the classic pages (Focus, Projects, Archived, Tasks, Notes, Meetings, Lists, the Notepad, the Weekly digest, the project, task and meeting pages), which v2 removed.

| View | Shows | Controls | Empty state |
| ---- | ----- | -------- | ----------- |
| Today | `/`: one day at a time, the open loops beside it. See [Today](#today) | Previous day, Today, Next day; Day and Week (`v`); Brief me; the capture line; Add meeting by the Timeline | "Nothing on this day." in the timeline; each lane says it is empty |
| Scratch | `/scratch` (#333): the notes with no home (General, on no meeting or task, mentioning nobody), newest first, as one running pad. Each block shows when it was written; its checklists tick in place | Write at the top, ⌘Enter or **Add block**; per block **File to…** (a project picker; `moveNote`, same id and time, Undo), **Make task**, **To decide** (a task titled from its first line, pointing back at it; the block stays), Edit in place, Delete with Undo. Adding a mention files a block | Says what Scratch is for |
| Rooms | `/rooms`: the phone's Rooms tab. The rail's rooms and the people waiting on, as a page. See [The shell and pinned rooms](#the-shell-and-pinned-rooms) | A link to All's projects and people | Points to All to find a project or person |
| All | `/all` (#337, #338): every task, note, meeting, project and person in one list. See [All](#all) | Kind chips; the [list toolbar](#list-toolbar); layouts; saved views; the bulk bar; the space's Whiteboard in the header | "None match these filters." with Clear filters |
| Project room | `/projects/<id>` (#334). See [Rooms](#rooms) | Pin, Schedule meeting, Edit, More; the people to narrow to; tabs Stream, Plan, Whiteboard, then the project's pinned notes | Per lane and in the stream |
| Person room | `/people/<id>` (#335). See [Rooms](#rooms) | Pin, Schedule meeting, Edit, Remove; their projects to narrow to; the pinned notes that mention them | Per lane and in the stream |
| Meeting mode | `/meetings/<id>` (#336). See [Meeting mode](#meeting-mode) | Join, Edit, More, Leave; Previous and Next in the series | Not found with Go to Today |
| Whiteboard | `/projects/<id>/whiteboard` (a project room's tab) or `/whiteboard` (the space's, linked from All's header and ⌘K): a freeform canvas of stickies, text, rects, arrows and ink; `?item=<id>` opens it on one item, selected and centered. See [Whiteboard](#whiteboard) | The toolbar, zoom, the board's menu | An empty canvas |
| People, Orgs | Settings → People (`/settings/people`) and Settings → Orgs (`/settings/orgs(/<id>)`): reference data. A person's row opens their room | Add, Edit, Remove; "This is me"; [Find](#list-toolbar) | Prompts to add one |
| Search | ⌘K palette: Projects (recent when the query is empty), Tasks, Notes, Meetings, Orgs, People, Whiteboard (sticky, text and rect labels); then actions: New task, New note, New meeting, New project, Go to Today, Scratch, All (and each kind), People and Orgs, Open whiteboard, theme, spaces, Export, Refresh. Arrow keys and Enter | Opens the item: a project or person room, the task panel, a note on All, meeting mode, an org, or the board on the item | "Nothing matches." |

Task row (Today's due list, the lanes, the rooms, All): circular checkbox, priority dot, title (click opens the panel), a small note count when the task has running notes (it does not animate), the room and person chips, the due date colored red when overdue and amber when today. Done rows strike through. On All each row also has a select box for the bulk bar.

Project ordering by priority uses high → med → low → none, then name. "Recently updated" uses `updatedAt`, which bumps when tasks, notes, meetings, or milestones in the project change.

### All

All (`/all`, #337, #338) replaces the Tasks, Notes, Meetings, Projects and Archived pages; their addresses land here with their filters.
- **Kinds**: chips for Tasks, Notes, Meetings, Projects and People (`?kind=`, comma separated). None picked is every kind. The rail, the tab bar and ⌘K open All on the kinds Settings → All sets (Tasks by default).
- **Filters** fit the kinds picked: Find, Room, Person, Status (Open, Done or past, Archived, All), Due, Tag, and To decide or Waiting on. Everything stays in the address.
- **Sort**: tasks or projects alone sort as their pages did; several kinds sort together by Recently updated, Title or Date.
- **Layouts** when one kind is shown alone: tasks as a list, a table or a board (by status or by priority), meetings as a list or a calendar, projects as a list, cards or a timeline. The layout is in the address, and each kind remembers the last one picked (Settings → All sets it too).
- **Saved views**: Save view names the kinds, filters, sort and layout shown, as a chip above the list, synced with the space (`settings.user.pages.all.views`). Each chip's menu renames it, pins it to the rail like a room, or deletes it with Undo.
- **Bulk actions**: every task row has a select box. The bar that appears completes or reopens, marks to decide, moves to a room, assigns, sets the due date or deletes, each as one change with Undo.
- **Rooms**: a chip after the kinds (`?show=rooms`) that shows the rooms in place of the list: project rooms under their orgs (with **New project** by the Projects heading) and people by how much they owe you, each with Pin. It is not a kind: it clears the kinds and hides Find, the filters, Sort, the layouts, saved views and the count, and picking a kind turns it off.

### Rooms

A room is one project's or one person's page (#334, #335), or a project seen through one person.
- **Project room** (`/projects/<id>`): the header has the org, the name and a state line (health, status when not active, target date, next milestone, how many loops are open), with **Pin**, **Schedule meeting**, **Edit** and **More** (Summarize, Pause, Mark active or Mark done, Move to…, Save as template, Archive, Delete). Under it: the people to narrow the room to (`?person=`), the **Next meeting** card with Enter meeting, and three tabs. **Stream** has the three lanes beside one stream of everything attached (Coming up first, then notes, tasks added and done, meetings and milestones, newest first, older ones behind Show older), with the capture line on top, preset to the project. Notes are compact rows, closed until opened (a `?note=` link opens its own). **Plan** (`/projects/<id>/plan`) has the description, details and health, the timeline bar, milestones, members, links and Activity. **Whiteboard** (`/projects/<id>/whiteboard`) is the project's board. Picking a person narrows the lanes and the stream to what touches them; capture then mentions them (on a task, assigns them), and Pin pins the pair.
- **Person room** (`/people/<id>`), the 1:1 prep: the header has the orgs of their projects, the name and a state line (role, how many projects, how many loops are open), with **Pin**, **Schedule meeting**, **Edit** and **Remove**. Under it: their projects to narrow to (`?project=`, the same items as the project room narrowed to them), the Next meeting card, then three lanes beside one stream. **You owe** is your open tasks that touch them. **They owe you** is what waits on them (assigned to them or blocked on them), then anything else of theirs that waits on someone. **To discuss** is the to-decide tasks that touch them and the open topics of their meetings ahead. The stream has the notes that mention them, the tasks that touch them and the meetings they attend, newest first. Capture there mentions them on a note and assigns them a task.
- **Pinned notes** (#377, `roomPinnedNotes()`): a project room's tab row lists each pinned note of the project after Whiteboard; a person room has a row of the pinned notes that mention them (any project), and no row when there are none. Narrowing the room does not change them. Each is a link with a pin icon, labeled by its first line (`pinnedLabel()`: `notePreview()`'s first line, at most 40 characters), oldest first. Choosing one opens it in place at the top of the room, under the row, on whatever tab is current: the rendered note (checkboxes save) with **Edit** (the composer in place), **Unpin** (with Undo) and **Close**. The address keeps it as `?note=<id>`, the same key that opens a row elsewhere, so Back closes it and a link opens it; the stream's own row for that note stays as it is. Esc or Close closes it and puts focus back on its link. Choosing the open one again closes it. There is no limit on pins: those that do not fit the row go under a **Pinned** menu at its end (`pinnedFit()`), so the row never scrolls sideways; on a phone the menu shows the pin and the count. Pin and Unpin on any note row change the row live; there is no op of its own (`pinNote`).
- **The Notepad** (`shared/notepad.ts`): every project has a pinned note `# Notepad`, so its room's tab row opens on a place to write. `createProject` makes it with the project, under the id `<projectId>-notepad` (`notepadId()`), dated with the project and silent in Activity; deleting the project deletes it. The projects from before it got theirs once, at schema 6 (`addNotepads()`), archived ones too; an import restores a file as it is and adds none, so a Notepad deleted since never comes back from a backup. After that it is an ordinary note: edit it, unpin it, move it or delete it, and nothing makes it again.
- Settings → Rooms sets each room's lanes, shown and ordered, the tab a project room opens on, and the person room's lane names. `shared/rooms.ts` and `shared/stream.ts` hold the rules.

## Interactions

The common path never opens a modal: Enter adds, a checkbox closes, click drills in, Escape backs out.

**Adding.** The capture line (below) is the common way in, on Today and in every room. ⌘K has New task, New note, New meeting and New project, at every width. `n` goes to the capture line, or opens the new-task panel where there is none. A meeting is also added from a room's Schedule meeting or Today's Add meeting; a project from All's New project. The **+** beside Rooms, in the rail and on `/rooms`, is a menu with **New project** (the project form) and **New person** (the person form); either one opens the new room on save. The top bar's + menu is gone (#341). New open tasks still get `order` = max order in that project + 1.

**Close / reopen.** Clicking the circle toggles `status`, sets or clears `completedAt`, logs activity, and bumps the project's `updatedAt`. No confirmation.

**Task panel** (slide-over from the right, 460px, full width on mobile): title, project, status, priority, due, assignee, tags (comma separated), details (the note editor, with @mention autocomplete), a **Notes** section (its running notes; see [Task notes](#task-notes)), links editor, created/closed timestamps. Footer: Summarize, Delete (confirm), Cancel, Save. Moving a task between projects logs an entry in both projects' activity. The panel renders once on open and is not re-rendered by data updates, so in-progress edits survive background sync.

**New task panel** (⌘K → New task, or `n` where there is no capture line): title, project, priority (Medium, or Settings → Capture → New task priority; the quick adds and MCP's `add_task` use it too), due (a week from today, or Settings → Capture → New tasks are due; the capture line, the quick adds and MCP's `add_task` use it too when no date is given), assignee (the default assignee: you when Settings → People → Assign new tasks to me is on, else nobody), details.

**New note panel** (New note in ⌘K, or the capture line's expand): a **Template** picker (only when the space has note templates; choosing one fills the composer, replacing what is there while it is empty or untouched since the last template, otherwise adding below it), the note composer and its project, preset to the current project or General. Adding closes it with a toast; closing with text asks first.

**Project form panel**: name, org (datalist of existing orgs), status, priority, target date, tags, team members (chip checkboxes from People), description, links. Create navigates to the new project. Delete confirms (naming its milestones when it has any) and removes tasks, notes, milestones, and activity, moving its meetings to General; Archive is the non-destructive alternative in the header's More menu.

**Current state line (retired).** Projects used to carry a one-line "current state" under the header and on the card. It is no longer shown, edited, searched, summarized or in the digest; the field and the `setState` op remain so old data and old clients still load.

**Decisions (retired).** Datapad used to keep a decision log. All of that is gone (a task marked to decide replaced it in v2), and `/decisions` (and anything under it) lands on Today. The `decisions` collection and its four ops (`addDecision`, `editDecision`, `setDecisionStatus`, `deleteDecision`) remain, so old data, exports and old clients' queued ops still load and round-trip.

**Task order (retired).** Tasks used to be dragged into order on the project page. v2 has no manual order: Today's lanes and the rooms sort by due date, then the stored `order`. The `reorderTasks` op still reduces, so an old client's queued op applies.

**Notes composer.** A formatted editor (Tiptap on ProseMirror, #376): headings, lists, checklists with tickable boxes, bold, italic, strike, inline code, links, quotes, dividers, code blocks and mentions show as they will render, with no Markdown on screen, and there is no raw Markdown view. Markdown typed as you go turns into formatting (`# `, `- `, `1. `, `- [ ] `, `> `, `---`, ```` ``` ````, `**bold**`, `_italic_`, `` `code` ``, `~~strike~~`, `[label](url)`). What is stored is the same Markdown as before (`shared/note-doc.ts`: one line of Markdown is one block of the editor, and back), so export and import do not change, and opening a note never rewrites it: only an edit hands back new text. `@` opens the mention popup and puts in a name chip; ⌘/Ctrl+Enter adds. Enter in a list item continues the list (numbers count up; a checked box continues unchecked); Enter on an empty item ends the list; Shift+Enter starts a plain line; Tab in a list stays put (lists do not nest). Undo and redo (⌘Z, ⇧⌘Z) cover typing and every command. Rich text pasted from elsewhere comes in as the same Markdown subset; Markdown pasted as text is read as Markdown. A screen reader hears a multi-line text box with its label. The `/` menu lists the space's **note templates** after its commands (all on a bare `/`; by a word of the name, `/retro`; every one for `/template`, and `/template retro` narrows); choosing one inserts its body in place of an empty line, or from the next line, with mentions as names. Every note composer offers them: the New note panel, the inline composers (project, task, meeting) and a note's Edit.

**Note templates.** A `Template` with a `body` (Markdown, mentions as tokens) is a note template; without one it is a project template, so older data reads unchanged. Settings → Templates lists **Project templates** and **Note templates**, each with its own New button; a note template's panel is a name and the note composer. A note's footer has **Save as template**, which opens a new note template preset with the note's first line as the name and its body. A template keeps its kind: the reducer refuses tasks or tags on a note template, a body on a project template, and a note template in `createProject`; the project form offers only project templates.

**Make task from a note.** Selecting text inside a note body shows a floating "Make task" button above the selection; clicking creates a task titled with the first line of the selection (max 200 chars) in the note's project and records `sourceNoteId`. A footer button does the same, falling back to a prompt prefilled with the note's first line.

**Compact note rows** (#273). In meeting mode, in a task's and a meeting's panel, and on All, each note is a compact row (`NoteRow`): a line of meta (relative time, "edited", "Pinned"; on All also its room and its meeting or task chip) over the note's first **two lines** as plain text (`notePreview()`: Markdown marks stripped, mentions as `@Name`, list items as `•`, `1.`, `☐`, `☑`). The row is a disclosure: its toggle ("Note from <when>", `aria-expanded`) or a click on the preview opens it in place to the whole rendered note, where checkboxes save and selected text offers Make task; the toggle closes it again. Open or closed is the row's own and is not saved. Its actions are in a ⋯ menu ("More for note from <when>"): **Edit** (the composer in place), **Pin** / **Unpin**, **Make task** (asks for the title, from the first line), **Summarize** (when summaries are on), **Save as template**, then **Delete** (with Undo) after a rule. The toggle and the menu button are 44px on touch. `?note=<id>` scrolls to the row, opens it and rings it, except in a room where the note is pinned: there it opens at the top of the room (see [Rooms](#rooms)). A room's stream shows its notes closed too. **Pin** also puts the note in its room's tab row.

### Keyboard

| Key               | Action                                                        |
| ----------------- | ------------------------------------------------------------- |
| ⌘K or Ctrl+K, `/` | Open search                                                   |
| `n`               | Go to the capture line (#330); else the new-task panel        |
| `f`               | Go to Find on a list page; Esc in Find clears it, then leaves |
| Esc               | Close search, then panel                                      |
| ↑ ↓ Enter         | Navigate search results and mention popup                     |
| Tab / Enter       | Accept a mention suggestion                                   |
| ⌘/Ctrl+Enter      | Add note from composer                                        |

Single-letter shortcuts are suppressed while an input, textarea, select or the note editor has focus, or while a panel or the palette is open.

**The capture line** (#330, `shared/capture.ts`): one input at the top of Today and of each room (preset to the room). A plain line is a note; `[ ]`, `todo` or a date makes a task; a leading `?`, `decide:` or a closing `?` something to decide; `waiting on @Name` a task blocked on that person. `#word` files it under the one open project whose name, letters and digits only, starts with the word (an ambiguous or unknown one stays as typed, unless it is created from the menu); `@Name` mentions someone and, on a task or a decision, assigns it to them. Dates are `parseDate()`'s; sat, sun, mon, wed, tod and tom count only after due, by or on. Chips under the line show the kind (a button: it or Tab cycles note, task, to decide, waiting on), the project, the people with their role ("for Han", "waiting on Chewbacca"), the due date and Scratch. `@` and `#` open a menu of people or projects (↑ ↓, Enter or Tab, a tap); a name nobody has offers "Add “…” to People", and a `#word` of two or more characters that no project, archived or not, is called offers "Create project “…”" (`newProjectFor()`): the word as its name, in the default org, created at once and the line filed under it. Enter saves through one `batch`, and the toast says where it went with Undo (which deletes it). Esc closes the menu, then clears the line. Shift+Enter or the expand button opens the new-note panel with the text and its project.

**`/` commands that make things** (#375, `slashKind()`, `SLASH_KINDS`). A line that starts with `/note`, `/task`, `/decide`, `/waiting`, `/meeting`, `/milestone`, `/project` or `/person` is that kind; `/` at the start of the capture line opens a menu of them. `/note` keeps date words as text; `/task`, `/decide` and `/waiting` work as their prefixes do. `/meeting` reads a `#word`, `@Name`s as attendees (and a person room's person), a day (today when none) and a time (`2pm`, `14:30`, `at 9`, `2 pm`; a bare number stays in the title). `/milestone` reads a `#word` (or the room's project) and a day, and cannot save without both. `/project` creates one in the default org and `/person` adds someone to People; a name already taken cannot save. What stops a save shows as a chip (`captureProblem()`: "Needs a #project", "Needs a date", "Already a project", "Already in People"). While a `/` command leads the line, Tab and the kind chip leave the kind alone. Every kind's toast has Undo (`deleteMeeting`, `deleteMilestone`, `deleteProject`, `removePerson`, and the note and task deletes). The note composer's `/` menu has the same commands (`CREATE_COMMANDS`), acting on the line at the caret, read by `parseCapture()` in the note's context (`fromNote`: a note made from it stays in the project): `/task`, `/decide` and `/waiting` make the line a checklist item, `/person` a mention, `/note` moves the line into its own note, and the rest leave it as it is. On a meeting's note a task is an action item ("Added an action item to …"); editing a saved note, it keeps `sourceNoteId`. `/milestone` shows only when the note has a project.

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

Added in the rebuild (#164). Running notes on a task: dated entries such as "pinged legal, waiting on the redline", instead of rewriting the one **Details** field. They are ordinary notes with `taskId` set, so they also show on All and in the project room's stream, are found by ⌘K as notes, and go into summaries.
1. In the task panel, under Details, a **Notes** section lists the task's notes newest first, each a compact row (see **Compact note rows**) with its relative time, "edited" when it was, its first two lines, opening in place to the rendered note, and a ⋯ menu with **Edit** (in place: the composer, Save note or ⌘Enter, Cancel or Esc), Pin, Make task, Summarize, Save as template and **Delete** (with Undo). With none, it says "No notes yet".
2. **Add note** beside the heading opens the inline composer (`InlineNoteComposer`) after the list; pressing it again returns to the composer. **Save note** (or ⌘Enter) sends `addNote` with the task's `taskId` and closes the composer, leaving the panel open; **Cancel** or Esc closes the composer, not the panel. The draft is kept per task in sessionStorage until Save or Cancel. With something written, a click outside the composer swaps its buttons for **Save this note?** with **Discard** and **Save note**; a link, Back or closing the panel waits for that answer and then goes on (`src/lib/leave.ts`). Esc while it asks, or clicking back into the text, returns to writing. Every inline composer (task, meeting, meeting row) works this way. Editing a saved note in place (Edit in its menu, or a double-click on its text) guards leaving too: with changes not yet saved, a link, Back, Forward or closing the panel swaps its buttons for **Save changes to this note?** with **Discard** and **Save note**, and goes on once answered. A click elsewhere keeps it open with its text and does not ask.
3. `addNote` with `taskId` checks the task exists ("That task no longer exists"), takes the task's project (the op's `projectId` is ignored), refuses a `meetingId` alongside it ("A note goes on a meeting or a task, not both"), bumps the task's and the project's `updatedAt`, and logs `Added a note to "<task title>"`. The bump alone does not show the panel's "Updated elsewhere" line.
4. A note with `taskId` shows a chip naming its task; it opens the task panel. When the task has been deleted the chip reads "Task deleted" and the note stays.
5. `moveTask` moves the task's notes to the new project in the same op; moving a project to another space carries them with it, `taskId` and all.

## Action items

Added in the rebuild (#185). A meeting's **action items** are real tasks linked to it (`Task.meetingId`), so they also show in Today's lanes, on All and in the rooms, and are found by ⌘K as tasks.
1. Meeting mode (under the notes) and the meeting's panel (between Topics and Notes) each have an **Action items** section, in the same inline style as Topics and Notes: the heading, the open count ("2 open"; nothing once all are done; it does not animate) and **Add an action item**, which opens a one-line field (Enter adds one and keeps the field open for the next; Escape closes it and returns focus to the button). The list is the shared task row: open first, oldest first, then done (struck through), the most recently closed first. Its checkbox closes and reopens (with Undo), and the title opens the task's panel. With none and the field closed it reads "No action items yet".
2. A topic's **Make a task** opens the new-task panel with the topic's title, as an action item of the meeting: the panel says "An action item of <meeting>" in place of the project picker.
3. `addTask` with `meetingId` checks the meeting exists ("That meeting no longer exists"), takes the meeting's project (General for a General meeting; the op's `projectId` is ignored) and logs `Added action item "<title>" to "<meeting>"`. The meeting itself is not changed. `meetingId` is optional in the schema and the type, and is written only on tasks that have one, so exports from before it import unchanged.
4. A task with a meeting shows "From <meeting> · <day>" on its panel, linking to meeting mode. Moving the task to another project keeps the link.
5. Deleting a meeting keeps its action items as plain tasks: the same op sets their `meetingId` to null. The delete question says so ("Its 2 notes and 3 action items are kept.").
6. Moving a project to another space carries its tasks, action items among them; an action item keeps its meeting when the meeting goes too, and loses the link when it does not (in either space).
7. Summarize for a meeting lists its action items; for a task, the meeting it came from.

Carrying open action items forward to the next meeting in a series is out of scope.

## Meetings and notes linkage

Notes on a meeting are written on the meeting, never by going somewhere else, and work as a task's do ([Task notes](#task-notes)): one kind of note, added as needed (#167; the Prep / Debrief / Note split of #163 is gone from the UI).
1. Every meeting row (All's meetings) offers **Add note** (beside the row on wide screens, and in its ⋯ menu everywhere, which is how a phone reaches it). It opens the inline composer (`InlineNoteComposer`, via `MeetingNoteComposer`) right under the row; the URL does not change. The composer is the notes editor (Markdown, `/` styles, `@` mentions, `/task`) and starts empty. One composer per meeting: Add note again focuses it. The draft is kept per meeting in sessionStorage until Save or Cancel.
2. **Save note** (or ⌘Enter) sends `addNote` with the meeting's `projectId` and `meetingId` (never a `phase`) and closes the composer; a toast confirms it (the row does not list notes; meeting mode does). **Cancel** or Esc closes it and drops the draft.
3. A meeting's notes are otherwise written in meeting mode or its panel.
4. The meeting's panel (editing an existing meeting) has a **Notes** section, the same component as the task panel's: **Add note** beside the heading, the meeting's notes newest first, each rendered with when it was written, **Edit** in place and **Delete** with Undo, and the composer after the list. Meeting mode (see [Meeting mode](#meeting-mode)) keeps its composer open above the notes. Notes save on their own; they do not make the form dirty.
5. The composer opens with `@starting-style` (a panel, not a view transition), so the motion switches apply. On a phone it fits the width, with 44px targets.

Display rules:
- A meeting row shows no notes; meeting mode lists them all, newest first.
- On All and in a room's stream, a linked note shows a chip naming its meeting, which opens meeting mode.
- A note's legacy `phase` (`pre` / `post`, from #163 or older imports) is kept, exported and imported unchanged, but never shown: those notes list with the rest.
- Claude summaries of a meeting include all its linked notes, each labeled `[note]`.
- Deleting a meeting keeps the notes; the chip disappears because the lookup fails.

Meetings are created from a room's Schedule meeting (the project, or the person as an attendee, preset), Today's Add meeting (the day shown preset) or ⌘K → New meeting (project picker, General allowed). Required: title and date. Editing re-opens the same form; deleting asks for confirmation. Creating, editing, and deleting log activity on the meeting's project (or General).

### Room and meeting actions

A room's header and meeting mode put their actions the same way: the main buttons (Pin, Schedule meeting, Edit; in meeting mode Join and Edit), then **More** (⋯, "More actions") with the rest, the less common first and **Archive** or **Delete** last after a rule (Delete in the destructive color). An action that does not apply is left out of the menu. Every header button and menu row is 44px on touch. The panels keep their footers.

### Meeting mode

Each meeting opens in **meeting mode** (#336) at `/meetings/<id>`, titled with the meeting's title. It replaced the classic meeting page and its old Prep and Debrief split: before the meeting, while it runs and after it are the same screen. It sits in the app's frame like any other page, with the rail, top bar and tab bar. Everything that opens a meeting goes there: the title on a row, a calendar chip, a timeline entry, Today's Next up, a room's Next meeting, ⌘K, a note's meeting chip and an org's meetings. `/meetings?meeting=<id>` and `/events?event=<id>`, the addresses that used to open the row, redirect to it.
- **Header**: the phase (**Prep** before it, **Live** while it runs, **Debrief** after it; on its day an untimed meeting is Live all day, and one with a start and no end is taken to run an hour); the title; **Join** (the meeting's link, when it has one), **Edit** (the meeting form) and **More** (⋯): **Summarize**, **Carry forward** to the next meeting of the series (when it applies; see below) and, after a rule, **Delete** (asks in place, keeps the notes and the action items, then leaves); and **Leave**. Then the day and times, the room (the project, a link, or General) and the attendees, each a link to their room; then **Previous** and **Next** in the series, by day.
- **Leave** (or Esc, when you are not typing and no panel, dialog or menu is open) goes back to the page meeting mode was entered from, or to Today. Moving through the series keeps where Leave goes. In the note composer, Esc first steps out of it.
- **Agenda** (left): the meeting's own agenda text, its **Topics** (see below) and **Carry forward n topics from <day>**, when the last meeting of the series has uncovered topics this one lacks.
- **Notes** (middle): the full composer, always open (Save note or ⌘Enter; it keeps its draft and does not ask on a click away, but leaving with something written asks), then each saved note, newest first, as the compact note row. `/task` in the composer, and **Make task** on a saved note, make an action item of the meeting.
- **Action items**: under the notes (see [Action items](#action-items)).
- **Open loops** (right): for a 1:1 (exactly one attendee besides you), that person's open loops (`taskTouches`); otherwise the meeting's project's; with neither, a line saying there are none to show. They are Today's three lanes, in the order Today keeps them.
- Above 820px the agenda is on the left with the notes beside it and the open loops under the notes; from 1280px the open loops get a column of their own. On a phone everything stacks in that order.
- **Settings → Today → Meeting mode** (#313, #343) can hide Topics, Action items, Notes or the series links, and covered topics and done action items. The order of those sections no longer applies.
- An unknown id shows Not found with Go to Today.
- **New meeting**: a room's Schedule meeting, Today's Add meeting or ⌘K → New meeting opens the meeting form.

### The task panel everywhere

A task opens in its panel from every page (#329): the lanes, Today, the rooms, All, a note's task chip and ⌘K. There is no task page; `/tasks/<id>` lands on the task's room (its project's, or Today for a General task) with its panel open, and `e` on a row opens the panel.

### Topics and carrying forward

Added in the rebuild (M11). A meeting's agenda as a list of topics (see [Topic](#topic-embedded-in-meetings)), beside its free-text note.
- **In meeting mode and in the meeting's panel** (a row on All shows only the count, "2 of 4 topics"; covered of all; counts do not animate): each topic has a checkbox (covered), its title (click to edit; Enter saves, Escape cancels), its outcome (muted, when set; click to edit), an **Outcome** button that opens a one-line input, and a menu: **Make a task**, **Move up** / **Move down** and **Delete**.
- **Reorder**: drag the handle with a mouse (desktop); on touch and keyboard, Move up / Move down in the menu or Alt+↑ / Alt+↓ on a topic. Each move is announced.
- **Delete** has no confirm step; the toast's Undo puts the topic back where it was, with its checkbox and outcome.
- **Make a task** opens the new-task panel with the topic's title, as an action item of the meeting (see [Action items](#action-items)). It does not change the topic.
- **Topics section** (meeting mode's left column; above Notes in the panel), laid out like Notes: the heading, the count ("1 of 3 topics") and an **Add topic** button, which opens an inline one-line field (Enter adds and keeps the field open for the next; Escape closes it and returns focus to the button; pressing Add topic again goes back to the field). With no topics and the field closed it reads "No topics yet". On an **existing** meeting every change is an op at once, as the meeting's notes are, not on Save. On a **new** meeting, which has no id yet, each Enter adds a pending topic (shown with a **Remove** button); on save they become `addTopic` ops in the same batch as `addMeeting`. More than 50 topics in all (the carried ones counted) is refused as you add, and again on save.
- **Next up and Calendar**: Today's Next up lists the open topics; a chip on All's meeting calendar shows the count ("1/3", read as "1 of 3 topics").

**Carrying forward.** There is no recurrence model. Two meetings are in the same **series** when they have the same project, the same title (trimmed, any case) and the same attendees (in any order); earlier and later are by day, then time.
- **New meeting.** When the form's project, title, attendees and day match an earlier meeting in the series, the most recent one is taken; if it has uncovered topics, a line "Carry forward n topics from <day>" with a checkbox (on by default) appears above Topics, the titles muted under it. On save the copies (new ids, not covered, no outcome, `carriedFrom` set) go into the same batch as `addMeeting`, before any typed ones, and count toward the 50. This path only copies: the earlier meeting's topics stay as they are.
- **Carry forward** in an existing meeting's row menu and in meeting mode targets the **soonest later** meeting in the series, and shows only when this meeting has uncovered topics that the target does not already have by title (any case). It copies those there and marks them covered here with the outcome "Carried forward", in one batch; titles the target already has are skipped, so carrying twice, or after creating a meeting with carried topics, adds nothing. The toast says "Carried n topics to <day>"; its Undo restores both meetings.
- A carried topic's `carriedFrom` is the day it was first raised: a copy of a topic that was itself carried keeps the original day. The topic shows "from <day>" muted beside its title (read as "carried forward from <day>").

### Milestones

Milestones are added, edited and deleted only in the project room's Plan tab: a title and a date (the shared date field, so `fri` and `+3d` work); Enter adds and keeps focus in the title, Esc clears. Edit changes title and date in place (Enter saves, Esc cancels). Delete has no confirm step; the toast offers Undo, which re-adds the milestone with the same id. Each change logs activity on the project. A milestone shows in the room's state line (the next one on or after today), in its stream, on All's projects timeline as a point with its title and day on hover or keyboard focus, and in the week's digest (the digest week and the 7 days after it). Clicking one opens the Plan tab with `?milestone=<id>`, which scrolls to the row and highlights it. Search does not index milestones. A project has at most 50.

## Lists (retired)

Lists (#298 to #302) were titled checklists with pages of their own, a section on the project page and New list in + and ⌘K. v2 retired them, data kept (#328): each list became a checklist note on the same project (see [List](#list)), which ticks in place on Scratch, in a room's stream and on All. `/lists` and `/lists/<id>` land on All's notes. Nothing in the app shows the `lists` collection; it stays in the data and the export, and its ops still reduce for old clients. MCP's list tools answer with an error for one release.

## Whiteboard

Every project has a whiteboard (the Whiteboard tab of its room), and each space has one of its own (`/whiteboard`, linked from All's header). ⌘K → Open whiteboard opens the one for where you are.
- **Tools:** Select (V), Sticky (S), Text (T), Rectangle (R), Arrow (A), Pen (P), Eraser (E); 1–5 pick a color. Stickies, text and rect labels are edited in place (double-click or Enter). An arrow end dropped on a sticky or rect snaps to its nearest edge and follows it. The eraser removes ink strokes. `]` / `[` bring to the front / send to the back; Delete removes (toast Undo).
- **View:** pan with scroll, Space+drag or two fingers; zoom with ⌘-scroll, pinch or the zoom controls (Fit, 100%). The viewport is remembered per board on the device, not synced.
- **Undo:** ⌘Z / ⇧⌘Z (and the Edit bar's buttons) undo and redo this session's changes on the open board; the stack clears on leaving.
- **Ops:** `addBoardItem`, `editBoardItem` (text, color, size), `moveBoardItems` (places, and arrows' points), `raiseBoardItems`, `lowerBoardItems`, `deleteBoardItems`. Board ops are silent in Activity except one line a day: the first item added to a project's board on a day logs "Drew on the whiteboard". The space's board logs nothing.
- **Search:** sticky, text and rect labels are indexed under Whiteboard; a result opens its board with `?item=<id>`, which selects the item, centres it (at least 100%, never cut off) and focuses it, then drops the key. An id that is gone just opens the board.
- **Export:** the board's menu (⋯ in its header) has Download as PNG and Download as SVG, named `<board name>-whiteboard.png|svg` (the project's name, or the space's). The SVG is built from the items, cut to the drawing plus a 24-unit margin, on the theme's background, with every token resolved to the current theme's value (stickies' `color-mix` in oklab included) and text as wrapped SVG `<text>` in a system font, so it renders on its own anywhere. The PNG is that SVG drawn on a canvas at 2× (less when a side would pass 8 192 px). No grid, no selection; nothing leaves the device.
- Moving a project to another space takes its board; deleting it deletes its board.

## Claude summaries

A **Summarize** action exists in a project's and a person's room (#339), on a task (panel footer), on a meeting (meeting mode's More menu, #339, and a meeting row on All) and on the week's digest (Today's week zoom). Summarizing a single note was dropped in #339: rooms and meetings cover it. A room's summary is one or two sentences on where things stand, and meeting mode's a short recap; both show in a card under the header (Stop, Regenerate, Save as note, Dismiss) rather than the panel, and each has its own prompt (`ROOM_PROMPT`, `RECAP_PROMPT`). It is hidden while summaries are off on the device. In the artifact this uses the viewer's own Claude account through the platform's `sample` capability; in a standalone app it becomes a server-side call to the Messages API with the same prompt and context.

**Flow.** Click opens the side panel titled `Summary · <item>` showing "Thinking…", with Stop, Copy (disabled until text arrives), and Save as note. Output streams in and is rendered with the markdown subset. On completion Stop is disabled and Copy / Save enable. Closing the panel aborts the request. Errors: `not_granted` hides the feature for the session; `canceled` keeps partial text and appends "Stopped."; `rate_limited` shows a toast; anything else shows partial text or a one-line failure message.

**Save as note** writes a note to the item's project (or General) with body `Summary of <item>` (a person's room as `Summary of @Name`, so the note mentions them and files to their room) followed by the markdown, converts any `@Name` back to mention tokens, links it to the meeting when summarizing a meeting, and logs activity.

**Context assembled per item** (plain text, labeled sections):

| Item    | Included                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project | name, org, status, priority, target date, team names, description; open tasks with priority/due/assignee/details; last 15 done tasks; milestones by date; all meetings (with "n of m topics covered" when a meeting has topics); last 20 notes newest first; last 25 activity lines |
| Task    | title, project, the meeting it is an action item of, status, priority, due, assignee, tags, details, link labels, source note body if any, its running notes oldest first (the last 20)                                                                                             |
| Meeting | title, date and times, project, attendees, agenda note, topics in order (`- [x] <title> — <outcome>` once covered, `- [ ] <title>` otherwise), action items (`- [ ]` open, then `- [x]` done, with due, assignee and when closed), the latest 6 linked notes, oldest first; every section capped (`MEETING_LIMITS`)|
| Room    | the project or person (and what it is narrowed to), today, the state line as the room computes it; the three lanes as the room labels them (a person's with the open topics of their meetings ahead); what is coming up (meetings, milestones); the stream's last 14 days, newest first. Every section capped, the whole within `ROOM_BUDGET_CHARS` |

Mentions are expanded to names before sending. Nothing outside the item (or the room) is included.

**Prompt** (single user turn; context appended after two newlines):

> You are summarizing one item from a personal project tracker used by an engineering leader. Write a concise summary in plain markdown using short paragraphs and "- " bullets (headings, if any, as "### "). Structure: a 1–3 sentence overview; then bullets for key points; then "Open items" and "Suggested next steps" when the data supports them. Be specific, keep names and dates, do not invent anything not in the data, and stay under 220 words.

Model tier is the default (not the quick tier); the artifact caches identical requests for five minutes.

**Brief me** (#259, #332, Today). The same model, flow (consent, loading, streaming) and request settings, with its own target kind (`brief`) and prompt, shown as a card on Today rather than the panel. Its title is `Brief · <day>`; it streams (the text announced politely once it settles), with Stop while it runs, then **Regenerate**, **Save as note** (a General note whose body is `Brief · <day>` then the text, mentions back to tokens, logging "Saved a summary as a note") and dismiss. The finished text is kept on this device per space and per day (`datapad:brief`, per space by `keyFor()`), so Today shows it again the same day without running the model; a new day, Regenerate or dismiss replaces it, and it is never synced (Save as note keeps it). Leaving Today stops a run. Nothing generates on load or on a schedule.

Its context (`briefContext()` in `shared/summaries.ts`) is plain text in labeled sections, mentions as names, archived projects out, everyone's tasks: the day; then, from `buildRecap()`, Tasks closed, Tasks added, Meetings held (with "2 of 3 topics covered · 1 action item · 1 note"), Notes written (first lines) and Other changes (activity); then Today: Agenda (today's meetings with their prep line, and milestones), Due (overdue and today, not blocked, with priority and assignee), the three lanes (My open tasks, Waiting on others by person, To decide) and Projects that need attention. An empty section says "none". Each is capped (`BRIEF_LIMITS`: 8 closed, 5 added, 5 meetings held, 5 notes, 6 activity lines, 6 agenda items, 8 due, 4 people waiting, 5 projects; titles cut at 60 characters, names at 40), then "and N more", so the prompt and context stay under 8,750 characters (about 2.5k tokens) whatever the data, inside the model's 4,096-token window with the 900 of the answer.

**Brief prompt:**

> You are writing a morning briefing for an engineering leader from their personal project tracker. Write one short paragraph about what happened since the last working day, then one short paragraph about what today holds, then up to 3 "- " bullets for what to do first. Plain markdown, no headings. Keep names, dates and counts exactly as given, do not invent anything not in the data, skip a section that says "none", and stay under 150 words.

## List toolbar

All (#337) and Settings → People and Orgs share one toolbar (#269): **Find** first, then the filters, then **Sort**, then **Clear filters** while anything is filtered.

- **Find** searches what the page lists (its placeholder says what). The
  text reaches the address (`?q=`) 150 ms after typing stops, replacing
  the entry rather than adding one, and is never saved with the page. A
  clear button (×, 44px on touch) empties it. `f` anywhere on the page
  goes to it; Esc in it clears it, then leaves it.
- **Filters** are All's controls that narrow the list (Room, Person,
  Status, Due, Tag, To decide or Waiting on, as the kinds picked allow).
  The layout and Sort arrange the list rather than narrow it.
- **Clear filters** shows while a filter is away from its default or Find
  has words. It puts the filters back to their defaults and empties Find;
  the kinds, layout and sort stay as they are.
- **Empty states** have one shape: with filters or Find on, "None match
  these filters." and Clear filters; otherwise the page's own words.
- **Desktop**: one row that wraps. **Phones**: Find full width and a
  **Filters (n)** button, n being the filters away from their defaults
  (not Find, not the sort), that opens a bottom sheet with the filters
  and Sort, Clear filters and Done.
- **People and Orgs** (Settings, #272) have Find alone, so no Filters
  button. People finds by name, role or an org that lists them as a
  contact; Orgs by name, kind or notes (mentions read as names).
  `findPeople()` and `findOrgs()` (`shared/people.ts`, `shared/orgs.ts`)
  do the matching.
- Today is not a list and has no toolbar.

`activeFilterCount()`, `isFiltered()` and `clearFilters()` in
`shared/pages.ts` decide the count, Clear filters and the empty state
from the page's `PAGES` entry, so they agree.

## Page preferences

Added in the rebuild (#186). Today, All and the rooms remember how you left them: Today's zoom and its lanes open or closed, All's layout per kind, its sort and its saved views, a room's lanes open or closed (one set for every project room and one for every person room). Never the search text, and never an id that points at one item (`?note=`, `?milestone=`, `?to=`).

They are stored with the space's data (`settings.user.pages`), so they follow you to every device and come along in exports; each space has its own. Changing a control updates the address and saves the preference; quick changes go out together after half a second. The address wins key by key, then what is saved, then the page's defaults: a link or Back shows what it names, and a bare address shows the saved settings without rewriting it. Before a change pushes a new history entry, the entry being left is given what it showed, so Back returns to it. A page reads what is saved once, when it opens with the server's state. A saved value the page no longer has is ignored, and the page shows its default.

The classic pages' keys (`projects`, `archive`, `tasks`, `meetings`, `notes`, `lists`, `people`, `task`, `list`) stay in `PAGES`, marked retired, so saved data still parses; nothing shows them. Settings → Pages (#186–#313) is gone: `/settings/pages` opens Settings → Today, and its options moved to the sections below.

## Settings (v2)

Settings for v2 (#343). Each section has its own address (`/settings/<section>`), at desktop and phone width, in this order: Appearance, Today, Rooms, Capture, All, Templates, Summaries, Spaces, People, Orgs, Data, Connected apps, Account (`SETTINGS_SECTIONS`). Every change saves at once.

| Section | What it sets |
| --- | --- |
| Appearance | Theme, Time (12- or 24-hour) and Motion, per device. |
| Today | **Mine shows** (Mine and unassigned, or Only assigned to me), **Next up looks ahead** (3, 5, 7, 10 or 14 days), **Week starts on** (Monday or Sunday: the week zoom's first day, and the recap's weekend is the two days before it), **Brief me** (On or Off: the button and card on Today), the lanes (Mine, Waiting on, To decide) shown and in what order, and **Meeting mode**: its sections (Topics, Action items, Notes, Series) shown or hidden, in meeting mode's own order, and covered topics and done action items shown or hidden. Saved under the `focus` and `meeting` page keys, so what Focus and the meeting page saved carries over. MCP's `get_focus` and `get_recap` read the same saved options. |
| Rooms | The pinned rooms in the rail's order (Move up, Move down, Unpin); **People who owe you** in the rail (on by default); a project room's lanes (Mine, Waiting on, To decide) shown and in what order, saved under the `project` page key; **Project rooms open on** (Stream, Plan or Whiteboard: where the rail's rooms, All's project rows and rooms, and Search open a project; other links open Stream); the person room's lanes shown and in what order (the `person` page key) and their **names** (You owe, They owe you, To discuss; empty keeps the name; the person room shows them, #335). |
| Capture | **A plain line becomes** (a note, the default, or a task; `todo`, a date and the other words still win), **@Name assigns a task** (on by default; off, the person is only mentioned), **New task priority** (Medium by default; every way of adding a task uses it), **New tasks are due** (No date, Tomorrow, In 3 days, In a week (the default) or In 2 weeks; every way of adding a task uses it when no date is given), **A note in a room goes to** (the room, the default, or Scratch; tasks always file in the room, and a `#word` still files a note). |
| All | **Opens on**: the kinds the rail's, the tab bar's and ⌘K's All open on (Tasks by default; none picked is every kind); each kind's layout; the sort tasks and projects alone start with; the saved views, renamed in place, moved up or down, or deleted with Undo. |

**Defaults.** Every option has one default in `shared/`: the space-wide ones in `DEFAULT_SETTINGS` (`shared/types.ts`, read through `settingsOf()`), each page's in `PAGES` (`shared/pages.ts`), and Appearance's in `DEVICE_DEFAULTS` (`shared/settings.ts`). A fresh space works with no setup: nothing pinned (the rail lists the active projects), a plain line a note, `@Name` assigning, Medium priority, room notes in the room, All on Tasks. Stored settings hold only what was changed; `setSettings` with `null` clears an option back to its default.

**Reset to defaults.** Appearance, Today, Rooms, Capture and All each have one, disabled at the defaults, with Undo (`resetSection()` in `shared/settings.ts`). Today's resets Today and meeting mode; Rooms' unpins everything and resets the project room's lanes; All's keeps the saved views, which are the owner's rather than settings.

**Carried over.** Focus's saved settings are Today's (the same `focus` key). The old Tasks, Meetings and Projects pages' saved layouts and sorts that All has become All's (`migrateSettings()` in `shared/migrate.ts`, on import and once per space as the Durable Object's schema goes to 5), in a space that saved nothing for All yet. The retired pages' saved settings and the old navigation preferences stay in the data and the export, read by nothing.

The first time a space with no saved preferences opens in a browser that remembered choices before #186 (`datapad:view:*`, `datapad:focus:*`, `datapad:section:*` in `localStorage`), those are saved once as its preferences; a project page's sections, kept per project before, become the one set, closed where most projects had them closed. After that `localStorage` is not read for them.

## Persistence, sync, import/export

**Store shape.** In-memory state is `{projects, tasks, notes, people, activity, meetings}`, each a map by id. All views are pure renders of that state; the whole main region re-renders on every change (cheap at this scale; a rebuilt app should use a reactive store).

**Write path.** `write(col, id, doc)` applies optimistically to memory, re-renders, then persists; `remove(col, id)` likewise. Failures toast and the next snapshot corrects the view. Whole-document writes only.

**Backends.** The artifact subscribes to each of the six collections on a per-artifact realtime document store and treats a snapshot as the source of truth. When that store is unavailable it falls back to `localStorage` under `ledger:v1` with the same shape. On first sync, if local data exists and the remote store is empty, the user is offered a one-time migration. A rebuilt app should keep this split: one storage interface with a local adapter (offline, tests) and a remote adapter.

**Read-only.** If the platform reports the viewer cannot write, `readOnly` hides every mutating control (quick-adds, buttons, composers, drag) and shows a banner; Summarize remains available.

**Export** writes `{exportedAt, projects, tasks, notes, people, activity, meetings}` as pretty JSON named `ledger-YYYY-MM-DD.json` through a download, falling back to the clipboard. **Import** reads such a file, confirms, and merges by id (same id replaces). This JSON is also the migration path from the artifact to the new app; the artifact's file has the older typed collection in place of `meetings`, and import migrates it.

**Caps to respect** when designing the remote store: documents under 256 KiB (activity logs are capped at 150 entries for this reason), collections scanned without indexes (keep to low thousands of documents), last-writer-wins with no transactions.

## Connected apps (MCP)

Added in the rebuild (M14, #152–#154): Datapad is an MCP server at `/mcp` (docs/mcp.md). Claude Code, Claude Desktop or a claude.ai connector signs in through Access and a consent page (read always, write if ticked), then reads through typed tools and, with write, adds and edits through tools that each send one op through `reduce()`, exactly as the app does, so open tabs update live. Nothing can be deleted, archived, erased, imported, restored, moved between spaces, or changed in settings from MCP.

**Settings → Connected apps** (`/settings/connections`, between Data and Account) lists the apps you approved, newest first: the name each gave itself, Read only or Read and write, Connected (relative), Last used (or Not used yet), and when its grant expires. **Revoke** asks first in a plain dialog (no typed name; Undo is not possible) and stops the app at once: its next call is refused and it must connect again. Grants are per email, not per space. Above the list: the `/mcp` address to add. On phones each app is a row that wraps; Revoke keeps a 44px target.

## Spaces

Added in the rebuild (M9). A space is a complete, separate Datapad under the one signed-in user: its own projects, tasks, notes, meetings, people, orgs, templates, settings and activity (and any retired decisions). Nothing is shared or searched across spaces; every view, count, summary and ⌘K result is the open space's.

| Topic     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model     | `{id, name, position, createdAt}`. Every user starts with Main (`main`), which holds any data from before spaces. Names are trimmed, not empty, at most 40 characters and unique ignoring case; at most 12 spaces. `position` is the switcher order.                                                                                                                                                                                                                                                                                         |
| Switching | The rail header (desktop), the account menu (every width; the switcher on phones) and ⌘K list the spaces; the rail and ⌘K have New space…, and the rail Manage spaces. The account menu only switches (#159). The choice is remembered per device, not in the URL. Switching from a room, a project's whiteboard or an org goes to Today, and from meeting mode to All's meetings; other pages stay. The page and rail crossfade. With more than one space, the tab title carries its name ("All · Personal · Datapad").                                                                     |
| Settings  | Settings → Spaces (`/settings/spaces`) lists them in switcher order: rename in place (Enter saves, Esc or leaving the field reverts), Move up / Move down, New space, Delete…. Settings → Data acts on the open space: Export <space>, Import into <space>, Backups of <space>.                                                                                                                                                                                                                                                              |
| Moving    | Move to… on a project page (with more than one space). The project goes with its tasks (action items among them, linked to its meetings), notes, meetings (with their topics), milestones, activity log and any retired decisions; the people it refers to and its org are copied, and the source keeps its copies. A same-named org in the target is reused; a copied person is not `me` if the target has one. The log gains "Moved from <space>". One transaction across both spaces; not undoable from the toast, but moving back works. |
| Deleting  | Delete… asks for the space's name typed exactly, then deletes it with a one-time token issued for that space (good for five minutes). The last space cannot be deleted; Main can, once another exists. Tabs open on it go to the first space left. Its nightly backups stay in R2 but are no longer listed in the app.                                                                                                                                                                                                                       |
| Backups   | Nightly, per space, 30 kept each: Main at `<email>/datapad-YYYY-MM-DD.json` as before, others at `<email>/<spaceId>/datapad-YYYY-MM-DD.json`.                                                                                                                                                                                                                                                                                                                                                                                                |

## The shell and pinned rooms

v2 (#329) replaced the type-by-type navigation with three places and the rooms. Settings → Navigation (#187) is gone; its saved `nav` prefs are kept as stored, an old client's `setNav` still reduces, an old export still imports, and nothing reads them.

| Part      | Behavior |
| --------- | -------- |
| Rail      | Desktop (≥ 820px): the space switcher; **Today**, **Scratch** (with how many notes have no home) and **All**; then **Rooms** (with a **+** beside the heading that adds a project or a person, shown even with no rooms): the pinned rooms in your order, or, before anything is pinned, the active projects (not archived, not done, not hidden with **Hide from rail** in the room's menu, which also unpins it), most recently changed first, each with its open count; then **Waiting on**: up to five people who owe you something (Today's Waiting on lane by person, `owedBy()` over `lanesOf()`: an open task not to decide, blocked on them, or assigned to them and not to you, outside archived projects), most first, until they are pinned; the sync status at the foot. |
| Tab bar   | Phone: Today, Scratch, **Rooms** and All, in four columns, 44px targets. Rooms opens `/rooms`, the rail's Rooms and Waiting on as a page (the same rows, order, counts and Settings → Rooms options, from `useRooms()`), in 44px rows, with the rail's **+** beside its Rooms heading and a link to All's projects and people below; with nothing to list it points to the + and to All. The Rooms tab stays current inside any project, person or pair room (`placeOf()`). `/rooms` renders on desktop too; the rail has no Rooms row. |
| Addresses | `/` Today, `/scratch`, `/rooms` (the phone's Rooms tab), `/all` (`?kind=` one or more of `task`, `note`, `meeting`, `project`, `person`, comma separated; its filters and sort after it), `/projects/:id` and `/projects/:id/whiteboard`, `/people/:id` (a person's room, #335: You owe, They owe you and To discuss beside their stream; `?project=` narrows it to one project, the same items as `/projects/:id?person=`), `/meetings/:id`, `/whiteboard`, Settings and Help. |
| Redirects | `/focus`, `/digest` and `/decisions…` go to `/`; `/notepad` (and `/notes?view=notepad`) to `/scratch`; `/unfiled` (Scratch’s old name) to `/scratch`; `/projects`, `/tasks`, `/notes`, `/meetings` and `/events` to All with that kind, their filters as All reads them; `/archive` (and #329's `/all?archived=1`) to `/all?kind=project&status=archived`; `/lists` and `/lists/:id` to `/all?kind=note`; `/meetings?meeting=<id>` and `/events?event=<id>` to that meeting; `/tasks/:id` to the task's room (its project's, or Today for a General task) with its panel open; `/settings/people/:id` to `/people/:id`; `/settings/navigation` to `/settings/rooms`. `landRoute()` in `shared/routes.ts` holds them all. |
| Pin       | **Pin** in a project's or a person's room header pins it (at the end) or unpins it; the rail follows at once. |
| Settings  | Settings → Rooms (`/settings/rooms`) lists the pinned rooms in the rail's order, each with **Move up**, **Move down** and **Unpin**, then the projects hidden from the rail, each with **Show** (`hiddenRooms`; pinning a hidden project shows it too), then the rooms' options (see [Settings (v2)](#settings-v2)). |
| Top bar   | On desktop, **Back** and **Forward** (this tab's history in the app, each disabled with nowhere to go; not on phones), then the page title, the sync status, Search and the account menu (Help, Settings, Sign out). The + menu is gone (#341): see **Adding** under [Interactions](#interactions). |
| Stored    | `settings.user.pinned`: an array of entries, each once, at most 50, absent until something is pinned, written whole by `setSettings { patch: { pinned } }` (not logged). An entry is a project id, a person id, or `<projectId>+<personId>` for a project seen through one person (#334, #335): pinned from either room it is one pin, and the rail opens the project room narrowed to the person. One that names nothing in the space is skipped when read and kept until unpinned. `shared/rooms.ts` reads them. |

## Activity log

One log per project plus one for General. Entries are `{t, text}`, prepended, capped at 150; the project room's Plan tab shows the latest 40 in a collapsed Activity section.

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

Pinning a note, reordering tasks, and editing, ticking or reordering topics are not logged. The log feeds the week's digest under Today's week zoom.

## Today

Today (`/`, #331) replaces Focus: one day at a time, with the open loops beside it. `shared/loops.ts` and `shared/today.ts` hold the rules; the rooms (#334, #335) and MCP (#340) reuse them.

| Part | Behavior |
| ---- | -------- |
| Header | "Today" (or "Looking back", "Looking ahead"), the long day, then one line: "2 meetings, 3 due, 4 waiting on others, 1 to decide" (the day's meetings, what `dueOn()` gives, and the lanes' counts). **Previous day**, **Today** and **Next day** step through the days; the day is kept as an offset from today, so it rolls over at midnight. With a recap to show, today's line is followed by the recap's own line ("Yesterday: 1 closed · 2 added · 1 meeting"), a link to the last working day. **Day** and **Week** switch the zoom (#332, below); **Brief me** sits beside them on today. |
| Capture | The capture line (#330). |
| Next up | On today, the next meeting from now (`nextMeeting()`): one going on counts, an untimed one today counts all day, untimed first on a day, within the days Settings → Today says (7 by default). Its title, when, its project, attendees and open topics, and **Enter meeting**, which opens meeting mode (#336). |
| Due | "Due today or late" on today (open tasks due today or earlier), "Due" on another day (due that day); live projects only, by due date then manual order. Task rows as everywhere. |
| High priority | On today only, the open high-priority tasks in live projects not already under Due (`highPriority()`), by due date then manual order. Hidden when there are none. MCP's `get_today` returns the same list as `highPriority`. |
| Timeline | `dayEntries()`: the day's meetings (untimed ones first, as All day), the tasks added and the tasks done that day (a task can be both) and the notes written that day, each at its local time, archived projects left out. On today a Now line sits at the current minute and the meetings that are over are muted. A day with nothing says "Nothing on this day." **Add meeting** beside the heading opens the meeting form on the day shown. |
| Brief me | On today, with summaries on and a browser that can run the model: the brief card above the timeline (#259). Its context (`briefContext()`) is the recap, today's agenda, Due, Today's three lanes (My open tasks, Waiting on others, To decide) and Attention, with the saved settings. |
| Recap | `buildRecap()` (#258), as MCP's `get_recap` reads it with the saved Mine shows: above the timeline on each day of its window (yesterday, or Friday through yesterday after a weekend; a day earlier when Settings → Today starts the week on Sunday), with Closed, Added, Meetings held, Notes written and the rest of the activity. |
| Week | `?view=week` (`v` cycles; `/digest` lands here): the Monday-to-Sunday week around the day (`weekDays()`), seven columns on desktop and seven rows on phones. Each day has its meetings (linking to them) and its counts of due, done and notes; its name zooms into the day, and arrow keys, Home and End move between the days. The header reads the week's span and "3 meetings, 4 due, 5 done, 2 notes"; Previous and Next step a week. Under the days, the week's digest (`buildDigest()` for the week ending its Sunday, the text `get_digest` returns for that day) with **Copy as Markdown**, **Save as note** and, with summaries on, **Summarize**. The lanes are left out at this zoom. |
| Scratch card | How many notes have no home yet, linking to Scratch. Hidden while Scratch is empty. |
| Lanes | `lanesOf()`: every open task in a project that is not archived (or General), split three ways. **To decide**: marked to decide (`decideOf`). **Waiting on**: blocked on someone, or on no one listed ("Not on anyone", last), or assigned to someone other than you; grouped by that person, most first, the name linking to their room. A task blocked on you is yours. **Mine**: the rest, yours or no one's. Each by due date (none last), then manual order. A row has its checkbox (closing it moves it out at once; the toast offers Undo), its title (opens the task panel), its room and person (linking to their rooms; you are not named) and its due date. Each lane collapses, remembered with the page. Desktop puts them in a right column; phones below the day. |
| Settings | Settings → Today (saved under Focus's `focus` key, so what Focus saved carries over): **Mine shows** (Mine and unassigned, or Only assigned to me; Focus's Tasks for), **Next up looks ahead** (3, 5, 7, 10 or 14 days; Focus's Week window), **Week starts on**, **Brief me** and the lanes, hidden and reordered. Focus's Attention and Follow-ups rules stay saved; Brief me still reads Attention's. MCP's `get_today` (and `get_focus`, its alias, #340) reads Mine shows and Next up as Today does, and `get_recap` Week starts on. See [Settings (v2)](#settings-v2). |

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

**Layout.** Desktop: 232px rail + fluid main, content max-width 1040px; Today's and a room's lanes sit in a column beside the day or the stream. Breakpoint 820px: rail hidden, bottom tab bar, single column, task rows at least 44px tall. Safe-area insets respected top and bottom. Reduced-motion disables transitions. Visible focus rings in accent.

**Copy.** Sentence case, plain verbs, buttons name the action ("Add task", "Create project", "Save as note"). Empty states tell the user what to do next. Typographic apostrophes and quotes in UI text.

## Rebuild recommendations

Keep the product exactly as specified above and change only the plumbing.

**Stack.** React + TypeScript + Vite, Tailwind v4, shadcn/Base UI for panels, selects, and the command palette (the ⌘K palette maps cleanly onto `cmdk`), Tiptap on ProseMirror for the note editor. Keep it a PWA-capable SPA so it still works on the phone.

### Modules

| Module        | Responsibility                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/`      | TypeScript types for the six entities and Link; zod schemas for import validation                                                                                                                                                        |
| `store/`      | One store (Zustand or similar) holding the six maps; actions mirror `write`/`remove`; selectors for open counts, orgs, meId, buckets                                                                                                     |
| `storage/`    | `StorageAdapter` interface: `load()`, `subscribe(col, cb)`, `set(col, id, doc)`, `delete(col, id)`; adapters: `local` (IndexedDB via idb-keyval or localStorage) and `remote` (Supabase/Postgres, Firestore, or a small API over SQLite) |
| `markdown/`   | the line-based renderer and the `@{id}` ↔ `@Name` conversions; unit-test against the table in Mentions and markdown                                                                                                                      |
| `summaries/`  | context builders per item type (pure functions over state) and a server route that calls the Messages API with the prompt above and streams back                                                                                         |
| `views/`      | Today, Scratch, All, ProjectRoom, PersonRoom, MeetingMode, Settings                                                                                                                                                                      |
| `components/` | TaskRow, CaptureLine, NoteRow, NoteComposer (the Tiptap note editor: mentions, `/` menu, list continuation), MeetingRow, Milestones, SidePanel, Palette, Toast                                                                                                             |

**Order of work** (the rebuild's, before v2). 1) model + store + local adapter + JSON import so existing data loads on day one; 2) Projects, ProjectDetail, Tasks with quick-add and close; 3) Notes and mentions; 4) Meetings with prep/debrief, and milestones; 5) Focus, People, Search; 6) remote adapter and summaries; 7) polish items from Known gaps.

**Migration.** Export from the artifact (sidebar footer), import into the new app. Ids, mention tokens, and `order` values carry over unchanged. Keep the `links[]` field even though nothing writes typed links yet; it is where meetings and issues from external systems will attach.

**Auth.** Single user today. If the remote adapter is multi-tenant, scope every collection by owner and keep `readOnly` as the behavior for anyone without write access.

## Known gaps and deferred features

Shortcomings of the artifact that a rebuild should fix:
- The whole view re-renders on every change; fine at this size, wrong for a real app.
- Mention matching is by name at save time, so a person must exist before the note is written.
- Checklists in notes are display-only.
- Export relies on a platform download hook; make it a plain file download.
- No undo for close, delete, or archive.

Features discussed and intentionally deferred, roughly by value:
1. Project health flag (green / yellow / red) separate from status, shown on cards and filterable.
2. Weekly digest view built from the activity logs: per project, tasks closed, notes added, state changes.
3. Blocked / waiting-on flag on tasks with an optional person, surfaced on Today's Waiting on lane, grouped by that person with how long the oldest has waited.
4. Project templates: a saved kickoff checklist applied on project creation.
5. Reminders: in-app due reminders and an .ics export per task, meeting or milestone; true push notifications need a native or server component.
6. Snooze a task to a date; a per-project "next up" marker shown on the card.
7. Recurring tasks, subtasks, time tracking, and comments on tasks were considered and rejected for now.
