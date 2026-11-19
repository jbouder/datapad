import { type CaptureKind, SLASH_KINDS } from './capture';
import { addDays } from './dates';
import type { MarkType } from './note-doc';

/**
 * The note composer's commands, as pure functions: the `/` menu, the
 * formatting keys and what each one does. The editor
 * (`src/components/NoteComposer.tsx`) carries out the plan on its
 * document; the document is stored as the Markdown `markdown.ts` renders
 * (`note-doc.ts`).
 */

export type CommandId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'text'
  | 'bullet'
  | 'numbered'
  | 'checklist'
  | 'code'
  | 'quote'
  | 'divider'
  | 'date'
  | 'time'
  | 'mention'
  | 'task'
  | 'decide'
  | 'waiting'
  | 'note'
  | 'meeting'
  | 'milestone'
  | 'project'
  | 'person';

/** The commands that make something from the line (#375). */
export type CreateCommandId = Extract<
  CommandId,
  | 'task'
  | 'decide'
  | 'waiting'
  | 'note'
  | 'meeting'
  | 'milestone'
  | 'project'
  | 'person'
>;

export const CREATE_COMMANDS: readonly CreateCommandId[] = [
  'task',
  'decide',
  'waiting',
  'note',
  'meeting',
  'milestone',
  'project',
  'person',
];

export function isCreateCommand(id: CommandId): id is CreateCommandId {
  return (CREATE_COMMANDS as readonly CommandId[]).includes(id);
}

/** What a create command makes, as the capture line names it. */
export function captureKindOf(id: CreateCommandId): CaptureKind {
  return SLASH_KINDS[id] ?? 'note';
}

export interface Command {
  id: CommandId;
  label: string;
  description: string;
  /** The Markdown it produces, shown in the menu. */
  markdown: string;
}

export const COMMANDS: readonly Command[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Big section heading',
    markdown: '# ',
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium heading',
    markdown: '## ',
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small heading',
    markdown: '### ',
  },
  {
    id: 'text',
    label: 'Text',
    description: 'Plain body text',
    markdown: 'text',
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    description: 'A simple list',
    markdown: '- ',
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    description: 'A list with numbers',
    markdown: '1. ',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    description: 'Items to tick off',
    markdown: '- [ ] ',
  },
  {
    id: 'code',
    label: 'Code block',
    description: 'Monospace, kept as typed',
    markdown: '```',
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Someone else’s words',
    markdown: '> ',
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'A line across',
    markdown: '---',
  },
  {
    id: 'date',
    label: 'Date',
    description: 'Today, or /date tomorrow',
    markdown: 'YYYY-MM-DD',
  },
  { id: 'time', label: 'Time', description: 'The time now', markdown: 'HH:MM' },
  {
    id: 'mention',
    label: 'Mention',
    description: 'Name someone',
    markdown: '@Name',
  },
  {
    id: 'task',
    label: 'Task',
    description: 'Make this line a task',
    markdown: '- [ ] ',
  },
  {
    id: 'decide',
    label: 'To decide',
    description: 'Make this line something to decide',
    markdown: '- [ ] ',
  },
  {
    id: 'waiting',
    label: 'Waiting on',
    description: 'A task waiting on the @Name in the line',
    markdown: '- [ ] ',
  },
  {
    id: 'note',
    label: 'Note',
    description: 'Move this line into a note of its own',
    markdown: 'new note',
  },
  {
    id: 'meeting',
    label: 'Meeting',
    description: 'A meeting named by the line: fri 10am',
    markdown: 'meeting',
  },
  {
    id: 'milestone',
    label: 'Milestone',
    description: 'A milestone on the project: by fri',
    markdown: 'milestone',
  },
  {
    id: 'project',
    label: 'Project',
    description: 'A new project named by the line',
    markdown: 'project',
  },
  {
    id: 'person',
    label: 'Person',
    description: 'Add the line’s name to People',
    markdown: '@Name',
  },
];

/**
 * The composer's formatting keys, all with ⌘ (Ctrl elsewhere). The
 * composer binds exactly these and the Help page lists them, so the two
 * cannot drift. Letters match `key`; digits and X match `code`, which
 * stays put when Shift or Alt changes the character.
 */
