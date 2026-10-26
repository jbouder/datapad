import { formatDay } from './dates';
import type { DateString, Snapshot, Timestamp } from './types';

/**
 * The weekly digest: what happened in each project (and General) between
 * two instants, from the documents' own timestamps and the activity logs.
 * Pure; the page picks the week, `digestMarkdown` writes it up in the
 * Markdown the renderer reads, so it pastes back into a note.
 */

export interface DigestRange {
  /** Inclusive, ISO 8601: the start of the first local day. */
  from: Timestamp;
  /** Exclusive, ISO 8601: the start of the day after the last. */
  to: Timestamp;
  /** The same week as local dates, for meetings and decisions. */
  fromDay: DateString;
  toDay: DateString;
}

export interface ProjectDigest {
  /** A project id, or `general`. */
  id: string;
  name: string;
  closed: string[];
  added: string[];
  notes: number;
  /** The current state line, when it changed this week. */
  state: string | null;
  /** "Status changed to paused", "Health set to red", in order. */
  changes: string[];
  /** "Mon 19 Oct: Shield review". */
  meetings: string[];
  /** "Decided: Move to Hoth". */
  decisions: string[];
}

export interface Digest {
  range: DigestRange;
  projects: ProjectDigest[];
  totals: { closed: number; added: number; notes: number; decisions: number };
}

/** The seven local days ending `lastDay`, as instants in this zone. */
export function weekEnding(lastDay: DateString): DigestRange {
  const [y, m, d] = lastDay.split('-').map(Number) as [number, number, number];
  const end = new Date(y, m - 1, d + 1);
  const start = new Date(y, m - 1, d - 6);
  const day = (t: Date) =>
    `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    fromDay: day(start),
    toDay: lastDay,
  };
}

const inRange = (t: string | null | undefined, r: DigestRange) =>
  Boolean(t) && (t as string) >= r.from && (t as string) < r.to;
const inDays = (d: string, r: DigestRange) =>
  Boolean(d) && d >= r.fromDay && d <= r.toDay;

const CHANGE = /^(Status changed to |Health set to )/;

export function buildDigest(state: Snapshot, range: DigestRange): Digest {
  const groups = new Map<string, ProjectDigest>();
  const group = (projectId: string | null): ProjectDigest => {
    const id = projectId ?? 'general';
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        name: projectId
          ? (state.projects[projectId]?.name ?? 'General')
          : 'General',
        closed: [],
        added: [],
        notes: 0,
        state: null,
        changes: [],
        meetings: [],
        decisions: [],
      };
      groups.set(id, g);
    }
    return g;
  };

  for (const t of Object.values(state.tasks)) {
    if (t.status === 'done' && inRange(t.completedAt, range)) {
      group(t.projectId).closed.push(t.title);
    }
    if (inRange(t.createdAt, range)) group(t.projectId).added.push(t.title);
  }
  for (const n of Object.values(state.notes)) {
    if (inRange(n.createdAt, range)) group(n.projectId).notes += 1;
  }
  for (const m of Object.values(state.meetings).sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time),
  )) {
    if (inDays(m.date, range)) {
      group(m.projectId).meetings.push(
        `${formatDay(m.date, '0000-01-01')}: ${m.title}`,
      );
    }
  }
  for (const x of Object.values(state.decisions ?? {})) {
    if (x.status !== 'proposed' && inDays(x.decidedAt, range)) {
      group(x.projectId).decisions.push(
        `${x.status === 'decided' ? 'Decided' : 'Revisited'}: ${x.title}`,
      );
    } else if (x.status === 'proposed' && inRange(x.createdAt, range)) {
      group(x.projectId).decisions.push(`Proposed: ${x.title}`);
    }
  }
  for (const [key, log] of Object.entries(state.activity)) {
    const projectId = key === 'general' ? null : key;
    // Newest first in the log; the digest reads oldest first.
    const week = log.events.filter((a) => inRange(a.t, range)).reverse();
    for (const a of week) {
      if (CHANGE.test(a.text)) group(projectId).changes.push(a.text);
      if (a.text === 'Updated current state' && projectId) {
        group(projectId).state = state.projects[projectId]?.state || null;
      }
    }
  }

  const projects = [...groups.values()]
    .filter(
      (g) =>
        g.closed.length +
          g.added.length +
          g.notes +
          g.changes.length +
          g.meetings.length +
          g.decisions.length >
          0 || g.state !== null,
    )
    .sort(
      (a, b) =>
        Number(a.id === 'general') - Number(b.id === 'general') ||
        a.name.localeCompare(b.name),
    );
  const sum = (f: (g: ProjectDigest) => number) =>
    projects.reduce((n, g) => n + f(g), 0);
  return {
    range,
    projects,
    totals: {
      closed: sum((g) => g.closed.length),
      added: sum((g) => g.added.length),
      notes: sum((g) => g.notes),
      decisions: sum((g) => g.decisions.length),
    },
  };
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The digest as Markdown in the renderer's subset (`##`/`###` headings,
 * `- ` bullets, `**bold**`), so it pastes into a note and renders there.
 */
export function digestMarkdown(digest: Digest): string {
  const { range, projects, totals } = digest;
  const lines = [
    `## Week of ${formatDay(range.fromDay, '0000-01-01')} – ${formatDay(range.toDay, '0000-01-01')}`,
    '',
    `${plural(totals.closed, 'task', 'tasks')} closed, ${totals.added} added, ${plural(totals.notes, 'note', 'notes')}, ${plural(totals.decisions, 'decision', 'decisions')}.`,
  ];
  if (projects.length === 0) {
    lines.push('', 'Nothing happened this week.');
  }
  for (const g of projects) {
    lines.push('', `### ${g.name}`);
    if (g.state) lines.push(`- **Now:** ${g.state}`);
    for (const c of g.changes) lines.push(`- ${c}`);
    if (g.closed.length) lines.push(`- **Closed:** ${g.closed.join('; ')}`);
    if (g.added.length) lines.push(`- **Added:** ${g.added.join('; ')}`);
    for (const d of g.decisions) lines.push(`- ${d}`);
    for (const m of g.meetings) lines.push(`- ${m}`);
    if (g.notes) lines.push(`- ${plural(g.notes, 'note', 'notes')} written`);
  }
  return lines.join('\n');
}
