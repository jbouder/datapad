import { useSyncExternalStore } from 'react';

/**
 * Whether the Access session has ended, for this page load. Set once, by
 * the first call or socket probe that finds out (`src/lib/api.ts`); the
 * app then stops reconnecting and shows "Sign in again" in place of the
 * shell. Only a reload (through Access's login) clears it. Drafts are in
 * sessionStorage and waiting changes in the local queue, so nothing typed
 * is lost on the way.
 */
let signedOut = false;
const listeners = new Set<() => void>();

export function markSignedOut() {
  if (signedOut) return;
  signedOut = true;
  for (const listener of listeners) listener();
}

export function isSignedOut(): boolean {
  return signedOut;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSignedOut(): boolean {
  return useSyncExternalStore(subscribe, isSignedOut, isSignedOut);
}
