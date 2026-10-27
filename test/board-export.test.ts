import { describe, expect, it } from 'vitest';
import { BOARD_COLORS, type BoardItem } from '#shared/types';
import {
  boardSvg,
  EXPORT_MARGIN,
  type ExportPalette,
  escapeXml,
  exportName,
  wrapLines,
} from '../src/components/board/export';

const palette: ExportPalette = {
  background: '#101010',
  text: '#fafafa',
  colors: Object.fromEntries(
    BOARD_COLORS.map((c, i) => [
      c,
      { tint: `#0000${i}${i}`, fill: `#1111${i}${i}`, stroke: `#2222${i}${i}` },
    ]),
  ) as ExportPalette['colors'],
};

const base: BoardItem = {
  id: 'b',
  boardId: 'p-echo',
  kind: 'sticky',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  z: 0,
  color: 'warn',
  text: '',
  points: [],
};

/** One character, 10 units wide at any size. */
const fixed = (text: string) => text.length * 10;

describe('wrapLines', () => {
  it('keeps line breaks and wraps at words', () => {
    expect(wrapLines('one two three\nfour', 80, 16, fixed)).toEqual([
      'one two',
      'three',
      'four',
    ]);
  });

  it('breaks a word longer than a line anywhere', () => {
    expect(wrapLines('abcdefghij', 40, 16, fixed)).toEqual([
      'abcd',
      'efgh',
      'ij',
    ]);
  });

  it('keeps an empty line', () => {
    expect(wrapLines('a\n\nb', 100, 16, fixed)).toEqual(['a', '', 'b']);
  });
});

describe('boardSvg', () => {
  it('is null for an empty board', () => {
    expect(boardSvg([], { palette, title: 'Empty' })).toBeNull();
  });

  it('draws every kind with resolved colors, no tokens', () => {
    const items: BoardItem[] = [
      { ...base, id: 's', w: 400, text: 'Power <budget> & @{u-han}' },
      { ...base, id: 't', kind: 'text', x: 300, w: 120, h: 40, text: 'Note' },
      {
        ...base,
        id: 'r',
        kind: 'rect',
        color: 'accent',
        x: 0,
        y: 300,
        text: 'Hangar bay',
      },
      {
        ...base,
        id: 'a',
        kind: 'arrow',
        color: 'ok',
        x: 200,
        y: 100,
        w: 100,
        h: 0,
        points: [0, 0, 100, 0],
      },
      {
        ...base,
        id: 'i',
        kind: 'ink',
        color: 'danger',
        x: 400,
        y: 400,
        w: 50,
        h: 50,
        points: [0, 0, 25, 50, 50, 0],
      },
    ];
    const out = boardSvg(items, {
      palette,
      title: 'Echo Base whiteboard',
      people: {
        'u-han': {
          id: 'u-han',
          name: 'Han Solo',
          role: '',
          email: '',
        } as never,
      },
    });
    expect(out).not.toBeNull();
    const svg = out?.svg ?? '';
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<title>Echo Base whiteboard</title>');
    // Escaped, with mentions as names.
    expect(svg).toContain('Power &lt;budget&gt; &amp; @Han Solo');
    expect(svg).toContain('Hangar bay');
    expect(svg).toContain('text-anchor="middle"');
    // The sticky's fill and outline, the rect's, arrow's and ink's tints.
    expect(svg).toContain(`fill="${palette.colors.warn.fill}"`);
    expect(svg).toContain(`stroke="${palette.colors.warn.stroke}"`);
    expect(svg).toContain(`stroke="${palette.colors.accent.tint}"`);
    expect(svg).toContain(`stroke="${palette.colors.ok.tint}"`);
    expect(svg).toContain(`stroke="${palette.colors.danger.tint}"`);
    expect(svg).toContain(`fill="${palette.background}"`);
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('foreignObject');
    // Cut to the drawing plus the margin.
    expect(out?.width).toBe(450 + 2 * EXPORT_MARGIN);
    expect(out?.height).toBe(500 + 2 * EXPORT_MARGIN);
    expect(svg).toContain(
      `viewBox="${-EXPORT_MARGIN} ${-EXPORT_MARGIN} ${out?.width} ${out?.height}"`,
    );
  });

  it('draws in the order given', () => {
    const svg =
      boardSvg(
        [
          { ...base, id: 'low', text: 'Below' },
          { ...base, id: 'high', z: 1, text: 'Above' },
        ],
        { palette, title: 'T' },
      )?.svg ?? '';
    expect(svg.indexOf('Below')).toBeLessThan(svg.indexOf('Above'));
  });

  it('leaves out lines that do not fit the sticky', () => {
    const text = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const svg = boardSvg([{ ...base, text }], { palette, title: 'T' })?.svg;
    expect(svg).toContain('line0');
    expect(svg).not.toContain('line39');
  });
});

describe('export helpers', () => {
  it('escapes XML', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('names the file after the board', () => {
    expect(exportName('Echo Base relocation', 'png')).toBe(
      'echo-base-relocation-whiteboard.png',
    );
    expect(exportName('Café — Q4!', 'svg')).toBe('cafe-q4-whiteboard.svg');
    expect(exportName('???', 'svg')).toBe('whiteboard.svg');
  });
});
