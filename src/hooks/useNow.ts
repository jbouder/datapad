import { useSyncExternalStore } from 'react';
import { localDate } from '#shared/dates';
import type { DateString } from '#shared/types';

/**
 * The time, to the minute, shared by every subscriber: one timer fires at
 * each minute boundary, and waking the tab (sleep, a background tab whose
 * timers were throttled) catches up at once. Date-bucketed views read
 * `useToday()` so they roll over at midnight without a reload.
 */

const MINUTE_MS = 60_000;
const listeners = new Set<() => void>();
let minute = floor(Date.now());
let timer: number | undefined;

function floor(ms: number): number {
  return ms - (ms % MINUTE_MS);
}

function tick() {
  const next = floor(Date.now());
  if (next !== minute) {
    minute = next;
    for (const listener of listeners) listener();
  }
  schedule();
}

function schedule() {
  window.clearTimeout(timer);
  timer = window.setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS) + 50);
}

function onVisible() {
  if (document.visibilityState === 'visible') tick();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    minute = floor(Date.now());
    schedule();
    document.addEventListener('visibilitychange', onVisible);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** Milliseconds since the epoch, floored to the minute. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => minute);
}

/** The user's local date, which changes at midnight. */
export function useToday(): DateString {
  return localDate(new Date(useNow()));
}
