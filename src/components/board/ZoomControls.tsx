import { CornersOutIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { MAX_ZOOM, MIN_ZOOM } from '@/components/board/viewport';

const BUTTON =
  'press flex h-11 min-w-11 items-center justify-center px-2 text-sm outline-ring/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:opacity-50 desk:h-9 desk:min-w-9';

/**
 * The zoom controls in the board's corner (top right on a phone, bottom
 * right on desktop): out, the zoom (which resets to 100%), in, and Fit.
 */
export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const percent = Math.round(zoom * 100);
  return (
    <fieldset className="absolute top-2 right-2 z-10 m-0 flex min-w-0 items-center border bg-background/95 p-0 shadow-sm desk:top-auto desk:right-3 desk:bottom-3">
      <legend className="sr-only">Zoom</legend>
      <button
        type="button"
        className={BUTTON}
        onClick={onZoomOut}
        disabled={zoom <= MIN_ZOOM + 1e-6}
        aria-label="Zoom out"
      >
        <MinusIcon aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={`${BUTTON} tabular-nums`}
        onClick={onReset}
        data-zoom={percent}
      >
        {percent}%<span className="sr-only">, reset to 100%</span>
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={onZoomIn}
        disabled={zoom >= MAX_ZOOM - 1e-6}
        aria-label="Zoom in"
      >
        <PlusIcon aria-hidden className="size-4" />
      </button>
      <button type="button" className={`${BUTTON} gap-1.5`} onClick={onFit}>
        <CornersOutIcon aria-hidden className="size-4" />
        Fit
      </button>
    </fieldset>
  );
}
