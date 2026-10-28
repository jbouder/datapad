/**
 * The sizes text is set at on the board, and the sizes of its boxes,
 * shared by the canvas (`items.tsx`), the gestures (`gesture.ts`) and the
 * export (`export.ts`), which must not pull in JSX.
 */
export const STICKY_FONT = 16;
export const STICKY_PAD = 12;
export const TEXT_FONT = 20;
export const TEXT_PAD = 4;
/** A new sticky's side, in board units. */
export const STICKY_SIZE = 200;
/** The smallest a resize leaves a box. */
export const MIN_SIZE = 40;