export interface FormatShortcut {
  label: string;
  shift?: boolean;
  alt?: boolean;
  /** A letter, matched against `KeyboardEvent.key` (any case). */
  key?: string;
  /** A physical key, matched against `KeyboardEvent.code`. */
  code?: string;
  /** Wrap the selection in this mark, a link, or run a `/` command. */
  does: { wrap: string } | { link: true } | { command: CommandId };
}

export const FORMAT_SHORTCUTS: readonly FormatShortcut[] = [
  { label: 'Bold', key: 'b', does: { wrap: '**' } },
  { label: 'Italic', key: 'i', does: { wrap: '_' } },
  { label: 'Inline code', key: 'e', does: { wrap: '`' } },
  { label: 'Link', key: 'k', does: { link: true } },
  { label: 'Strikethrough', shift: true, code: 'KeyX', does: { wrap: '~~' } },
  {
    label: 'Numbered list',
    shift: true,
    code: 'Digit7',
    does: { command: 'numbered' },
  },
  {
    label: 'Bulleted list',
    shift: true,
    code: 'Digit8',
    does: { command: 'bullet' },
  },
  {
    label: 'Checklist',
    shift: true,
    code: 'Digit9',
    does: { command: 'checklist' },
  },
  { label: 'Heading 1', alt: true, code: 'Digit1', does: { command: 'h1' } },
  { label: 'Heading 2', alt: true, code: 'Digit2', does: { command: 'h2' } },
  { label: 'Heading 3', alt: true, code: 'Digit3', does: { command: 'h3' } },
  { label: 'Body text', alt: true, code: 'Digit0', does: { command: 'text' } },
];

/** The shortcut a ⌘/Ctrl key press means, if any. */
export function matchFormatShortcut(e: {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
}): FormatShortcut | undefined {
  return FORMAT_SHORTCUTS.find(
    (s) =>
      Boolean(s.shift) === e.shiftKey &&
      Boolean(s.alt) === e.altKey &&
      (s.key ? e.key.toLowerCase() === s.key : e.code === s.code),
  );
}

/** "⌘/Ctrl+Shift+7", for the Help page. */
export function describeFormatKeys(s: FormatShortcut): string {
  const key = s.key
    ? s.key.toUpperCase()
    : (s.code ?? '').replace(/^(Digit|Key)/, '');
  return ['⌘/Ctrl', s.shift && 'Shift', s.alt && 'Alt', key]
    .filter(Boolean)
    .join('+');
}

export interface Context {
  /** `YYYY-MM-DD`, local. */
  today: string;
  /** `HH:MM`, local. */
  time: string;
}

/* ---- Lines ------------------------------------------------------------- */

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

