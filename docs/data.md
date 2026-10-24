# Data

## The repository holds no data

This repository is public. It contains code, docs and fictional test
fixtures only. Never commit real projects, notes or people, and never
commit `.dev.vars`.

## Where your data lives

| What                                     | Where                                                                                                                                              | Who can reach it                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Everything you enter                     | One SQLite-backed Durable Object in your Cloudflare account, named by your verified email                                                          | The Worker, only after verifying your Access sign-in |
| Nightly backups                          | The `BACKUPS` R2 bucket in your account, `<email>/datapad-YYYY-MM-DD.json`, latest 30 kept                                                         | You, through the Cloudflare dashboard or API         |
| Last snapshot, and changes not yet saved | IndexedDB in each browser you use (`datapad:snapshot`, `datapad:pending`), and the unsaved changes again in `localStorage` (`datapad:pending-now`) | That browser profile                                 |
| Theme and motion preferences             | `localStorage` in each browser                                                                                                                     | That browser profile                                 |
| Summary model weights                    | The browser's cache, downloaded from Hugging Face after you agree                                                                                  | That browser profile                                 |
| Summary model choice                     | `localStorage` (`datapad:summary-model`) in each browser                                                                                           | That browser profile                                 |

Cloudflare Access logs record your email and sign-ins, by design. Worker
logs follow your account's Workers observability settings; the Worker logs
errors with the path only, never document content.

## What leaves your account

Nothing about your projects, tasks, notes, events or people.

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

The original artifact's export, unchanged, so its `ledger-*.json` imports
as it is:

```json
{
  "exportedAt": "2026-10-23T12:00:00.000Z",
  "projects": { "<id>": { "id": "<id>", "name": "…", … } },
  "tasks": { … },
  "notes": { … },
  "people": { … },
  "activity": { "<projectId>": { "events": [{ "t": "…", "text": "…" }] }, "general": { … } },
  "events": { … },
  "settings": { "user": { "defaultOrg": "OpenTeams Internal" } },
  "decisions": { "<id>": { "id": "<id>", "title": "…", "status": "decided", … } },
  "orgs": { "<id>": { "id": "<id>", "name": "…", "kind": "client", … } }
}
```

- `settings` is Datapad's own (the artifact has none, and a file without
  it imports fine): preferences that follow your data, today only the
  default org for new projects.
- `decisions` and `orgs` are Datapad's own too (M7): the decision log and
  org records. A file without them imports fine; its projects' `org` text
  is kept, and Settings → Orgs offers to organise it into records
  (`project.orgId` links one). Deleting an org leaves the text. Projects may carry `health` and tasks `blocked`; both
  are optional and absent in older files.
- Each collection is a map from id to document, fields exactly as in
  [SPEC.md § Data model](SPEC.md#data-model). An array of documents that
  carry their `id` is accepted too.
- Timestamps are ISO 8601, dates `YYYY-MM-DD`, times `HH:MM`; an empty
  string means "not set" for dates, times and the assignee.
- Mentions stay as `@{personId}` tokens; `order`, `sourceNoteId`,
  `eventId` / `phase`, `archived` and `links[]` carry over untouched.
- Unknown keys are dropped. A field an older file lacks gets its empty
  value (`[]`, `''`, `false`, `null`); names, titles, event dates and
  timestamps must be there.
- Limits: [`shared/limits.ts`](../shared/limits.ts) (titles 200, bodies
  20 000 characters, 150 activity entries, 16 MiB per file).
  `test/fixtures/export.json` is a complete, fictional example.

### Moving from the artifact

1. In the artifact, use Export in the sidebar footer. You get
   `ledger-YYYY-MM-DD.json`.
2. Open Datapad, signed in as yourself. Settings → Data → Import… → pick the
   file → check the counts → Import.
3. Projects, tasks, notes, events, people and activity appear in every
   open tab at once. Archived projects stay archived.
4. Keep the artifact's file until you have used Datapad for a while; you
   can import it again at any time without making duplicates.

## Backups

Every night at `BACKUP_HOUR` in `BACKUP_TIME_ZONE` (3 AM America/New_York
unless you change the vars in `wrangler.jsonc`) your Durable Object's
alarm writes the export JSON to the `BACKUPS` R2 bucket as
`<your email>/datapad-YYYY-MM-DD.json` (the day in that zone), deletes all
but the latest 30 of yours, and books the next night. A Datapad with no
documents writes nothing. If a night is missed, the next time any tab
connects writes one at once.

The alarm only adds to and prunes the bucket. It never changes or deletes
a document; the only way to delete your data is the erase below.

**Restore in the app:** Settings → Data → Backups lists them with their
sizes. Download saves one; Restore counts what it holds, asks, and merges
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
--remote` lists what there is (or browse the bucket in the dashboard).

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

  Every document in your object is deleted and every open tab is sent the
  empty state. The token works once; a wrong one uses it up. This is the
  only code path that deletes everything, and nothing runs it on a timer.
  Export first.
- **Everyone's data, and the class:** add a migration to `wrangler.jsonc`
  that deletes the class, `{ "tag": "v2", "deleted_classes":
  ["DatapadObject"] }`, remove the `DATAPAD` binding and deploy. Cloudflare
  then deletes every Datapad object and its storage. Empty the `BACKUPS`
  bucket too. To start again, add the class back under a new migration tag
  (`new_sqlite_classes`). This cannot be undone; export first if in doubt.
