import { useCallback, useEffect, useRef, useState } from 'react';
import { keyFor } from '@/lib/spaces';
import { parseViewport, type Viewport } from './viewport';

/** Where a board's viewport is remembered on this device (`keyFor`). */
export function viewportKey(boardId: string, space: string): string {
  return keyFor(`datapad:board-view:${boardId}`, space);
}

export function readViewport(key: string): Viewport | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseViewport(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeViewport(key: string, view: Viewport) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        x: Math.round(view.x * 100) / 100,
        y: Math.round(view.y * 100) / 100,
        zoom: Math.round(view.zoom * 1000) / 1000,
      }),
    );
  } catch {
    // Private mode or full: the board still works, it just forgets.
  }
}

const SAVE_DELAY_MS = 250;

/**
 * A board's viewport, remembered per board and per space on this device
 * (a viewport is where you were looking, not data, so it does not sync).
 * Null until `init` places it, once the board knows its size. Saving is
 * debounced while panning and flushed on leaving.
 */
export function useViewport(key: string) {
  const [view, setViewState] = useState<Viewport | null>(null);
  const ref = useRef<Viewport | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (ref.current) writeViewport(key, ref.current);
  }, [key]);

  const setView = useCallback(
    (next: Viewport | ((v: Viewport) => Viewport)) => {
      const current = ref.current;
      if (!current && typeof next === 'function') return;
      const value =
        typeof next === 'function' ? next(current as Viewport) : next;
      ref.current = value;
      setViewState(value);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      if (timer.current !== undefined) flush();
    };
  }, [flush]);

  return { view, viewRef: ref, setView };
}
