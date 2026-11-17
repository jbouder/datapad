/**
 * "Focus the capture line once it is on screen." `n` can fire before a
 * page transition has mounted the page it leads to, so the request waits
 * here and the next capture line to mount takes it.
 */
let wanted = false;

export const CAPTURE_ID = 'capture';

/** Focus the capture line now if there is one; otherwise when one mounts. */
export function focusCapture(): boolean {
  const input = document.getElementById(CAPTURE_ID);
  if (input) {
    input.focus();
    return true;
  }
  wanted = true;
  return false;
}

/** For the capture line's mount effect: true once per request. */
export function takeCaptureFocus(): boolean {
  const take = wanted;
  wanted = false;
  return take;
}
