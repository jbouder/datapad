/**
 * Focus is never lost (#53): when what had it goes away (a page, a
 * deleted row, a toast's button), it moves to the page instead of falling
 * to `<body>`, where a keyboard or screen reader user would start again
 * from the top.
 */

/** Something on the page has focus: not `<body>`, not a removed node. */
export function hasFocus(): boolean {
  const el = document.activeElement;
  return !!el && el !== document.body && el.isConnected;
}

/** The page's `<main>` (focusable, `tabIndex={-1}`), without scrolling. */
export function focusPage() {
  document.getElementById('main')?.focus({ preventScroll: true });
}
