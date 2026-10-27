import { bounds } from '#shared/board';
import type { BoardItem, Person } from '#shared/types';
import { ItemShape, plainText } from '@/components/board/items';
import { union } from '@/components/board/viewport';

/**
 * A board in miniature, everything on it fitted to the box: what the
 * project page shows above "Open whiteboard". Decoration only; the board
 * itself is where the items can be read and reached.
 */
export function BoardPreview({
  items,
  people,
}: {
  items: readonly BoardItem[];
  people: Record<string, Person>;
}) {
  const box = union(items.map((b) => bounds(b)));
  if (!box) return null;
  const pad = 24;
  return (
    <svg
      aria-hidden
      className="h-40 w-full border bg-background"
      viewBox={`${box.x - pad} ${box.y - pad} ${box.w + 2 * pad} ${box.h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {items.map((item) => (
        <g
          key={item.id}
          className="board-item"
          data-color={item.color}
          style={{ transform: `translate(${item.x}px, ${item.y}px)` }}
        >
          <ItemShape
            item={item}
            box={item}
            text={plainText(item.text, people)}
          />
        </g>
      ))}
    </svg>
  );
}
