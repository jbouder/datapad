import { useEffect } from 'react';

const APP = 'Datapad';

/**
 * Give each page its own tab title (WCAG 2.4.2), e.g. "Help · Datapad".
 * No argument is the bare app name.
 */
export function usePageTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} · ${APP}` : APP;
  }, [page]);
}
