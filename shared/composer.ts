import { addDays } from './dates';

/**
 * The note composer's editing, as pure functions over (text, selection):
 * the `/` commands, the formatting shortcuts and list continuation. The
 * textarea (`src/components/NoteComposer.tsx`) only applies the result.
 * Every edit produces exactly the Markdown `markdown.ts` renders.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface Edit {
  text: string;
  sel: Selection;
}

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
  | 'task';

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

function lineEnd(text: string, pos: number): number {
  const at = text.indexOf('\n', pos);
  return at === -1 ? text.length : at;
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

/** One line's block prefix and what follows it. */
const PREFIX =
  /^(#{1,6}\s+|>\s?|\s*[-*•]\s+\[[ xX]\]\s+|\s*[-*•]\s+|\s*\d{1,9}[.)]\s+)?(.*)$/;

function split(line: string): { prefix: string; content: string } {
  const m = PREFIX.exec(line);
  return { prefix: m?.[1] ?? '', content: m?.[2] ?? line };
}

type LineKind =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'checklist'
  | 'bullet'
  | 'numbered'
  | 'text';

function kindOf(prefix: string): LineKind {
  if (/^#\s/.test(prefix)) return 'h1';
  if (/^##\s/.test(prefix)) return 'h2';
  if (/^#{3,}\s/.test(prefix)) return 'h3';
  if (prefix.startsWith('>')) return 'quote';
  if (/\[[ xX]\]/.test(prefix)) return 'checklist';
  if (/^\s*[-*•]/.test(prefix)) return 'bullet';
  if (/^\s*\d/.test(prefix)) return 'numbered';
  return 'text';
}

function prefixFor(kind: LineKind, n: number): string {
  switch (kind) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'quote':
      return '> ';
    case 'checklist':
      return '- [ ] ';
    case 'bullet':
      return '- ';
    case 'numbered':
      return `${n}. `;
    default:
      return '';
  }
}

/**
 * Give every line the selection touches the `kind` prefix, replacing
 * whatever block prefix it had. When every line already has it, take it
 * away (back to body text): applying twice undoes.
 */
export function setLineKind(
  text: string,
  sel: Selection,
  kind: LineKind,
): Edit {
  const from = lineStart(text, sel.start);
  const to = lineEnd(text, Math.max(sel.end, sel.start));
  const lines = text.slice(from, to).split('\n');
  const parts = lines.map(split);
  const all = kind !== 'text' && parts.every((p) => kindOf(p.prefix) === kind);
  const target = all ? 'text' : kind;
  const next = parts.map((p, i) => prefixFor(target, i + 1) + p.content);
  const block = next.join('\n');
  const out = text.slice(0, from) + block + text.slice(to);

  if (sel.start === sel.end && lines.length === 1) {
    // Keep the caret on the same character of the content.
    const head = parts[0] ?? { prefix: '', content: '' };
    const offset = Math.max(0, sel.start - from - head.prefix.length);
    const at = from + (next[0]?.length ?? 0) - head.content.length + offset;
    return { text: out, sel: { start: at, end: at } };
  }
  return { text: out, sel: { start: from, end: from + block.length } };
}

/* ---- Inline ------------------------------------------------------------ */

/**
 * Wrap the selection in `mark` (`**`, `_`, `` ` ``, `~~`), or unwrap it
 * when it is already wrapped (the marks inside or just outside the
 * selection). No selection: a pair of marks with the caret between.
 */
export function toggleWrap(text: string, sel: Selection, mark: string): Edit {
  const { start, end } = sel;
  const m = mark.length;
  const inner = text.slice(start, end);
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(m, -m);
    return {
      text: text.slice(0, start) + bare + text.slice(end),
      sel: { start, end: start + bare.length },
    };
  }
  if (
    text.slice(start - m, start) === mark &&
    text.slice(end, end + m) === mark &&
    start >= m
  ) {
    return {
      text: text.slice(0, start - m) + inner + text.slice(end + m),
      sel: { start: start - m, end: end - m },
    };
  }
  return {
    text: text.slice(0, start) + mark + inner + mark + text.slice(end),
    sel: { start: start + m, end: end + m },
  };
}

const LINK = /^\[([^\]\n]*)\]\(([^)\s]*)\)$/;

/**
 * ⌘K: the selection becomes `[selection](https://)` with the URL selected
 * to type over; a selected link goes back to its label. Nothing selected:
 * `[text](https://)` with `text` selected.
 */
export function toggleLink(text: string, sel: Selection): Edit {
  const inner = text.slice(sel.start, sel.end);
  const link = LINK.exec(inner);
  if (link) {
    const label = link[1] ?? '';
    return {
      text: text.slice(0, sel.start) + label + text.slice(sel.end),
      sel: { start: sel.start, end: sel.start + label.length },
    };
  }
  if (/^https?:\/\/\S+$/.test(inner)) {
    const out = `[link](${inner})`;
    return {
      text: text.slice(0, sel.start) + out + text.slice(sel.end),
      sel: { start: sel.start + 1, end: sel.start + 5 },
    };
  }
  const label = inner || 'text';
  const out = `[${label}](https://)`;
  const urlAt = sel.start + label.length + 3;
  return {
    text: text.slice(0, sel.start) + out + text.slice(sel.end),
    sel: inner
      ? { start: urlAt, end: urlAt + 'https://'.length }
      : { start: sel.start + 1, end: sel.start + 1 + label.length },
  };
}

