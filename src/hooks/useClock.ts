import { useSyncExternalStore } from 'react';
import type { Clock } from '#shared/dates';

const STORAGE_KEY = 'datapad:clock';

const listeners = new Set<() => void>();

function read(): Clock {
  try {
    return localStorage.getItem(STORAGE_KEY) === '24h' ? '24h' : '12h';
  } catch {
    return '12h';
  }
}

let clock: Clock = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How times read on this device: 12-hour ("2:05 PM", the default) or
 * 24-hour ("14:05"), from Settings → Appearance. Stored values are
 * always `HH:MM`; this only changes what is shown.
 */
export function useClock(): Clock {
  return useSyncExternalStore(subscribe, () => clock);
}

export function setClock(next: Clock) {
  clock = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page load.
  }
  for (const listener of listeners) listener();
}
