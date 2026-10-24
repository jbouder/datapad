import { type RefObject, useEffect, useState } from 'react';

/**
 * Whether the page's h1 (the first in `#main`) has scrolled up under the
 * sticky `bar`, so the bar can show the title only once the page's own
 * heading is out of sight. Every page has an h1; it is re-found as the page
 * renders (loading states mount it late), and until then the title stays
 * hidden.
 */
export function useHeadingScrolledPast(
  bar: RefObject<HTMLElement | null>,
  pageKey: string,
): boolean {
  const [past, setPast] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-find the h1 when the page changes.
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    let watched: Element | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setPast(!entry.isIntersecting);
      },
      { rootMargin: `-${bar.current?.offsetHeight ?? 0}px 0px 0px 0px` },
    );
    const watch = () => {
      const heading = main.querySelector('h1');
      if (heading === watched) return;
      if (watched) io.unobserve(watched);
      watched = heading;
      if (heading) io.observe(heading);
      else setPast(false);
    };
    setPast(false);
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [bar, pageKey]);

  return past;
}
