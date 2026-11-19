import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '#shared/markdown';
import { namesToTokens } from '#shared/mentions';
import {
  type DocNode,
  docToMarkdown,
  inlineToMarkdown,
  markdownToDoc,
} from '#shared/note-doc';
import type { Person } from '#shared/types';

const people: Record<string, Person> = {
  han: { id: 'han', name: 'Han', role: '', me: false },
  hans: { id: 'hans', name: 'Han Solo', role: 'Captain', me: false },
  leia: { id: 'leia', name: 'Leia Organa', role: 'General', me: true },
};

const roundTrip = (text: string) => docToMarkdown(markdownToDoc(text, people));

/** Every construct `markdown.ts` reads, as the composer writes it. */
const CONSTRUCTS: [string, string][] = [
  ['empty', ''],
  ['a paragraph', 'Plain words.'],
  ['lines of a paragraph', 'one\ntwo\nthree'],
  ['blank lines', 'one\n\ntwo\n\n\nthree\n'],
  ['a line of spaces', 'one\n   \ntwo'],
  ['heading 1', '# Title'],
  ['heading 2', '## Section'],
  ['heading 3', '### Small'],
  ['an empty heading', '## '],
  ['bold', 'a **bold** word'],
  ['italic with _', 'a _soft_ word'],
  ['italic with *', 'a *soft* word'],
  ['inline code', 'run `npm test` now'],
  ['strike', 'a ~~gone~~ word'],
  ['a link', 'see [the plan](https://example.com/plan) first'],
  ['a mailto link', '[mail](mailto:a@example.com)'],
  ['a bare URL', 'see https://example.com/a?b=c, then'],
  ['an unsafe link stays text', '[x](javascript:alert(1))'],
  ['nested marks', '**bold _and italic_ here**'],
  ['italic around bold', '_soft **loud**_'],
  ['marks in a link', '[**loud** label](https://example.com)'],
  ['code is literal', '`**not bold**` and `@Han`'],
  ['snake_case stays text', 'snake_case_name and 2*3*4'],
  ['a quote', '> Someone said\n> two lines'],
  ['an empty quote line', '> one\n>\n> two'],
  ['a divider', 'above\n---\nbelow'],
  ['bullets', '- one\n- two\n- three'],
  ['star and dot bullets', '* one\n• two'],
  ['an empty bullet', '- '],
  ['numbered', '1. one\n2. two\n3. three'],
  ['numbered from 3', '3. three\n4. four'],
  ['numbered with )', '1) one\n2) two'],
  ['a checklist', '- [ ] open\n- [x] done'],
  ['an empty checklist item', '- [ ] '],
  ['checklist with *', '* [ ] open'],
  ['marks in list items', '- **a** b\n1. `c`\n- [ ] _d_'],
  ['kinds next to each other', '- a\n- [ ] b\n1. c\n> d\n# e\nf'],
  ['a code block', '```\nconst a = 1;\n\nreturn a;\n```'],
  ['a code block with a language', '```ts\nlet b = 2;\n```'],
  ['a code block of blank lines', '```\n\n\n```'],
  [
    'markup inside a code block',
    '```\n# not a heading\n- not a list\n@Han\n```',
  ],
  ['mentions', 'Ask @Han Solo, then @Han and @Leia Organa.'],
  ['a mention in marks', '**@Han** and [@Leia Organa](https://example.com)'],
  ['a name nobody has', 'cc @Lando and @Hannah'],
  ['a stored token stays', 'cc @{han}'],
  ['mentions in a list', '- [ ] ask @Leia Organa'],
  ['spaces at the ends', '  indented words  '],
  [
    'a whole note',
    '# Standup\n\n## Done\n- [x] Fix the **heaters**\n- [ ] Ask @Leia Organa\n\n> Quote\n\n1. one\n2. two\n\n```sh\nnpm test\n```\n---\nThanks, see https://example.com.',
  ],
];

describe('note editor document', () => {
  it.each(CONSTRUCTS)('%s round-trips unchanged', (_, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it.each(CONSTRUCTS)('%s renders the same after the trip', (_, text) => {
    const stored = (t: string) => parseMarkdown(namesToTokens(t, people));
    expect(stored(roundTrip(text))).toEqual(stored(text));
  });

  it('spellings the renderer treats alike come back in their usual form', () => {
    const cases: [string, string][] = [
      ['  - indented', '- indented'],
      ['-   wide', '- wide'],
      ['#### deep', '### deep'],
      ['#   wide', '# wide'],
      ['- [X] done', '- [x] done'],
      ['- [ ]', '- [ ] '],
      ['1. a\n1. b', '1. a\n2. b'],
      ['>quote', '> quote'],
      ['-----', '---'],
      ['```js\nx\n```js', '```js\nx\n```'],
      ['```\nunclosed', '```\nunclosed\n```'],
      ['```\n\n```', '```\n```'],
      ['a\r\nb', 'a\nb'],
    ];
    for (const [text, out] of cases) {
      expect(roundTrip(text)).toBe(out);
      expect(parseMarkdown(roundTrip(text))).toEqual(parseMarkdown(text));
    }
  });

  it('makes one block a line, a mention node per known name', () => {
    expect(markdownToDoc('# Hi @Han Solo\n- [x] **a**', people)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mention', attrs: { id: 'hans', label: 'Han Solo' } },
          ],
        },
        {
          type: 'taskList',
          attrs: {},
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true, marker: '-' },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('reads no mentions without people', () => {
    expect(markdownToDoc('@Han').content?.[0]?.content).toEqual([
      { type: 'text', text: '@Han' },
    ]);
  });

  it('writes marks that hug their words, and closes them in order', () => {
    const t = (text: string, marks: DocNode['marks'] = []): DocNode => ({
      type: 'text',
      text,
      ...(marks.length ? { marks } : {}),
    });
    const bold = { type: 'bold' as const };
    const italic = { type: 'italic' as const };
    expect(inlineToMarkdown([t('a '), t(' b ', [bold]), t('c')])).toBe(
      'a  **b** c',
    );
    expect(inlineToMarkdown([t('   ', [bold])])).toBe('   ');
    expect(
      inlineToMarkdown([t('a', [bold]), t('b', [bold, italic]), t('c')]),
    ).toBe('**a_b_**c');
    expect(
      inlineToMarkdown([
        t('x', [{ type: 'link', attrs: { href: 'https://a.b' } }]),
        t('y', [{ type: 'link', attrs: { href: 'https://c.d' } }]),
      ]),
    ).toBe('[x](https://a.b)[y](https://c.d)');
    expect(
      inlineToMarkdown([
        { type: 'mention', attrs: { id: 'han', label: 'Han' }, marks: [bold] },
      ]),
    ).toBe('**@Han**');
  });
});
