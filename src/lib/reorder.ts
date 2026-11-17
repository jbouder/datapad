/**
 * Dropping onto the row at `target` inserts before it (the spec's rule);
 * `target === length` is the end. Returns the new index of the dragged
 * item, or null when nothing would move.
 */
export function dropIndex(from: number, target: number): number | null {
  const to = target > from ? target - 1 : target;
  return to === from ? null : to;
}
