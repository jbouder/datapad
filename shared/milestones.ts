import {
  type DateString,
  type Milestone,
  milestonesOf,
  type Project,
} from './types';

/**
 * Milestones: dated markers that live on their project. A project keeps
 * them sorted with `byDate`; these are the small rules the views share.
 */

/** Soonest first: by day, then title. */
export function byDate(a: Milestone, b: Milestone): number {
  return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
}

/** A project's next milestone on or after `today`, or null. */
export function nextMilestone(
  project: Pick<Project, 'milestones'>,
  today: DateString,
): Milestone | null {
  let next: Milestone | null = null;
  for (const m of milestonesOf(project)) {
    if (m.date < today) continue;
    if (!next || byDate(m, next) < 0) next = m;
  }
  return next;
}
