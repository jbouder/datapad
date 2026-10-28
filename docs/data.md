# Data

## The repository holds no data

This repository is public. It contains code, docs and fictional test
fixtures only. Never commit real projects, notes or people, and never
commit `.dev.vars`.

## Where your data lives

| What                                     | Where                                                                                                                                                                                                | Who can reach it                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Everything you enter                     | One SQLite-backed Durable Object in your Cloudflare account, named by your verified email, holding each of your spaces                                                                               | The Worker, only after verifying your Access sign-in |
| Nightly backups                          | The `BACKUPS` R2 bucket in your account, one folder per space (see [Backups](#backups)), latest 30 kept in each                                                                                      | You, through the Cloudflare dashboard or API         |
| Last snapshot, and changes not yet saved | IndexedDB in each browser you use (`datapad:snapshot`, `datapad:pending`), and the unsaved changes again in `localStorage` (`datapad:pending-now`); spaces other than `main` add `:<id>` to each key | That browser profile                                 |
| Which space is open                      | `localStorage` (`datapad:space`) in each browser                                                                                                                                                     | That browser profile                                 |
| Theme, motion and clock preferences      | `localStorage` (`datapad:theme`, `datapad:motion`, `datapad:clock`) in each browser                                                                                                                  | That browser profile                                 |
| A note you are still writing             | `localStorage` (`datapad:draft:…`) in each browser, until it is saved or discarded                                                                                                                   | That browser profile                                 |
| Where each whiteboard was left scrolled  | `localStorage` (`datapad:board-view:…`) in each browser                                                                                                                                              | That browser profile                                 |
| Summary model weights                    | The browser's cache, downloaded from Hugging Face after you agree                                                                                                                                    | That browser profile                                 |
| Summary model choice                     | `localStorage` (`datapad:summary-model`) in each browser                                                                                                                                             | That browser profile                                 |
| Summaries on or off                      | `localStorage` (`datapad:summaries`, `off` while off) in each browser                                                                                                                                | That browser profile                                 |

**Spaces.** Your object holds one or more spaces, each a complete,
separate Datapad: its own projects, tasks, notes, meetings, people, orgs,
decisions, templates, whiteboards, settings and activity. Nothing is shared between
them. Everyone starts with one, Main (id `main`); data from before spaces
is in it. You can have up to 12. Each browser remembers which space it
has open; the URL does not say.

Cloudflare Access logs record your email and sign-ins, by design. Worker
logs follow your account's Workers observability settings; the Worker logs
errors with the path only, never document content.

## What leaves your account

Nothing about your projects, tasks, notes, meetings or people.

**Summaries run on your device.** Summarize builds a plain-text context of
the one item (`shared/summaries.ts`) and hands it to a small language model
running in a Web Worker in your browser (WebLLM, on WebGPU). The context
and the summary never leave the tab; a summary is stored only if you press
Save as note, and then like any other note.

The only thing downloaded is the model itself: its weights from Hugging
Face (about 1 GB for the default Qwen3 1.7B) and its WebGPU library from
`raw.githubusercontent.com`, once, after you agree in the summary panel.
Those requests carry no referrer and nothing of yours. Settings →
Summaries picks the model and removes the downloaded weights again.

## Export and import

Export, Import and Backups work on the space you have open; Settings →
Data names it (Export <space>, Import into <space>, Backups of <space>).
The file format is the same for every space, so a file exported from one
space imports into any other. Over HTTP the scoped routes take
`?space=<id>`, and use `main` without one.

**Export:** Settings → Data → Export downloads `datapad-YYYY-MM-DD.json` (your
local date). If the browser cannot save a file, the JSON goes to the
clipboard instead. The same file is at `GET /api/export.json`.

**Import:** Settings → Data → Import… picks a file, checks it in the browser,
and asks before writing anything ("Import 14 projects, 212 tasks, …; same
ids are replaced"). The server checks it again and merges it in one
transaction: a document whose id you already have is replaced, everything
else you have stays. Repeating an import is safe. A file with any invalid
document is refused whole, with the first problem named
(`tasks › t-2 › due: …`); nothing is written.

### The format

The original artifact's export, extended, so its `ledger-*.json` imports
as it is (migrated on the way in, below):

```json
{
  "format": 1,
  "exportedAt": "2026-10-23T12:00:00.000Z",
  "projects": { "<id>": { "id": "<id>", "name": "…", … } },
  "tasks": { … },
  "notes": { … },
  "people": { … },
  "activity": { "<projectId>": { "events": [{ "t": "…", "text": "…" }] }, "general": { … } },
  "meetings": { … },
  "settings": { "user": { "defaultOrg": "Rebel Alliance", "pages": { "tasks": { "view": "board", "group": "due", "filters": { "status": "all" } } } } },
  "decisions": { "<id>": { "id": "<id>", "title": "…", "status": "decided", … } },
  "orgs": { "<id>": { "id": "<id>", "name": "…", "kind": "client", … } },
  "templates": { "<id>": { "id": "<id>", "name": "…", "tasks": [{ "title": "…", "priority": "high", "tags": [] }], "defaultTags": [] } },
  "boardItems": { "<id>": { "id": "<id>", "boardId": "<projectId>", "kind": "sticky", "x": 0, "y": 0, "w": 200, "h": 200, "z": 0, "color": "warn", "text": "…", "points": [] } }
}
```

- `format` (#240) is the file's format version, `1` today
  (`EXPORT_FORMAT` in [`shared/types.ts`](../shared/types.ts)); every
  export and nightly backup writes it. A file without it (the
  artifact's, or Datapad's from before #240) is legacy, read as before
  and migrated by its shape (below). A file with a higher `format` than this Datapad knows is
  from a newer version: Import and restoring a backup refuse it whole,
  before reading anything else, with "This file is from a newer version
  of Datapad (export format 2; this one reads up to 1). Update Datapad,
  then try again." A `format` that is not a whole number from 1 is
  refused as invalid. The number goes up only when a change would be
  misread by an older Datapad, and CHANGELOG.md says so under **Export
  format**.
- `settings` is Datapad's own (the artifact has none, and a file without
  it imports fine): preferences that follow your data, per space: the
  default org for new projects (none until you pick one in Orgs; a new
  space starts with no orgs) and, optionally, `nav`, the navigation
  preferences from Settings → Navigation (#187):
  `{ "order": ["focus", "notes", …], "hidden": ["meetings"], "extras": { "activeProjects": true, "digest": false, "archived": true }, "quickAdd": { "order": ["meeting", "task", "note", "project"], "hidden": ["project"] } }`
  (`quickAdd`, #201, is the top bar's + menu: `task`, `note`, `meeting`,
  `project`; an action it never names keeps its default).
  Every key is optional and `nav` is absent until you change something, so
  a file without it imports unchanged. Section names are kept as written
  and checked when read: an unknown one is ignored, and a section missing
  from `order` shows at its default place. `pages` (#186), also absent
  until something is saved, holds each page's layout, sort, grouping,
  filters and sections as you left them (never the search text); a file
  without it imports unchanged, and a value a page no longer has is
  ignored.
- `decisions`, `orgs` and `templates` are Datapad's own too (M7): the
  decision log, org records and templates. A template with `body`
  (Markdown, mentions as `@{personId}`) is a note template, with empty
  `tasks` and `defaultTags`; one without is a project template, as every
  template was before note templates. Decisions are retired
  (#183): the app no longer shows them, but the collection is still
  imported, exported, kept and moved with its project. A file without them imports fine; its projects' `org` text
  is kept, and Orgs offers to organize it into records
  (`project.orgId` links one). Deleting an org leaves the text. Projects may carry `health` and tasks `blocked`; both
  are optional and absent in older files.
- `boardItems` is Datapad's own (M12): whiteboard stickies, text, rects,
  arrows and ink strokes. `boardId` is a project's id, or `general` for
  the space's board; `points` (arrows and ink) are `[x0, y0, x1, y1, …]`
  relative to `x, y`; `color` is `neutral`, `accent`, `ok`, `warn` or
  `danger`. A project's items go with it when it moves to another space
  and when it is deleted. A file without them imports with empty boards.
  Sizes: at most `boardItemsMax` (2 000) items on one board,
  `boardTextMax` (2 000) characters of text on one, and `inkPointsMax`
  (1 000) coordinates in one ink stroke (the client simplifies a stroke
  until it fits). Board ops are silent in Activity, except the first item
  on a project's board each day ("Drew on the whiteboard").
- A whiteboard's own **Download as PNG / SVG** (its ⋯ menu) is a picture,
  not data: it is made in the browser from the items with the theme's
  colors resolved, and never sent anywhere. The JSON export above is the
  way to keep or move a board.
- Each collection is a map from id to document, fields exactly as in
  [SPEC.md § Data model](SPEC.md#data-model). An array of documents that
  carry their `id` is accepted too.
- Timestamps are ISO 8601, dates `YYYY-MM-DD`, times `HH:MM`; an empty
  string means "not set" for dates, times and the assignee.
- Mentions stay as `@{personId}` tokens; `order`, `sourceNoteId`,
  `meetingId` / `phase`, `archived` and `links[]` carry over untouched.
- `phase` (`pre`, `post` or null) is legacy: notes written with Prep or
  Debrief (#163) carry it. Since #167 the app neither sets nor shows it,
  but keeps it, so old files import and export unchanged and their notes
  list with the meeting's others.
- A note may carry `taskId` (#164): a running note on that task, in the
  task's project. It is optional: a file from before it imports
  unchanged, its notes without one (read as null), and an export writes
  it only on notes that have it.
- A note may carry `scratch: true` (#218): the space's Notepad, its one
  running General note. Optional: a file from before it imports
  unchanged, and an export writes it only on that note. An import that
  brings a second one keeps the older as the Notepad; the other loses the
  mark and stays an ordinary note.
- A task may carry `meetingId` (#185): an action item of that meeting,
  in the meeting's project. It is optional too: a file from before it
  imports unchanged (read as null), and an export writes it only on
  tasks that have it. Deleting the meeting sets it to null.
- A project may carry `milestones` (`[{ "id", "title", "date" }]`, by
  date, 50 at most); a deadline is its `targetDate`.
- A meeting may carry `topics` (`[{ "id", "title", "done", "outcome" }]`,
  in agenda order, 50 at most, outcomes 300 characters); a file without
  them, or from before topics (M11), imports with none. A topic carried
  forward from an earlier meeting also has `carriedFrom`, the day
  (`YYYY-MM-DD`) it was first raised; `done` and `outcome` may be left
  out and read as `false` and `''`.
- A file from before meetings (the artifact's, or an older Datapad
  export or backup) has `events` instead of `meetings`, and notes with
  `eventId`. It imports as it is, migrated on the way in
  ([`shared/migrate.ts`](../shared/migrate.ts)), by each entry's `type`:
  - `meeting`, `demo`, `other` or no type: a meeting, same id, the type
    dropped.
  - `milestone` or `deadline` on a project in the same file: a milestone
    on that project (same id, title and date). Its linked notes keep
    their text and lose the link (`meetingId` and `phase` null).
  - `milestone` or `deadline` in General, on a project the file does not
    hold, or on a project that already has 50 milestones: a meeting
    titled `Milestone: …` or `Deadline: …` (clipped to 200 characters),
    so nothing is lost.
  - `eventId` on a note becomes `meetingId`. Activity keeps its text.

  A file already in the new shape passes through unchanged, so running
  it twice changes nothing.
- Unknown keys are dropped. A field an older file lacks gets its empty
  value (`[]`, `''`, `false`, `null`); names, titles, meeting dates and
  timestamps must be there.
- Limits: [`shared/limits.ts`](../shared/limits.ts) (titles 200, bodies
  20 000 characters, 150 activity entries, 16 MiB per file).
  `test/fixtures/export.json` is a complete, fictional example.

### Moving from the artifact

1. In the artifact, use Export in the sidebar footer. You get
   `ledger-YYYY-MM-DD.json`.
2. Open Datapad, signed in as yourself. Settings → Data → Import… → pick the
   file → check the counts → Import.
3. Projects, tasks, notes, meetings, people and activity appear in every
   open tab at once. Archived projects stay archived.
4. Keep the artifact's file until you have used Datapad for a while; you
   can import it again at any time without making duplicates.

## Backups

Every night at `BACKUP_HOUR` in `BACKUP_TIME_ZONE` (3 AM America/New_York
unless you change the vars in `wrangler.jsonc`) your Durable Object's
alarm writes each space's export JSON to the `BACKUPS` R2 bucket (the
day in that zone), deletes all but that space's latest 30, and books the
next night. A space with no documents writes nothing.

```
datapad-backups/
  you@example.com/
    datapad-2026-10-24.json             main, where backups were before spaces
    <spaceId>/datapad-2026-10-24.json   every other space, in a folder named by its id
    before-erase-2026-10-28T14-05-09-120Z.json   the copy kept before a destructive change
```

**Before a destructive change**, the space's export is written to its
folder as `before-<what>-<time>.json`, where `<what>` is `erase`,
`delete` (deleting the space), `import` or `restore`. If R2 cannot take
the copy, the change does not happen. Nothing lists or prunes these files;
they stay until you delete them. An empty space has nothing to copy.

If a night is missed, the next time any tab connects writes one at once.

The alarm only adds to and prunes the bucket. It never changes or deletes
a document; the only way to delete your data is the erase below.

**Restore in the app:** Settings → Data → Backups lists the open space's
backups with their sizes. Download saves one; Restore counts what it holds, asks, and merges
it in one transaction exactly like an import: same ids are replaced,
nothing else is deleted. A document you created after the backup stays.

**Restore without the app** (say the Worker is broken):

```bash
npx wrangler r2 object get "datapad-backups/you@example.com/datapad-2026-10-24.json" \
  --file datapad-2026-10-24.json --remote
```

The file is an ordinary export: read it as JSON, or import it into any
Datapad through Settings → Data → Import… once the app is back.
`npx wrangler r2 object list datapad-backups --prefix you@example.com/
--remote` lists what there is, every space's folder included (or browse
the bucket in the dashboard). A space's id is in the `/api/spaces` list.

## Moving a project to another space

With more than one space, a project page's menu has **Move to…**. The
project goes with its tasks (action items keep `meetingId` when their meeting goes too), notes (its tasks' running notes among them, `taskId` kept), meetings (and their topics), milestones, decisions and
activity log (unlike deleting a project, its meetings and decisions go with it rather
than to General), and the log gains "Moved from <space>". The people it
refers to (members, assignees, who its tasks are blocked on, meeting
attendees, deciders, its org's contacts, and anyone @-mentioned in its
description, tasks, notes, decisions or the org's notes) and its org are
copied; the source space keeps its copies. If the target already has an
org by that name, the project joins it. A copied person is not "me" when
the target already has a "me".

Both spaces change in one transaction: the move happens whole or not at
all. It is not undoable from the toast; move the project back instead.

## Deleting a space

Settings → Spaces → Delete… asks you to type the space's name, then
fetches a one-time token for that space (good for five minutes) and
deletes the space and every document in it. The last space cannot be
deleted; Main can, once another exists. Every tab open on it is closed and
opens the first space left.

Its backups stay in R2, with a `before-delete-…` copy of the space as it
was a moment before: nothing prunes a deleted space's folder, but the app
no longer lists it. Restore one by hand (above) and import it.

## Deleting everything

- **One browser:** clear the site's data in the browser settings.
- **Your data, keeping the app:** there is no button for it on purpose.
  Ask for a confirmation token, then post it back within five minutes:

  ```js
  // In the browser console on the Datapad tab (you are already signed in).
  const { token } = await (await fetch('/api/erase-token')).json();
  await fetch('/api/erase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  ```

  Every document in that space (`main` here; add `?space=<id>` to both
  calls for another) is deleted and every tab open on it is sent the empty
  state. The space itself stays. The token works once; a wrong one uses it up. This is the
  only code path that deletes everything, and nothing runs it on a timer.
  The space's export is written to R2 first (`before-erase-…`, above).

- **Everyone's data, and the class:** add a migration to `wrangler.jsonc`
  that deletes the class, `{ "tag": "v2", "deleted_classes":
  ["DatapadObject"] }`, remove the `DATAPAD` binding and deploy. Cloudflare
  then deletes every Datapad object and its storage. Empty the `BACKUPS`
  bucket too. To start again, add the class back under a new migration tag
  (`new_sqlite_classes`). This cannot be undone; export first if in doubt.
