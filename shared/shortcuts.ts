/**
 * Every keyboard shortcut, in one place, and the rule that keeps
 * single-letter ones out of the way: they never fire with a modifier held,
 * while you are typing (an input, textarea, select or contenteditable has
 * focus), or while a panel, dialog, menu, listbox or the palette is open.
 * The Help page and the shortcut sheet (`?`) list `SHORTCUTS`.
 */

export interface Shortcut {
  keys: string[];
  action: string;
  /** Where it works. */
  scope: 'Anywhere' | 'Task lists and tables' | 'Collection pages' | 'Panels';
  /** Not bound yet: arrives with a later feature. */
  later?: string;
}

export const SHORTCUTS: Shortcut[] = [
  {
    keys: ['n'],
    action: 'Add a task (the nearest quick-add, or the new-task panel)',
    scope: 'Anywhere',
  },
  { keys: ['?'], action: 'Show these shortcuts', scope: 'Anywhere' },
  {
    keys: ['⌘K', 'Ctrl+K', '/'],
    action: 'Search',
    scope: 'Anywhere',
    later: 'with search',
  },
  {
    keys: ['Esc'],
    action: 'Close the panel or menu; clear a selection',
    scope: 'Anywhere',
  },
  {
    keys: ['j', 'k'],
    action: 'Next / previous task',
    scope: 'Task lists and tables',
  },
  {
    keys: ['x'],
    action: 'Complete or reopen the focused task',
    scope: 'Task lists and tables',
  },
  {
    keys: ['e'],
    action: 'Open the focused task',
    scope: 'Task lists and tables',
  },
  {
    keys: ['d'],
    action: 'Change its due date',
    scope: 'Task lists and tables',
  },
  {
    keys: ['a'],
    action: 'Change its assignee',
    scope: 'Task lists and tables',
  },
  {
    keys: ['p'],
    action: 'Change its priority',
    scope: 'Task lists and tables',
  },
  {
    keys: ['Alt+↑', 'Alt+↓'],
    action: 'Move the task up or down (project page)',
    scope: 'Task lists and tables',
  },
  {
    keys: ['Space'],
    action: 'Select the focused row (Tasks table)',
    scope: 'Task lists and tables',
  },
  {
    keys: ['⌘A', 'Ctrl+A'],
    action: 'Select every row in the group (Tasks table)',
    scope: 'Task lists and tables',
  },
  {
    keys: ['v'],
    action: 'Next layout (Table, Board, Timeline …)',
    scope: 'Collection pages',
  },
  { keys: ['⌘Enter', 'Ctrl+Enter'], action: 'Save', scope: 'Panels' },
];

/** What the rule needs to know about a key press and the page. */
export interface ShortcutContext {
  /** Tag name of the focused element, upper case. */
  tag: string;
  contentEditable: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** A dialog, menu, listbox or palette is open. */
  overlay: boolean;
}

export const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** The suppression rule itself, pure (unit-tested). */
export function allowsShortcut(c: ShortcutContext): boolean {
  if (c.defaultPrevented) return false;
  if (c.metaKey || c.ctrlKey || c.altKey) return false;
  if (TYPING.has(c.tag) || c.contentEditable) return false;
  return !c.overlay;
}

/** Row keys: which control in the focused row each letter presses. */
export const ROW_ACTIONS: Record<string, string> = {
  x: 'complete',
  e: 'open',
  d: 'due',
  a: 'assignee',
  p: 'priority',
};
