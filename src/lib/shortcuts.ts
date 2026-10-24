import { allowsShortcut, ROW_ACTIONS, TYPING } from '#shared/shortcuts';

/**
 * The DOM side of the shortcut rules in `shared/shortcuts.ts`: reading the
 * focused element and the open overlays, and the row keys.
 */

export {
  allowsShortcut,
  ROW_ACTIONS,
  SHORTCUTS,
  type Shortcut,
  type ShortcutContext,
} from '#shared/shortcuts';

/** Whether `target` takes typed text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING.has(target.tagName) || target.isContentEditable;
}

/** Whether something modal-ish is open over the page. */
export function overlayOpen(root: ParentNode = document): boolean {
  return (
    root.querySelector(
      // Not one that is on its way out (Base UI marks a closing popup).
      ['dialog', 'alertdialog', 'menu', 'listbox']
        .map(
          (role) =>
            `[role="${role}"]:not([hidden]):not([data-ending-style]):not([data-closed])`,
        )
        .join(', '),
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
  const el = event.target instanceof HTMLElement ? event.target : null;
  return allowsShortcut({
    tag: el?.tagName ?? '',
    contentEditable: el?.isContentEditable ?? false,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    defaultPrevented: event.defaultPrevented,
    overlay: overlayOpen(root),
  });
}

/**
 * j / k and the row letters for a list of rows (`[data-task-id]`): j and
 * k move focus to the next or previous row's title, and x / e / d / a / p
 * press the control marked `data-row-action` in the focused row. Returns
 * whether it handled the key.
 */
export function handleRowKey(
  event: KeyboardEvent,
  container: HTMLElement,
): boolean {
  if (!shortcutAllowed(event)) return false;
  const rows = [
    ...container.querySelectorAll<HTMLElement>('[data-task-id]'),
  ].filter((r) => r.getClientRects().length > 0);
  if (rows.length === 0) return false;
  const current = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-task-id]',
  );
  const index = current ? rows.indexOf(current) : -1;

  if (event.key === 'j' || event.key === 'k') {
    const next =
      rows[
        index < 0
          ? 0
          : Math.max(
              0,
              Math.min(rows.length - 1, index + (event.key === 'j' ? 1 : -1)),
            )
      ];
    const target =
      next?.querySelector<HTMLElement>('[data-row-focus]') ?? next ?? null;
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  const action = ROW_ACTIONS[event.key];
  if (!action || !current) return false;
  const control = current.querySelector<HTMLElement>(
    `[data-row-action="${action}"]`,
  );
  if (!control || control.getClientRects().length === 0) return false;
  control.click();
  return true;
}
