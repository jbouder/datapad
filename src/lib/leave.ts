/**
 * Unsaved work that leaving would lose: an inline note being written on a
 * task, meeting or project's page. Each registers a guard while it has
 * text; the router asks before it changes page, and a side panel before it
 * closes over one. A guard that holds stops the leave and asks (Discard or
 * Save note), then calls `resume` to finish what was stopped.
 */

export interface LeaveGuard {
  /** What the guard protects, so a panel only asks about its own. */
  element: () => Element | null;
  /** True: hold the leave, ask, and call `resume` once it is settled. */
  hold: (resume: () => void) => boolean;
}

const guards = new Set<LeaveGuard>();

export function addLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/**
 * Whether a guard held the leave (the caller stops). With `within`, only
 * the guards inside that element are asked.
 */
export function holdLeave(resume: () => void, within?: Element): boolean {
  for (const guard of guards) {
    if (within) {
      const el = guard.element();
      if (!el || !within.contains(el)) continue;
    }
    if (guard.hold(resume)) return true;
  }
  return false;
}
