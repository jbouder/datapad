import { describe, expect, it } from 'vitest';
import {
  type Block,
  type Inline,
  parseInline,
  parseMarkdown,
  toggleCheck,
} from '#shared/markdown';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import type { Person } from '#shared/types';

const text = (v: string): Inline => ({ t: 'text', v });

describe('blocks', () => {
  const cases: [string, string, Block[]][] = [
    ['heading 1', '# Title', [{ t: 'h', level: 1, c: [text('Title')] }]],
    ['heading 2', '## Title', [{ t: 'h', level: 2, c: [text('Title')] }]],
    ['heading 3', '### Title', [{ t: 'h', level: 3, c: [text('Title')] }]],
    ['deeper is 3', '###### Deep', [{ t: 'h', level: 3, c: [text('Deep')] }]],
    ['no space, no heading', '#tag', [{ t: 'p', lines: [[text('#tag')]] }]],
    [
      'paragraph lines stay lines',
      'one\ntwo',
      [{ t: 'p', lines: [[text('one')], [text('two')]] }],
    ],
    [
      'blank line, new paragraph',
      'one\n\ntwo',
      [
        { t: 'p', lines: [[text('one')]] },
        { t: 'p', lines: [[text('two')]] },
      ],
    ],
    [
      'bullets: - * •',
      '- a\n* b\n• c',
      [{ t: 'ul', items: [[text('a')], [text('b')], [text('c')]] }],
    ],
    [
      'checklist',
      '- [ ] open\n- [x] done\n* [X] also',
      [
        {
          t: 'check',
          items: [
            { line: 0, checked: false, c: [text('open')] },
            { line: 1, checked: true, c: [text('done')] },
            { line: 2, checked: true, c: [text('also')] },
          ],
        },
      ],
    ],
    [
      'numbered: 1. and 1)',
      '3. c\n4) d',
      [{ t: 'ol', start: 3, items: [[text('c')], [text('d')]] }],
    ],
    [
      'fenced code with language',
      '```ts\nconst a = 1;\n  <b>\n```',
      [{ t: 'code', lang: 'ts', text: 'const a = 1;\n  <b>' }],
    ],
    [
      'fence keeps markup as text',
      '```\n# not a heading\n- [ ] not a box\n```',
      [{ t: 'code', lang: '', text: '# not a heading\n- [ ] not a box' }],
    ],
    [
      'unclosed fence runs to the end',
      '```\nopen',
      [{ t: 'code', lang: '', text: 'open' }],
    ],
    [
      'quote',
      '> one\n> two',
      [{ t: 'quote', lines: [[text('one')], [text('two')]] }],
    ],
    [
      'divider',
      'a\n---\nb',
      [
        { t: 'p', lines: [[text('a')]] },
        { t: 'hr' },
        { t: 'p', lines: [[text('b')]] },
      ],
    ],
    [
      'lists split by a blank line',
      '- a\n\n- b',
      [
        { t: 'ul', items: [[text('a')]] },
        { t: 'ul', items: [[text('b')]] },
      ],
    ],
    ['empty', '', []],
  ];

  it.each(cases)('%s', (_, input, blocks) => {
    expect(parseMarkdown(input)).toEqual(blocks);
  });

  it('counts checklist lines across other blocks and \\r\\n', () => {
    const blocks = parseMarkdown('# h\r\n\r\n- [ ] a\r\ntext\r\n- [x] b');
    const lines = blocks
      .filter((b) => b.t === 'check')
      .flatMap((b) => b.items.map((i) => i.line));
    expect(lines).toEqual([2, 4]);
  });
});

