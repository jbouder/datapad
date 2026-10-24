import { PRIORITY_RANK } from './select';
import type { Project, ProjectStatus } from './types';

/** How the Projects page orders its cards. */
export const PROJECT_SORTS = ['updated', 'priority', 'name', 'target'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export type StatusFilter = ProjectStatus | 'all';

export interface ProjectFilters {
  status: StatusFilter;
  /** Empty: every org. */
  org: string;
  sort: ProjectSort;
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  status: 'active',
  org: '',
  sort: 'updated',
};

const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);

/**
 * Recently updated (newest first); priority high → med → low → none, then
 * name; name; target date (soonest first, undated last, then name).
 */
export function compareProjects(sort: ProjectSort) {
  switch (sort) {
    case 'updated':
      return (a: Project, b: Project) =>
        b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
    case 'priority':
      return (a: Project, b: Project) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byName(a, b);
    case 'name':
      return byName;
    case 'target':
      return (a: Project, b: Project) => {
        if (a.targetDate === b.targetDate) return byName(a, b);
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.localeCompare(b.targetDate);
      };
  }
}

/** The cards a page shows, archived or not, filtered and sorted. */
export function selectProjects(
  projects: Record<string, Project>,
  filters: ProjectFilters,
  archived = false,
): Project[] {
  return Object.values(projects)
    .filter(
      (p) =>
        p.archived === archived &&
        (archived || filters.status === 'all' || p.status === filters.status) &&
        (archived || !filters.org || p.org === filters.org),
    )
    .sort(compareProjects(archived ? 'updated' : filters.sort));
}
