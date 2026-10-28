/**
 * The whiteboard's tools, as plain data (no JSX), so the pointer gestures
 * (`gesture.ts`) and their tests can name them. The toolbar's labels,
 * keys and icons are `TOOL_INFO` in `Toolbar.tsx`.
 */

/** What a pointer on the board does. */
export const TOOLS = [
  'select',
  'sticky',
  'text',
  'rect',
  'arrow',
  'ink',
  'eraser',
] as const;
export type Tool = (typeof TOOLS)[number];

/** Tools that draw by dragging: one finger draws with them, two pan. */
export function draws(tool: Tool): tool is 'rect' | 'arrow' | 'ink' | 'eraser' {
  return (
    tool === 'rect' || tool === 'arrow' || tool === 'ink' || tool === 'eraser'
  );
}
