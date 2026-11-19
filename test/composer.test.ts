import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  type CommandId,
  type CommandPlan,
  type Context,
  CREATE_COMMANDS,
  captureKindOf,
  dateFor,
  describeFormatKeys,
  FORMAT_SHORTCUTS,
  isCreateCommand,
  linkHref,
  markOf,
  matchCommands,
  matchFormatShortcut,
  matchTemplates,
  personLine,
  planCommand,
  slashQuery,
  templateBody,
} from '#shared/composer';
import { parseMarkdown } from '#shared/markdown';
import { docToMarkdown, markdownToDoc } from '#shared/note-doc';

const ctx: Context = { today: '2026-10-24', time: '09:30' };

describe('planCommand', () => {
  const cases: [CommandId, CommandPlan, string?][] = [
    ['h1', { block: 'h1' }],
    ['h2', { block: 'h2' }],
    ['h3', { block: 'h3' }],
    ['text', { block: 'text' }],
    ['bullet', { block: 'bullet' }],
    ['numbered', { block: 'numbered' }],
    ['checklist', { block: 'checklist' }],
    ['quote', { block: 'quote' }],
    ['code', { block: 'code' }],
    ['divider', { divider: true }],
    ['date', { insert: '2026-10-24' }],
    ['date', { insert: '2026-10-25' }, 'tomorrow'],
    ['date', { insert: '2026-10-23' }, 'yes'],
    ['time', { insert: '09:30' }],
    ['mention', { insert: '@' }],
    ['task', { create: 'task', line: 'checklist' }],
    ['decide', { create: 'decide', line: 'checklist' }],
    ['waiting', { create: 'waiting', line: 'checklist' }],
    ['person', { create: 'person', line: 'mention' }],
    ['note', { create: 'note', line: 'remove' }],
    ['meeting', { create: 'meeting', line: 'keep' }],
    ['milestone', { create: 'milestone', line: 'keep' }],
    ['project', { create: 'project', line: 'keep' }],
  ];
  it.each(cases)('%s → %j', (id, plan, arg) => {
    expect(planCommand(id, ctx, arg)).toEqual(plan);
  });

  it('plans every command in the menu', () => {
    for (const c of COMMANDS) expect(planCommand(c.id, ctx)).toBeTruthy();
  });

  it('reads /date words, today otherwise', () => {
    expect(dateFor(' Tom', '2026-12-31')).toBe('2027-01-01');
    expect(dateFor('nonsense', '2026-12-31')).toBe('2026-12-31');
  });

  it('/person mentions the line once', () => {
    expect(personLine(' Lando Calrissian ')).toBe('@Lando Calrissian');
    expect(personLine('@Lando')).toBe('@Lando');
  });

  it('the Markdown each command types is what the editor stores', () => {
    for (const c of COMMANDS) {
      const plan = planCommand(c.id, ctx);
      if (
        !('block' in plan) ||
        plan.block === 'text' ||
        plan.block === 'code'
      ) {
        continue;
      }
      const text = `${c.markdown}words`;
      expect(docToMarkdown(markdownToDoc(text))).toBe(text);
    }
    expect(parseMarkdown('---')[0]).toMatchObject({ t: 'hr' });
  });
});

describe('formatting marks and links', () => {
  it('maps each wrap to its mark', () => {
    const wraps = FORMAT_SHORTCUTS.flatMap((s) =>
      'wrap' in s.does ? [s.does.wrap] : [],
    );
    expect(wraps.map(markOf)).toEqual(['bold', 'italic', 'code', 'strike']);
  });

  it('keeps only safe link addresses, https for a bare host', () => {
    expect(linkHref('example.com/a')).toBe('https://example.com/a');
    expect(linkHref(' https://a.b ')).toBe('https://a.b');
    expect(linkHref('http://a.b')).toBe('http://a.b');
    expect(linkHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(linkHref('javascript:alert(1)')).toBeNull();
    expect(linkHref('https://')).toBeNull();
    expect(linkHref('two words')).toBeNull();
    expect(linkHref('')).toBeNull();
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
    expect(matchCommands('me').map((c) => c.id)).toEqual([
      'mention',
      'meeting',
    ]);
    expect(matchCommands('pe').map((c) => c.id)).toEqual(['person']);
  });

  it('lists every create command, each with a capture kind', () => {
    for (const id of CREATE_COMMANDS) {
      expect(COMMANDS.some((c) => c.id === id)).toBe(true);
      expect(isCreateCommand(id)).toBe(true);
    }
    expect(captureKindOf('waiting')).toBe('wait');
    expect(captureKindOf('meeting')).toBe('meeting');
    expect(isCreateCommand('h1')).toBe(false);
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

  it('gives a bare last marker its space back', () => {
    expect(templateBody('## Wins\n- \n')).toBe('## Wins\n- ');
    expect(templateBody('# Q3')).toBe('# Q3');
    expect(templateBody('Todo\n- [ ]')).toBe('Todo\n- [ ] ');
    expect(templateBody('1.')).toBe('1. ');
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
