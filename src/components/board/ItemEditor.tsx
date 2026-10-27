import { useEffect, useRef, useState } from 'react';
import type { Box } from '#shared/board';
import { LIMITS } from '#shared/limits';
import type { BoardItem } from '#shared/types';
import {
  KIND_LABELS,
  measureText,
  STICKY_FONT,
  STICKY_PAD,
  TEXT_FONT,
  TEXT_PAD,
} from '@/components/board/items';

/**
 * Editing a sticky's, a text's or a rect's words in place: a textarea in
 * a `foreignObject` over the item, at the board's zoom. Esc cancels; blur
 * or ⌘/Ctrl+Enter saves (one `editBoardItem`, sent by `onDone`). Free text
 * grows as you type.
 */
export function ItemEditor({
  item,
  box,
  onDone,
}: {
  item: BoardItem;
  box: Box;
  /** The text to save, or null to cancel. Called once. */
  onDone: (text: string | null) => void;
}) {
  const [value, setValue] = useState(item.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const isText = item.kind === 'text';
  const grown = isText ? measureText(value) : null;
  const w = grown ? Math.max(box.w, grown.w, 160) : box.w;
  const h = grown ? Math.max(box.h, grown.h) : box.h;
  const font = isText ? TEXT_FONT : STICKY_FONT;
  const pad = isText ? TEXT_PAD : STICKY_PAD;

  return (
    <foreignObject x={box.x} y={box.y} width={w} height={h}>
      <textarea
        ref={ref}
        aria-label={`${KIND_LABELS[item.kind]} text`}
        value={value}
        maxLength={LIMITS.boardTextMax}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(null);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            finish(value);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="board-text block size-full resize-none bg-transparent text-card-foreground outline-2 outline-ring outline-offset-0"
        style={{ padding: pad, fontSize: font }}
      />
    </foreignObject>
  );
}
