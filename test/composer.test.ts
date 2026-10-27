import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  COMMANDS,
  type CommandId,
  type Context,
  continueList,
  describeFormatKeys,
  type Edit,
  FORMAT_SHORTCUTS,
  inList,
  insertTemplate,
  matchCommands,
  matchFormatShortcut,
  matchTemplates,
  slashQuery,
  toggleLink,
  toggleWrap,
} from '#shared/composer';
import { parseMarkdown } from '#shared/markdown';

/**
 * Text with the selection marked: `|` is a caret, `«`…`»` a selection.
 */
function mark(source: string): Edit {
  const caret = source.indexOf('|');
  if (caret !== -1) {
    return {
      text: source.replace('|', ''),
      sel: { start: caret, end: caret },
    };
  }
  const start = source.indexOf('«');
  const end = source.indexOf('»') - 1;
  return {
    text: source.replace('«', '').replace('»', ''),
    sel: { start, end },
  };
}

function show({ text, sel }: Edit): string {
  if (sel.start === sel.end) {
    return `${text.slice(0, sel.start)}|${text.slice(sel.start)}`;
  }
  return `${text.slice(0, sel.start)}«${text.slice(sel.start, sel.end)}»${text.slice(sel.end)}`;
}

const ctx: Context = { today: '2026-10-24', time: '09:30' };

describe('applyCommand', () => {
  const cases: [CommandId, string, string, string?][] = [
    ['h1', 'Plan|', '# Plan|'],
    ['h2', 'Pl|an', '## Pl|an'],
    ['h3', '# Plan|', '### Plan|'],
    ['h2', '## Plan|', 'Plan|'], // toggles off
    ['text', '### Plan|', 'Plan|'],
    ['text', '- [x] Plan|', 'Plan|'],
    ['bullet', 'one|', '- one|'],
    ['bullet', '- one|', 'one|'],
    ['bullet', '1. one|', '- one|'],
    ['numbered', '«a\nb\nc»', '«1. a\n2. b\n3. c»'],
    ['numbered', '«1. a\n2. b»', '«a\nb»'],
    ['checklist', 'buy milk|', '- [ ] buy milk|'],
    ['checklist', '«- a\nb»', '«- [ ] a\n- [ ] b»'],
    ['quote', 'said|', '> said|'],
    ['code', '|', '```\n|\n```'],
    ['code', 'above|', 'above\n```\n|\n```'],
    ['code', '«x = 1»', '```\n«x = 1»\n```'],
    ['divider', '|', '---\n|'],
    ['divider', 'end|', 'end\n---\n|'],
    ['date', 'on |', 'on 2026-10-24|'],
    ['date', 'on |', 'on 2026-10-25|', 'tomorrow'],
    ['time', 'at |', 'at 09:30|'],
    ['mention', 'cc |', 'cc @|'],
  ];

  it.each(cases)('%s: %j → %j', (id, before, after, arg) => {
    const { text, sel } = mark(before);
    expect(show(applyCommand(text, sel, id, ctx, arg))).toBe(after);
  });

  it('/task turns the line into a checklist item and names the task', () => {
    const { text, sel } = mark('notes\n- call the vet|\nmore');
    const result = applyCommand(text, sel, 'task', ctx);
    expect(show(result)).toBe('notes\n- [ ] call the vet|\nmore');
    expect(result.task).toBe('call the vet');
    expect(applyCommand('', { start: 0, end: 0 }, 'task', ctx).task).toBe(
      undefined,
    );
  });

  it('every command produces what the renderer reads', () => {
    const h = applyCommand('Title', { start: 5, end: 5 }, 'h2', ctx);
    expect(parseMarkdown(h.text)[0]).toMatchObject({ t: 'h', level: 2 });
    const c = applyCommand('a', { start: 1, end: 1 }, 'checklist', ctx);
    expect(parseMarkdown(c.text)[0]).toMatchObject({ t: 'check' });
    const code = applyCommand('', { start: 0, end: 0 }, 'code', ctx);
    expect(parseMarkdown(code.text)[0]).toMatchObject({ t: 'code' });
    const q = applyCommand('a', { start: 1, end: 1 }, 'quote', ctx);
    expect(parseMarkdown(q.text)[0]).toMatchObject({ t: 'quote' });
    const hr = applyCommand('', { start: 0, end: 0 }, 'divider', ctx);
    expect(parseMarkdown(hr.text)[0]).toMatchObject({ t: 'hr' });
  });
});

describe('inline shortcuts', () => {
  const cases: [string, string, string][] = [
    ['**', 'make «bold» now', 'make **«bold»** now'],
    ['**', 'make **«bold»** now', 'make «bold» now'],
    ['**', 'make «**bold**» now', 'make «bold» now'],
    ['_', 'an «aside»', 'an _«aside»_'],
    ['`', 'run «ls»', 'run `«ls»`'],
    ['~~', '«old»', '~~«old»~~'],
    ['**', 'x |', 'x **|**'],
  ];
  it.each(cases)('%s on %j', (m, before, after) => {
    const { text, sel } = mark(before);
    expect(show(toggleWrap(text, sel, m))).toBe(after);
  });

  it('links wrap the selection and select the URL to type over', () => {
    const { text, sel } = mark('see «the doc»');
    expect(show(toggleLink(text, sel))).toBe('see [the doc](«https://»)');
  });

  it('a selected link goes back to its label; nothing selected gets a placeholder', () => {
    const linked = mark('«[x](https://a.b)»');
    expect(show(toggleLink(linked.text, linked.sel))).toBe('«x»');
    expect(show(toggleLink('', { start: 0, end: 0 }))).toBe(
      '[«text»](https://)',
    );
  });
});

