import { useCallback, useSyncExternalStore } from 'react';

/** Whether `query` matches now, following it as the window changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The `desk:` breakpoint (`--breakpoint-desk`, 820px) and up. */
export const DESK_QUERY = '(min-width: 820px)';

/** Whether the window is desktop width (`desk:`). */
export function useDesk(): boolean {
  return useMediaQuery(DESK_QUERY);
}
