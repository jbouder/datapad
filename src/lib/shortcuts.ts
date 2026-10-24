/**
 * Single-letter shortcuts and the rule that keeps them out of the way:
 * they never fire while you are typing (an input, textarea, select or
 * contenteditable has focus) or while a panel, dialog, menu or the palette
 * is open, and never with a modifier held. #24 adds the rest of the
 * bindings and the shortcut sheet here.
 */

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether `target` takes typed text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING.has(target.tagName)) return true;
  return target.isContentEditable;
}

/** Whether something modal-ish is open over the page. */
export function overlayOpen(root: ParentNode = document): boolean {
  return (
    root.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

/** Whether a plain-letter shortcut may run for this key event. */
export function shortcutAllowed(
  event: Pick<
    KeyboardEvent,
    'target' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented'
  >,
  root: ParentNode = document,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;
  return !overlayOpen(root);
}
