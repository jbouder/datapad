/**
 * The bundle budget: what the first visit downloads before the app can
 * run, gzipped, after `vite build`. CI's `check` job runs it after the
 * build and fails when either budget is exceeded:
 *
 *   npm run build && npm run budget
 *
 * "Entry" is everything dist/client/index.html loads up front: its module
 * script, the chunks it modulepreloads, and its stylesheets. Lazy pages,
 * the summary worker and WebLLM are not in it, and WebLLM never may be:
 * it is megabytes, and it loads only when the owner asks for a summary.
 *
 * Raise a budget only on purpose, in the same change that needs it, and
 * say why in the pull request. Keep a little headroom, not a lot.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Gzipped kilobytes (1 KB = 1000 bytes, as Vite reports them). JS went
 * from 385 to 390 with #268: DetailActions is shared by ProjectPage (in
 * the entry) and the lazy meeting and task pages, and Rolldown now splits
 * the entry into more chunks, which gzip less well than one; the
 * component itself is about 1 KB. Then to 392 with #269: the shared list
 * toolbar (Find, the Filters sheet, Sort, the filter count) is about
 * 2 KB, and Tasks and Notes, which use it, are in the entry. Then to
 * 393 with #273: the compact note row and its plain-text preview, on the
 * project page in the entry (about 1 KB, half of it offset by sharing
 * NoteCard's parts).
 */
const BUDGET_KB = { js: 393, css: 28 };

/**
 * Strings only WebLLM's own code holds: its TVM runtime and its cache's
 * scope. (Not `web-llm-models/`: the pinned library URLs in
 * src/lib/summary-pins.ts hold that, and they may be in the entry.)
 */
const WEBLLM_MARKERS = ['tvmjs', 'webllm/model'];

const CLIENT = resolve(import.meta.dirname, '..', 'dist', 'client');

function entryFiles(html: string): { js: string[]; css: string[] } {
  const js: string[] = [];
  const css: string[] = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const src = /\b(?:src|href)="(\/assets\/[^"]+)"/i.exec(tag)?.[1];
    if (!src) continue;
    if (src.endsWith('.js')) js.push(src);
    else if (src.endsWith('.css')) css.push(src);
  }
  return { js, css };
}

function gzipKb(files: string[]): number {
  let bytes = 0;
  for (const file of files) {
    bytes += gzipSync(readFileSync(resolve(CLIENT, `.${file}`)), {
      level: 9,
    }).length;
  }
  return bytes / 1000;
}

const html = readFileSync(resolve(CLIENT, 'index.html'), 'utf8');
const entry = entryFiles(html);
const failures: string[] = [];

if (entry.js.length === 0) failures.push('no entry script in index.html');

for (const kind of ['js', 'css'] as const) {
  const kb = gzipKb(entry[kind]);
  const budget = BUDGET_KB[kind];
  const line = `entry ${kind.toUpperCase()}: ${kb.toFixed(1)} KB gzip (budget ${budget} KB, ${entry[kind].length} file${entry[kind].length === 1 ? '' : 's'})`;
  console.log(line);
  if (kb > budget)
    failures.push(`${line}: over by ${(kb - budget).toFixed(1)} KB`);
}

for (const file of entry.js) {
  const text = readFileSync(resolve(CLIENT, `.${file}`), 'utf8');
  const marker = WEBLLM_MARKERS.find((m) => text.includes(m));
  if (marker) {
    failures.push(`WebLLM is in the entry: ${file} holds "${marker}"`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`budget: ${failure}`);
  process.exit(1);
}
console.log('budget: ok, and WebLLM is not in the entry');
