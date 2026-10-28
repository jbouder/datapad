import { type RefObject, useLayoutEffect } from 'react';
import { masonryColumns, masonryPlaces } from '@/lib/masonry';

/**
 * A masonry ("Pinterest") list (#218): the list's children keep their
 * natural heights and pack into columns with no holes, placed by
 * {@link masonryPlaces} so the DOM order is the reading order. One column
 * (phones) is the list's own flow. Re-packs when the list's width or any
 * item's height changes, and when `key` does (items added or removed).
 */
export function useMasonry(
  list: RefObject<HTMLElement | null>,
  gap: number,
  key: unknown,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is when the items change
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const items = () => [...el.children] as HTMLElement[];
    const pack = () => {
      const columns = masonryColumns(el.clientWidth, gap);
      const all = items();
      if (columns === 1) {
        el.style.height = '';
        for (const item of all) {
          item.style.position = '';
          item.style.width = '';
          item.style.left = '';
          item.style.top = '';
        }
        return;
      }
      const width = (el.clientWidth - gap * (columns - 1)) / columns;
      for (const item of all) {
        item.style.position = 'absolute';
        item.style.width = `${width}px`;
      }
      const { places, height } = masonryPlaces(
        all.map((item) => item.offsetHeight),
        columns,
        gap,
      );
      all.forEach((item, i) => {
        const place = places[i];
        if (!place) return;
        item.style.left = `${place.column * (width + gap)}px`;
        item.style.top = `${place.top}px`;
      });
      el.style.height = `${height}px`;
    };
    pack();
    // Its own new height is no reason to pack again; a new width is.
    let width = el.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const resized = entries.some((e) => e.target !== el);
      if (!resized && el.clientWidth === width) return;
      width = el.clientWidth;
      pack();
    });
    observer.observe(el);
    for (const item of items()) observer.observe(item);
    return () => observer.disconnect();
  }, [list, gap, key]);
}
