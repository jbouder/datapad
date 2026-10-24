/** The textarea styles that decide where a character lands. */
const COPIED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const;

/**
 * Where character `pos` of a textarea sits, relative to the textarea's
 * top-left and after its scroll, measured with an off-screen mirror.
 */
export function caretPosition(
  el: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number; height: number } {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const key of COPIED) mirror.style[key] = style[key];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = el.value.slice(pos) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const height = Number.parseFloat(style.lineHeight) || marker.offsetHeight;
  const result = {
    top: marker.offsetTop - el.scrollTop,
    left: marker.offsetLeft - el.scrollLeft,
    height,
  };
  mirror.remove();
  return result;
}
