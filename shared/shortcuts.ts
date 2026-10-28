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
  scope:
    | 'Anywhere'
    | 'Focus'
    | 'Task lists and tables'
    | 'Collection pages'
    | 'Panels'
    | 'Whiteboard';
  /** Not bound yet: arrives with a later feature. */
  later?: string;
}

/**
 * How far the whiteboard's arrow keys move, resize or re-aim, in board
 * units: a step, or a big one with Shift held.
 */
export const BOARD_STEP = 1;
export const BOARD_BIG_STEP = 10;

export const SHORTCUTS: Shortcut[] = [
  {
    keys: ['n'],
    action: 'Add a task (the new-task panel)',
    scope: 'Anywhere',
  },
  { keys: ['Shift+N'], action: 'Write a note', scope: 'Anywhere' },
  { keys: ['?'], action: 'Show these shortcuts', scope: 'Anywhere' },
  {
    keys: ['⌘K', 'Ctrl+K', '/'],
    action: 'Search everything, or run an action',
    scope: 'Anywhere',
  },
  {
    keys: ['Esc'],
    action: 'Close the panel or menu; clear a selection',
    scope: 'Anywhere',
  },
  {
    keys: ['m'],
    action: 'Show only my tasks, or everyone’s again',
    scope: 'Focus',
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
    keys: ['b'],
    action: 'Mark it blocked (who it waits on), or unblock it',
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
  {
    keys: ['V', 'S', 'T', 'R', 'A', 'P', 'E'],
    action:
      'Pick a tool: select, sticky note, text, rectangle, arrow, pen, eraser',
    scope: 'Whiteboard',
  },
  {
    keys: ['1–5'],
    action: 'Pick a color (and recolor the selection)',
    scope: 'Whiteboard',
  },
  {
    keys: ['Tab', 'Shift+Tab'],
    action: 'Next / previous item (focus selects it)',
    scope: 'Whiteboard',
  },
  {
    keys: ['Enter'],
    action:
      'With S, T or R picked: place one in the middle of the view, ready to type in. Otherwise write in the selected item, or re-aim the selected arrow’s head',
    scope: 'Whiteboard',
  },
  {
    keys: ['Shift+Enter'],
    action: 'Re-aim the selected arrow’s tail',
    scope: 'Whiteboard',
  },
  {
    keys: ['A then Enter'],
    action:
      'Draw an arrow from the selected item: Tab to the item it points to, Enter to draw it, Esc to cancel',
    scope: 'Whiteboard',
  },
  {
    keys: ['←', '↑', '→', '↓'],
    action: `Move the selection ${BOARD_STEP} unit (Shift: ${BOARD_BIG_STEP}); while re-aiming, move the arrow’s end`,
    scope: 'Whiteboard',
  },
  {
    keys: ['Alt+←', 'Alt+→', 'Alt+↑', 'Alt+↓'],
    action: `Resize the selection narrower, wider, shorter or taller by ${BOARD_STEP} unit (Shift: ${BOARD_BIG_STEP})`,
    scope: 'Whiteboard',
  },
  {
    keys: [']', '['],
    action: 'Bring the selection to the front / send it to the back',
    scope: 'Whiteboard',
  },
  {
    keys: ['Delete', 'Backspace'],
    action: 'Delete the selection',
    scope: 'Whiteboard',
  },
  {
    keys: ['⌘A', 'Ctrl+A'],
    action: 'Select every item',
    scope: 'Whiteboard',
  },
  {
    keys: ['⌘Z', 'Ctrl+Z'],
    action: 'Undo a change made on the board',
    scope: 'Whiteboard',
  },
  {
    keys: ['⇧⌘Z', 'Ctrl+Y'],
    action: 'Redo it',
    scope: 'Whiteboard',
  },
  {
    keys: ['Space'],
    action: 'Hold and drag to pan',
    scope: 'Whiteboard',
  },
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
  b: 'blocked',
};
