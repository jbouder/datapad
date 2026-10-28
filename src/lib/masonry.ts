/**
 * The masonry grid's arithmetic (#218), pure; `src/hooks/useMasonry.ts`
 * measures and places.
 */

/** The narrowest a masonry column gets before there is one fewer. */
const MIN_COLUMN = 240;
const MAX_COLUMNS = 3;

/**
 * Columns for a list `width` px wide with `gap` px between them: as many
 * as fit at {@link MIN_COLUMN}, at most {@link MAX_COLUMNS}, at least one.
 */
export function masonryColumns(width: number, gap: number): number {
  const fit = Math.floor((width + gap) / (MIN_COLUMN + gap));
  return Math.max(1, Math.min(MAX_COLUMNS, fit));
}

/**
 * Where each item goes: the shortest column so far (the leftmost on a
 * tie), at that column's foot. Items keep their order, and each starts no
 * higher than the one before, so the page reads left to right, top to
 * bottom in the same order as the DOM.
 */
export function masonryPlaces(
  heights: readonly number[],
  columns: number,
  gap: number,
): { places: { column: number; top: number }[]; height: number } {
  const feet = Array.from({ length: columns }, () => 0);
  const places = heights.map((h) => {
    let column = 0;
    for (let c = 1; c < columns; c++) {
      if ((feet[c] ?? 0) < (feet[column] ?? 0)) column = c;
    }
    const top = feet[column] ?? 0;
    feet[column] = top + h + gap;
    return { column, top };
  });
  const height = Math.max(0, ...feet.map((f) => f - gap));
  return { places, height };
}
