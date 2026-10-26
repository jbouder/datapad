import { tokensToNames } from './mentions';
import { lastCall } from './select';
import { type Snapshot, topicsOf } from './types';

/**
 * Search everything (the ⌘K palette). The index is a selector: one entry
 * per document with its text lowercased once, rebuilt only when a
 * collection it reads changes, so a keystroke is a scan of plain strings.
 */

export const SEARCH_KINDS = [
  'project',
  'task',
  'note',
  'meeting',
  'decision',
  'org',
  'person',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchEntry {
  kind: SearchKind;
  id: string;
  /** The line a result shows: a name, a title, a note's first line. */
  title: string;
  /** Readable text beyond the title (mentions as names), for snippets. */
  body: string;
  /** Everything searchable, lowercased. */
  text: string;
  /** Lowercased title, for ranking. */
  key: string;
  /** Null for General, people, and projects themselves. */
  projectId: string | null;
  /** In (or is) an archived project. */
  archived: boolean;
  updatedAt: string;
}

export type SearchIndex = Record<SearchKind, SearchEntry[]>;

/** Markdown marks and runs of space, gone (a one-line reading). */
function flat(text: string): string {
  return text
    .replace(/^\s*(?:#{1,3}|>|[-*]|\d+\.|```)\s*/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const searchIndex = lastCall(
  (
    projects: Snapshot['projects'],
    tasks: Snapshot['tasks'],
    notes: Snapshot['notes'],
    meetings: Snapshot['meetings'],
    people: Snapshot['people'],
    decisions: Snapshot['decisions'],
    orgs: Snapshot['orgs'],
  ): SearchIndex => {
    const archived = (projectId: string | null) =>
      projectId !== null && projects[projectId]?.archived === true;
    const entry = (
      e: Omit<SearchEntry, 'text' | 'key'>,
      extra = '',
    ): SearchEntry => ({
      ...e,
      key: e.title.toLowerCase(),
      text: `${e.title} ${e.body} ${extra}`.toLowerCase(),
    });

    return {
      project: Object.values(projects).map((p) =>
        entry(
          {
            kind: 'project',
            id: p.id,
            title: p.name,
            body: flat(p.state || p.desc),
            projectId: null,
            archived: p.archived,
            updatedAt: p.updatedAt,
          },
          `${p.org} ${p.tags.join(' ')} ${flat(p.desc)}`,
        ),
      ),
      task: Object.values(tasks).map((t) =>
        entry(
          {
            kind: 'task',
            id: t.id,
            title: t.title,
            body: flat(tokensToNames(t.desc, people)),
            projectId: t.projectId,
            archived: archived(t.projectId),
            updatedAt: t.updatedAt,
          },
          t.tags.join(' '),
        ),
      ),
      note: Object.values(notes).map((n) => {
        const text = flat(tokensToNames(n.body, people));
        const firstLine =
          flat(tokensToNames(n.body.split('\n', 1)[0] ?? '', people)) || text;
        return entry({
          kind: 'note',
          id: n.id,
          title: firstLine.slice(0, 120),
          body: text,
          projectId: n.projectId,
          archived: archived(n.projectId),
          updatedAt: n.editedAt ?? n.createdAt,
        });
      }),
      // A topic is found through its meeting, not as a result of its own.
      meeting: Object.values(meetings).map((m) =>
        entry(
          {
            kind: 'meeting',
            id: m.id,
            title: m.title,
            body: flat(m.note),
            projectId: m.projectId,
            archived: archived(m.projectId),
            updatedAt: m.updatedAt,
          },
          topicsOf(m)
            .map((t) => t.title)
            .join(' '),
        ),
      ),
      decision: Object.values(decisions).map((x) =>
        entry({
          kind: 'decision',
          id: x.id,
          title: x.title,
          body: flat(tokensToNames(x.rationale, people)),
          projectId: x.projectId,
          archived: archived(x.projectId),
          updatedAt: x.updatedAt,
        }),
      ),
      org: Object.values(orgs).map((o) =>
        entry(
          {
            kind: 'org',
            id: o.id,
            title: o.name,
            body: flat(tokensToNames(o.notes, people)),
            projectId: null,
            archived: o.archived,
            updatedAt: o.updatedAt,
          },
          o.kind,
        ),
      ),
      person: Object.values(people).map((p) =>
        entry({
          kind: 'person',
          id: p.id,
          title: p.name,
          body: p.role,
          projectId: null,
          archived: false,
          updatedAt: '',
        }),
      ),
    };
  },
);

export interface SearchHit {
  entry: SearchEntry;
  /** Text around the first match outside the title, or empty. */
  snippet: string;
}

export type SearchResults = Record<SearchKind, SearchHit[]>;

/** Up to `around` characters each side of `at`, with ellipses where cut. */
function excerpt(text: string, at: number, length: number, around = 50) {
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + length + around);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function rank(entry: SearchEntry, first: string): number {
  if (entry.key.startsWith(first)) return 0;
  if (entry.key.includes(first)) return 1;
  return 2;
}

/**
 * Every entry containing every word of `query` (any case), best first in
 * each section: title starts with the first word, then title contains it,
 * then text; outside the archive before in it; then most recent. With an
 * empty query, only Projects: the most recently updated.
 */
export function search(
  index: SearchIndex,
  query: string,
  limit = 6,
): SearchResults {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = {} as SearchResults;
  for (const kind of SEARCH_KINDS) results[kind] = [];
  if (words.length === 0) {
    results.project = [...index.project]
      .sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, limit)
      .map((entry) => ({ entry, snippet: '' }));
    return results;
  }
  const first = words[0] ?? '';
  for (const kind of SEARCH_KINDS) {
    const matches = index[kind].filter((e) =>
      words.every((w) => e.text.includes(w)),
    );
    matches.sort(
      (a, b) =>
        rank(a, first) - rank(b, first) ||
        Number(a.archived) - Number(b.archived) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.key.localeCompare(b.key),
    );
    results[kind] = matches.slice(0, limit).map((entry) => {
      if (kind === 'person' || kind === 'project' || kind === 'org') {
        return { entry, snippet: entry.body };
      }
      const word = words.find((w) => !entry.key.includes(w)) ?? first;
      const at = entry.body.toLowerCase().indexOf(word);
      return {
        entry,
        snippet:
          at >= 0 && (kind === 'note' ? at >= entry.title.length : true)
            ? excerpt(entry.body, at, word.length)
            : '',
      };
    });
  }
  return results;
}
