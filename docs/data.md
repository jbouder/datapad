# Data

## The repository holds no data

This repository is public. It contains code, docs and fictional test
fixtures only. Never commit real projects, notes or people, and never
commit `.dev.vars`.

## Where your data lives

| What                               | Where                                                                                     | Who can reach it                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Everything you enter               | One SQLite-backed Durable Object in your Cloudflare account, named by your verified email | The Worker, only after verifying your Access sign-in |
| Nightly backups (M6)               | The `BACKUPS` R2 bucket in your account, latest 30 kept                                   | You, through the Cloudflare dashboard or API         |
| Last snapshot (unsent changes: M6) | IndexedDB in each browser you use                                                         | That browser profile                                 |
| Theme and motion preferences       | `localStorage` in each browser                                                            | That browser profile                                 |
| Summary model weights (M6)         | The browser's cache, downloaded from Hugging Face after you agree                         | That browser profile                                 |

Cloudflare Access logs record your email and sign-ins, by design. Worker
logs follow your account's Workers observability settings; the Worker logs
errors with the path only, never document content.

## What leaves your account

Nothing about your projects, tasks, notes, events or people. Summaries run
in your browser on a local model; the only download is the model itself.

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
  "settings": { "user": { "defaultOrg": "OpenTeams Internal" } }
}
```

- `settings` is Datapad's own (the artifact has none, and a file without
  it imports fine): preferences that follow your data, today only the
  default org for new projects.
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
