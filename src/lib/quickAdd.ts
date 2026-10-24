/**
 * "Focus the quick-add once it is on screen." The + button and `n` can
 * fire before a page transition has mounted the page they lead to, so the
 * request waits here and the next quick-add to mount takes it.
 */
let wanted = false;

export const QUICK_ADD_ID = 'quick-add';

/** Focus the quick-add now if there is one; otherwise when one mounts. */
export function focusQuickAdd(): boolean {
  const input = document.getElementById(QUICK_ADD_ID);
  if (input) {
    input.focus();
    return true;
  }
  wanted = true;
  return false;
}

/** For the quick-add's mount effect: true once per request. */
export function takeQuickAddFocus(): boolean {
  const take = wanted;
  wanted = false;
  return take;
}
