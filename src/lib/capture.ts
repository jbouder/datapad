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

/** The mounted capture line's handler for `startCommand()`. */
let commander: (() => void) | null = null;

/**
 * `/` anywhere: focus the capture line with `/` typed into it, so its
 * command menu opens, as if you had clicked it and typed `/`. A line that
 * already holds text just takes focus. False when no capture line is on
 * the page.
 */
export function startCommand(): boolean {
  if (!commander || !document.getElementById(CAPTURE_ID)) return false;
  commander();
  return true;
}

/** For the capture line: handle `startCommand()` while it is mounted. */
export function onStartCommand(handler: () => void): () => void {
  commander = handler;
  return () => {
    if (commander === handler) commander = null;
  };
}