describe('inline', () => {
  const cases: [string, string, Inline[]][] = [
    ['plain', 'just text', [text('just text')]],
    [
      'bold',
      'a **b** c',
      [text('a '), { t: 'strong', c: [text('b')] }, text(' c')],
    ],
    [
      'italic _',
      'a _b_ c',
      [text('a '), { t: 'em', c: [text('b')] }, text(' c')],
    ],
    [
      'italic *',
      'a *b* c',
      [text('a '), { t: 'em', c: [text('b')] }, text(' c')],
    ],
    ['strike', '~~gone~~', [{ t: 's', c: [text('gone')] }]],
    ['code', 'run `a **b**`', [text('run '), { t: 'code', v: 'a **b**' }]],
    [
      'bold with italic inside',
      '**a _b_**',
      [{ t: 'strong', c: [text('a '), { t: 'em', c: [text('b')] }] }],
    ],
    ['snake_case stays plain', 'snake_case_name', [text('snake_case_name')]],
    ['maths stays plain', '2*3*4', [text('2*3*4')]],
    ['lonely markers', 'a * b _ c', [text('a * b _ c')]],
    [
      'bare URL, sentence punctuation left out',
      'see https://example.com/a?b=1.',
      [
        text('see '),
        {
          t: 'link',
          href: 'https://example.com/a?b=1',
          c: [text('https://example.com/a?b=1')],
        },
        text('.'),
      ],
    ],
    [
      'bare URL with balanced parentheses',
      '(https://en.example.org/wiki/A_(b))',
      [
        text('('),
        {
          t: 'link',
          href: 'https://en.example.org/wiki/A_(b)',
          c: [text('https://en.example.org/wiki/A_(b)')],
        },
        text(')'),
      ],
    ],
    [
      'labelled link',
      '[the **doc**](https://example.com)',
      [
        {
          t: 'link',
          href: 'https://example.com',
          c: [text('the '), { t: 'strong', c: [text('doc')] }],
        },
      ],
    ],
    [
      'unsafe scheme stays text',
      '[x](javascript:alert(1))',
      [text('[x](javascript:alert(1))')],
    ],
    ['mention', 'ask @{p1}', [text('ask '), { t: 'mention', id: 'p1' }]],
    [
      'html is text',
      '<script>alert(1)</script>',
      [text('<script>alert(1)</script>')],
    ],
  ];

  it.each(cases)('%s', (_, input, nodes) => {
    expect(parseInline(input)).toEqual(nodes);
  });
});

describe('toggleCheck', () => {
  const body = '# Plan\n- [ ] one\n- [x] two\nplain';

  it('flips only that line', () => {
    expect(toggleCheck(body, 1)).toBe('# Plan\n- [x] one\n- [x] two\nplain');
    expect(toggleCheck(body, 2)).toBe('# Plan\n- [ ] one\n- [ ] two\nplain');
  });

  it('leaves other lines and out-of-range alone', () => {
    expect(toggleCheck(body, 0)).toBe(body);
    expect(toggleCheck(body, 3)).toBe(body);
    expect(toggleCheck(body, 9)).toBe(body);
  });
});

describe('mentions through the renderer', () => {
  const people: Record<string, Person> = {
    p1: { id: 'p1', name: 'Leia Organa', role: '', me: true },
    p2: { id: 'p2', name: 'Han', role: '', me: false },
  };

  it('stores names as tokens and renders them back after a rename', () => {
    const stored = namesToTokens('- [ ] ask @Leia Organa and @Han', people);
    expect(stored).toBe('- [ ] ask @{p1} and @{p2}');
    const [list] = parseMarkdown(stored);
    expect(list).toEqual({
      t: 'check',
      items: [
        {
          line: 0,
          checked: false,
          c: [
            text('ask '),
            { t: 'mention', id: 'p1' },
            text(' and '),
            { t: 'mention', id: 'p2' },
          ],
        },
      ],
    });
    const renamed = { ...people, p1: { ...people.p1, name: 'General Organa' } };
    expect(tokensToNames(stored, renamed as Record<string, Person>)).toBe(
      '- [ ] ask @General Organa and @Han',
    );
  });

  it('reads a gone person as @unknown', () => {
    expect(tokensToNames('@{gone}', people)).toBe('@unknown');
  });
});

describe('speed', () => {
  it('parses 500 notes in well under 50ms', () => {
    const note = [
      '## Standup',
      'Talked to @{p1} about **the refit** and _timelines_.',
      '- [ ] follow up https://example.com/x',
      '- [x] book the bay',
      '1. one',
      '> quoted',
      '```',
      'const a = 1;',
      '```',
    ].join('\n');
    const notes = Array.from({ length: 500 }, (_, i) => `${note}\n${i}`);
    parseMarkdown(note); // warm up
    const start = performance.now();
    for (const n of notes) parseMarkdown(n);
    // workerd freezes timers during a request; a zero here still passes.
    expect(performance.now() - start).toBeLessThan(50);
  });
});
