import { useEffect } from 'react';
import { documentTitle } from '@/lib/spaces';
import { useSpaceTitle } from '@/providers/DatapadProvider';

/**
 * Give each page its own tab title (WCAG 2.4.2), e.g. "Help · Datapad",
 * or "Help · Personal · Datapad" once there is more than one space.
 * No argument is the bare app name.
 */
export function usePageTitle(page?: string) {
  const space = useSpaceTitle();
  useEffect(() => {
    document.title = documentTitle(page, space);
  }, [page, space]);
}