describe('the / menu', () => {
  it('opens at a line start or after a space, never mid-word', () => {
    expect(slashQuery('/h', 2)).toEqual({ start: 0, query: 'h' });
    expect(slashQuery('a\n/che', 6)).toEqual({ start: 2, query: 'che' });
    expect(slashQuery('try /date tom', 13)).toEqual({
      start: 4,
      query: 'date tom',
    });
    expect(slashQuery('and/or', 4)).toBeNull();
    expect(slashQuery('see https://x.com/', 18)).toBeNull();
  });

  it('never opens inside a fenced block', () => {
    const text = '```\n/h';
    expect(slashQuery(text, text.length)).toBeNull();
    const after = '```\nx\n```\n/h';
    expect(slashQuery(after, after.length)).not.toBeNull();
  });

  it('filters by id or label', () => {
    expect(matchCommands('').length).toBe(COMMANDS.length);
    expect(matchCommands('h').map((c) => c.id)).toEqual(['h1', 'h2', 'h3']);
    expect(matchCommands('che').map((c) => c.id)).toEqual(['checklist']);
    expect(matchCommands('list').map((c) => c.id)).toEqual([
      'bullet',
      'numbered',
    ]);
    expect(matchCommands('date tomorrow').map((c) => c.id)).toEqual(['date']);
    expect(matchCommands('h1 x')).toEqual([]);
  });
});

describe('note templates in the / menu', () => {
  const templates = [
    { id: 't1', name: 'Weekly 1:1', body: '## Wins\n- ' },
    { id: 't2', name: 'Sprint retro', body: '## Went well\n- ' },
    { id: 't3', name: 'Q3 review', body: '# Q3' },
  ];
  const ids = (query: string) =>
    matchTemplates(query, templates).map((t) => t.id);

  it('lists every one on a bare / and for /t… and /template', () => {
    expect(ids('')).toEqual(['t1', 't2', 't3']);
    expect(ids('t')).toEqual(['t1', 't2', 't3']);
    expect(ids('template')).toEqual(['t1', 't2', 't3']);
    expect(ids('template ')).toEqual(['t1', 't2', 't3']);
  });

  it('matches a word of the name, and /template narrows by one', () => {
    expect(ids('retro')).toEqual(['t2']);
    expect(ids('week')).toEqual(['t1']);
    expect(ids('h1')).toEqual([]);
    expect(ids('template retro')).toEqual(['t2']);
    expect(ids('template q3')).toEqual(['t3']);
    expect(ids('date tomorrow')).toEqual([]);
  });

  it('reads a second word with digits after /template', () => {
    expect(slashQuery('/template q3', 12)).toEqual({
      start: 0,
      query: 'template q3',
    });
  });

  it('inserts on an empty line, or from the next one, caret after', () => {
    expect(insertTemplate('', { start: 0, end: 0 }, '## Wins\n- \n')).toEqual({
      text: '## Wins\n- ',
      sel: { start: 10, end: 10 },
    });
    expect(insertTemplate('Notes', { start: 5, end: 5 }, '# Q3')).toEqual({
      text: 'Notes\n# Q3',
      sel: { start: 10, end: 10 },
    });
    expect(insertTemplate('', { start: 0, end: 0 }, 'Todo\n- [ ]').text).toBe(
      'Todo\n- [ ] ',
    );
  });
});

describe('list continuation', () => {
  const cases: [string, string | null][] = [
    ['- one|', '- one\n- |'],
    ['* one|', '* one\n* |'],
    ['• one|', '• one\n• |'],
    ['3. three|', '3. three\n4. |'],
    ['1) one|', '1) one\n2) |'],
    ['- [x] done|', '- [x] done\n- [ ] |'],
    ['- [ ] to|do', '- [ ] to\n- [ ] |do'],
    ['a\n- |', 'a\n|'],
    ['- [ ] |', '|'],
    ['plain|', null],
    ['```\n- in code|', null],
  ];
  it.each(cases)('%j', (before, after) => {
    const { text, sel } = mark(before);
    const result = continueList(text, sel);
    expect(result ? show(result) : null).toBe(after);
  });

  it('knows a list line, for Tab', () => {
    expect(inList('- a', { start: 1, end: 1 })).toBe(true);
    expect(inList('a', { start: 1, end: 1 })).toBe(false);
  });
});

describe('formatting keys', () => {
  const press = (key: string, code: string, shiftKey = false, altKey = false) =>
    matchFormatShortcut({ key, code, shiftKey, altKey })?.label;

  it('match exactly the modifiers they name', () => {
    expect(press('b', 'KeyB')).toBe('Bold');
    expect(press('B', 'KeyB')).toBe('Bold');
    expect(press('k', 'KeyK')).toBe('Link');
    expect(press('X', 'KeyX', true)).toBe('Strikethrough');
    expect(press('*', 'Digit8', true)).toBe('Bulleted list');
    // Alt changes the character on a Mac; the physical key still counts.
    expect(press('¡', 'Digit1', false, true)).toBe('Heading 1');
    expect(press('º', 'Digit0', false, true)).toBe('Body text');
    expect(press('b', 'KeyB', true)).toBeUndefined();
    expect(press('x', 'KeyX')).toBeUndefined();
  });

  it('every command they run exists, and none collide', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const s of FORMAT_SHORTCUTS) {
      if ('command' in s.does) expect(ids.has(s.does.command)).toBe(true);
    }
    const combos = FORMAT_SHORTCUTS.map(describeFormatKeys);
    expect(new Set(combos).size).toBe(combos.length);
    expect(combos).toContain('⌘/Ctrl+Shift+7');
    expect(combos).toContain('⌘/Ctrl+Alt+1');
    expect(combos).toContain('⌘/Ctrl+B');
  });
});
