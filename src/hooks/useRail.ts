import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'datapad:rail';

/** The rail's id, for the toggle's `aria-controls`. */
export const RAIL_ID = 'rail';

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

let shown: boolean = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the desktop rail is shown on this device (the default) or
 * hidden from the top bar's sidebar button or ⌘\. Phones have the tab
 * bar instead and ignore it.
 */
export function useRailShown(): boolean {
  return useSyncExternalStore(subscribe, () => shown);
}

export function setRailShown(next: boolean) {
  shown = next;
  try {
    if (next) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'hidden');
  } catch {
    // Private mode: the choice lasts for this page load.
  }
  for (const listener of listeners) listener();
}