/* ---- Inserts ----------------------------------------------------------- */

function insert(
  text: string,
  sel: Selection,
  value: string,
  caret = value.length,
): Edit {
  return {
    text: text.slice(0, sel.start) + value + text.slice(sel.end),
    sel: { start: sel.start + caret, end: sel.start + caret },
  };
}

/** A block of its own: on an empty line, there; otherwise on the next. */
function insertBlock(
  text: string,
  sel: Selection,
  block: string,
  caret: number,
): Edit {
  const from = lineStart(text, sel.start);
  const to = lineEnd(text, sel.end);
  const line = text.slice(from, to);
  if (line.trim() === '') {
    return {
      text: text.slice(0, from) + block + text.slice(to),
      sel: { start: from + caret, end: from + caret },
    };
  }
  const at = to;
  return {
    text: `${text.slice(0, at)}\n${block}${text.slice(at)}`,
    sel: { start: at + 1 + caret, end: at + 1 + caret },
  };
}

function codeBlock(text: string, sel: Selection): Edit {
  if (sel.start !== sel.end) {
    const from = lineStart(text, sel.start);
    const to = lineEnd(text, sel.end);
    const body = text.slice(from, to);
    const block = `\`\`\`\n${body}\n\`\`\``;
    return {
      text: text.slice(0, from) + block + text.slice(to),
      sel: { start: from + 4, end: from + 4 + body.length },
    };
  }
  return insertBlock(text, sel, '```\n\n```', 4);
}

export interface CommandResult extends Edit {
  /** `/task`: the title of the task to make from the line. */
  task?: string;
}

/**
 * Apply one `/` command (or its shortcut) at the selection. `arg` is what
 * follows the command in the menu (`/date tomorrow`).
 */
export function applyCommand(
  text: string,
  sel: Selection,
  id: CommandId,
  ctx: Context,
  arg = '',
): CommandResult {
  switch (id) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'bullet':
    case 'numbered':
    case 'checklist':
    case 'quote':
      return setLineKind(text, sel, id);
    case 'text':
      return setLineKind(text, sel, 'text');
    case 'code':
      return codeBlock(text, sel);
    case 'divider':
      return insertBlock(text, sel, '---\n', 4);
    case 'date': {
      const day = /^tom/i.test(arg.trim())
        ? addDays(ctx.today, 1)
        : /^yes/i.test(arg.trim())
          ? addDays(ctx.today, -1)
          : ctx.today;
      return insert(text, sel, day);
    }
    case 'time':
      return insert(text, sel, ctx.time);
    case 'mention':
      return insert(text, sel, '@');
    case 'task': {
      const from = lineStart(text, sel.start);
      const to = lineEnd(text, sel.start);
      const { content } = split(text.slice(from, to));
      const title = content.trim().slice(0, 200);
      const line = `- [ ] ${content.trim()}`;
      return {
        text: text.slice(0, from) + line + text.slice(to),
        sel: { start: from + line.length, end: from + line.length },
        ...(title ? { task: title } : {}),
      };
    }
  }
}

/* ---- The `/` menu ------------------------------------------------------ */

/**
 * The `/command` being typed at `caret`: a `/` at the start of a line or
 * after a space, then letters (and, for `/date`, one more word). Never
 * inside a fenced block; `a/b` and URLs do nothing.
 */
export function slashQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[ \t\n])\/([a-z0-9]*(?: [a-z]*)?)$/i.exec(before);
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

/* ---- Enter and Tab in lists -------------------------------------------- */

const LIST_LINE =
  /^(\s*)([-*•]\s+\[[ xX]\]\s+|[-*•]\s+|(\d{1,9})([.)])\s+)(.*)$/;

/** Whether the caret's line is a list item (Tab there does nothing). */
export function inList(text: string, sel: Selection): boolean {
  const from = lineStart(text, sel.start);
  return LIST_LINE.test(text.slice(from, lineEnd(text, sel.start)));
}

/**
 * Enter in a list item continues the list (a checked item continues
 * unchecked, numbers count up); Enter on an empty item ends the list.
 * Null when Enter should just be Enter.
 */
export function continueList(text: string, sel: Selection): Edit | null {
  if (sel.start !== sel.end || inFence(text, sel.start)) return null;
  const from = lineStart(text, sel.start);
  const to = lineEnd(text, sel.start);
  const m = LIST_LINE.exec(text.slice(from, to));
  if (!m) return null;
  const [, indent = '', marker = '', num, delim, content = ''] = m;
  if (content.trim() === '') {
    return {
      text: text.slice(0, from) + text.slice(to),
      sel: { start: from, end: from },
    };
  }
  let next: string;
  if (num !== undefined) next = `${Number(num) + 1}${delim} `;
  else if (/\[[ xX]\]/.test(marker)) next = `${marker.trim()[0]} [ ] `;
  else next = `${marker.trim()} `;
  return insert(text, sel, `\n${indent}${next}`);
}