const FENCE_LINE = /^\s*```/;

/** Whether `pos` sits inside a fenced code block (after its opening). */
export function inFence(text: string, pos: number): boolean {
  const before = text.slice(0, lineStart(text, pos));
  let open = false;
  for (const line of before.split('\n')) {
    if (FENCE_LINE.test(line)) open = !open;
  }
  return open;
}

/* ---- What a command does ------------------------------------------------ */

/** The kinds of line a command or a formatting key turns a line into. */
export type BlockKind =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'text'
  | 'bullet'
  | 'numbered'
  | 'checklist'
  | 'quote'
  | 'code';

/**
 * What a create command does to its line once the thing is made (#375):
 * a checklist item (`/task`, `/decide`, `/waiting`), a mention of the new
 * person (`/person`), gone into a note of its own (`/note`), or as it was.
 */
export type LineAfter = 'checklist' | 'mention' | 'remove' | 'keep';

export type CommandPlan =
  /** The line becomes this kind; already that kind, body text. */
  | { block: BlockKind }
  | { divider: true }
  /** Text at the caret. */
  | { insert: string }
  /** Make something from the line, then change the line. */
  | { create: CreateCommandId; line: LineAfter };

/** The day `/date` names: today, or `/date tomorrow`, `/date yesterday`. */
export function dateFor(arg: string, today: string): string {
  const word = arg.trim();
  if (/^tom/i.test(word)) return addDays(today, 1);
  if (/^yes/i.test(word)) return addDays(today, -1);
  return today;
}

/**
 * What one `/` command (or its formatting key) does. `arg` is what
 * follows the command in the menu (`/date tomorrow`).
 */
export function planCommand(
  id: CommandId,
  ctx: Context,
  arg = '',
): CommandPlan {
  switch (id) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'text':
    case 'bullet':
    case 'numbered':
    case 'checklist':
    case 'quote':
    case 'code':
      return { block: id };
    case 'divider':
      return { divider: true };
    case 'date':
      return { insert: dateFor(arg, ctx.today) };
    case 'time':
      return { insert: ctx.time };
    case 'mention':
      return { insert: '@' };
    case 'task':
    case 'decide':
    case 'waiting':
      return { create: id, line: 'checklist' };
    case 'person':
      return { create: id, line: 'mention' };
    case 'note':
      return { create: id, line: 'remove' };
    case 'meeting':
    case 'milestone':
    case 'project':
      return { create: id, line: 'keep' };
  }
}

/** `/person`'s line: the name, as a mention (without a second `@`). */
export function personLine(line: string): string {
  return `@${line.trim().replace(/^@/, '')}`;
}

/** The mark a formatting key's Markdown wrap stands for. */
export function markOf(wrap: string): MarkType {
  switch (wrap) {
    case '**':
      return 'bold';
    case '`':
      return 'code';
    case '~~':
      return 'strike';
    default:
      return 'italic';
  }
}

/**
 * A safe address for the link key, or null: `https://` goes in front of
 * a bare host, and only http(s) and mailto are kept (as `safeHref`).
 */
export function linkHref(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  return /^(https?:\/\/[^/\s]|mailto:\S)/i.test(full) ? full : null;
}

/* ---- The `/` menu ------------------------------------------------------ */

/**
 * The `/command` being typed at `caret`: a `/` at the start of a line or
 * after a space, then letters (and, for `/date` and `/template`, one
 * more word). Never
 * inside a fenced block; `a/b` and URLs do nothing.
 */
export function slashQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[ \t\n])\/([a-z0-9]*(?: [a-z0-9]*)?)$/i.exec(before);
  if (!m) return null;
  if (inFence(text, caret)) return null;
  const query = m[2] ?? '';
  return { start: caret - query.length - 1, query };
}

/** The commands a query names, in menu order. */
export function matchCommands(query: string): Command[] {
  const [word = '', rest] = query.toLowerCase().split(' ');
  if (rest !== undefined && word !== 'date') return [];
  return COMMANDS.filter(
    (c) =>
      c.id.startsWith(word) ||
      c.label.toLowerCase().startsWith(word) ||
      c.label.toLowerCase().includes(` ${word}`),
  );
}

/** A note template as the `/` menu offers it, mentions as names. */
export interface TemplateChoice {
  id: string;
  name: string;
  body: string;
}

/**
 * The note templates a query names, after the commands in the menu:
 * all of them on a bare `/`; those a word of whose name starts with the
 * query (`/retro`); every one for `/t…`, `/template`, and `/template
 * retro` narrows by name.
 */
export function matchTemplates(
  query: string,
  templates: readonly TemplateChoice[],
): TemplateChoice[] {
  const [word = '', rest] = query.toLowerCase().split(' ');
  const named = (t: TemplateChoice, w: string) =>
    t.name
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part.startsWith(w));
  if (rest !== undefined) {
    if (!word || !'template'.startsWith(word)) return [];
    return rest ? templates.filter((t) => named(t, rest)) : [...templates];
  }
  if (!word || 'template'.startsWith(word)) return [...templates];
  return templates.filter((t) => named(t, word));
}

/**
 * A template's body as it goes into a note. Bodies are saved trimmed, so
 * a last line that is a bare list marker (`-`, `- [ ]`, `1.`) gets its
 * space back, ready to type.
 */
export function templateBody(body: string): string {
  const block = body.replace(/\s+$/, '');
  return /(^|\n)\s*([-*•]( \[[ xX]\])?|\d{1,9}[.)])$/.test(block)
    ? `${block} `
    : block;
}
