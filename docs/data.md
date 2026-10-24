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

## Export and import (M1)

`GET /api/export.json` returns every document as one JSON file. Import
merges by id, so repeating an import is safe. The format matches the
original artifact's export.

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
