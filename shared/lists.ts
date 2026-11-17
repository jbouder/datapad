/**
 * Lists (#298) retired in v2 (#328): each became a checklist note, and
 * their data is kept. What is left is the Lists page's sorts, which its
 * saved settings (`PAGES.lists`, retired) still name.
 */

/** How the Lists page ordered them (#299). */
export const LIST_SORTS = ['updated', 'created', 'title'] as const;
