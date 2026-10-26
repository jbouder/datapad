import { nextMilestone } from './milestones';
import { PRIORITY_RANK } from './select';
import {
  type DateString,
  healthOf,
  type Project,
  type ProjectHealth,
  type ProjectStatus,
} from './types';

/** How the Projects page orders its cards. */
export const PROJECT_SORTS = [
  'updated',
  'priority',
  'name',
  'start',
  'target',
  'milestone',
] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export type StatusFilter = ProjectStatus | 'all';
/** Empty: any health. */
export type HealthFilter = Exclude<ProjectHealth, 'none'> | '';

export interface ProjectFilters {
  status: StatusFilter;
  health: HealthFilter;
  /** Empty: every org. */
  org: string;
  sort: ProjectSort;
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  status: 'active',
  health: '',
  org: '',
  sort: 'updated',
};

const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);

/**
 * Recently updated (newest first); priority high → med → low → none, then
 * name; name; start or target date, or the next milestone on or after
 * `today` (soonest first, undated last, then name).
 */
export function compareProjects(sort: ProjectSort, today: DateString = '') {
  switch (sort) {
    case 'updated':
      return (a: Project, b: Project) =>
        b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
    case 'priority':
      return (a: Project, b: Project) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byName(a, b);
    case 'name':
      return byName;
    case 'start':
      return byDate((p) => p.startDate ?? '');
    case 'target':
      return byDate((p) => p.targetDate);
    case 'milestone':
      return byDate((p) => nextMilestone(p, today)?.date ?? '');
  }
}

function byDate(dateOf: (p: Project) => string) {
  return (a: Project, b: Project) => {
    const x = dateOf(a);
    const y = dateOf(b);
    if (x === y) return byName(a, b);
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  };
}

/** The cards a page shows, archived or not, filtered and sorted. */
export function selectProjects(
  projects: Record<string, Project>,
  filters: ProjectFilters,
  archived = false,
  today: DateString = '',
): Project[] {
  return Object.values(projects)
    .filter(
      (p) =>
        p.archived === archived &&
        (archived || filters.status === 'all' || p.status === filters.status) &&
        (archived || !filters.org || p.org === filters.org) &&
        (archived || !filters.health || healthOf(p) === filters.health),
    )
    .sort(compareProjects(archived ? 'updated' : filters.sort, today));
}
