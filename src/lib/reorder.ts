/** `ids` with the item at `from` moved to `to` (both 0-based). */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * Dropping onto the row at `target` inserts before it (the spec's rule);
 * `target === length` is the end. Returns the new index of the dragged
 * item, or null when nothing would move.
 */
export function dropIndex(from: number, target: number): number | null {
  const to = target > from ? target - 1 : target;
  return to === from ? null : to;
}
