import type { Decision, DecisionStatus, Snapshot } from './types';

/**
 * The decision log: what a project page lists and what the Decisions
 * view filters and groups. Newest first by when it was decided (or, while
 * proposed, when it was raised).
 */

export interface DecisionFilters {
  /** Empty: every status. */
  status: DecisionStatus | '';
  /** Empty: every project; `general` for General. */
  project: string;
  /** Text to find in titles and rationales. */
  q: string;
}

export const DEFAULT_DECISION_FILTERS: DecisionFilters = {
  status: '',
  project: '',
  q: '',
};

const when = (x: Decision) => x.decidedAt || x.createdAt.slice(0, 10);

export function newestFirst(a: Decision, b: Decision): number {
  return (
    when(b).localeCompare(when(a)) || b.createdAt.localeCompare(a.createdAt)
  );
}

export function projectDecisions(
  decisions: Snapshot['decisions'],
  projectId: string | null,
): Decision[] {
  return Object.values(decisions)
    .filter((x) => x.projectId === projectId)
    .sort(newestFirst);
}

export interface DecisionGroup {
  /** A project id, or `general`. */
  id: string;
  label: string;
  rows: Decision[];
}

/**
 * Filtered, grouped by project (by name, General last), newest first in
 * each. Archived projects' decisions stay: the log is a record.
 */
export function selectDecisions(
  state: Pick<Snapshot, 'decisions' | 'projects'>,
  filters: DecisionFilters,
): DecisionGroup[] {
  const q = filters.q.trim().toLowerCase();
  const groups = new Map<string, DecisionGroup>();
  for (const x of Object.values(state.decisions)) {
    if (filters.status && x.status !== filters.status) continue;
    const key = x.projectId ?? 'general';
    if (filters.project && key !== filters.project) continue;
    if (
      q &&
      !x.title.toLowerCase().includes(q) &&
      !x.rationale.toLowerCase().includes(q)
    ) {
      continue;
    }
    const project = x.projectId ? state.projects[x.projectId] : undefined;
    const group = groups.get(key) ?? {
      id: key,
      label: project?.name ?? 'General',
      rows: [],
    };
    group.rows.push(x);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  for (const g of list) g.rows.sort(newestFirst);
  return list.sort(
    (a, b) =>
      Number(a.id === 'general') - Number(b.id === 'general') ||
      a.label.localeCompare(b.label),
  );
}
