import { CHECK_LINE, type Inline, parseInline } from './markdown';
import type { Person } from './types';

/**
 * The note editor's document (#376), as plain JSON in Tiptap's shape, and
 * the two directions between it and the stored Markdown. The editor
 * (`src/components/NoteComposer.tsx`) shows this document formatted; what
 * it hands back is `docToMarkdown()` of it, the same Markdown the textarea
 * wrote and `markdown.ts` renders.
 *
 * One line of Markdown is one block: a paragraph per line, a blank line an
 * empty paragraph, consecutive list lines one list. So the text comes back
 * as it went in, line for line. What it cannot keep is spelling the
 * renderer treats alike: list indents, extra spaces after a marker,
 * `####`, `- [X]`, a list's own numbering, an unclosed fence. Those come
 * back in their usual form, and only after an edit, since the editor
 * hands back nothing until something changes.
 *
 * Mentions are edited as names, as they were in the textarea: `@Name` for
 * a person in `people` is a mention node, and goes back as `@Name`.
 */

export type MarkType = 'bold' | 'italic' | 'strike' | 'code' | 'link';

export interface DocMark {
  type: MarkType;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

/* ---- Markdown → document ----------------------------------------------- */

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const DIVIDER = /^\s*---+\s*$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*([-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})([.)])\s+(.*)$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `@Name` for anyone in `people`, longest names first (`namesToTokens`). */
function mentionPattern(people: Record<string, Person>): RegExp | null {
  const names = Object.values(people)
    .map((p) => p.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return null;
  return new RegExp(
    `@(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
}

/** Person ids by name, for the mention nodes. */
function idsByName(people: Record<string, Person>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of Object.values(people))
    if (!out.has(p.name)) out.set(p.name, p.id);
  return out;
}

interface Ctx {
  pattern: RegExp | null;
  ids: Map<string, string>;
}

function textNodes(text: string, marks: DocMark[], ctx: Ctx): DocNode[] {
  if (!text) return [];
  const withMarks = (node: DocNode): DocNode =>
    marks.length ? { ...node, marks } : node;
  const isCode = marks.some((m) => m.type === 'code');
  if (!ctx.pattern || isCode) return [withMarks({ type: 'text', text })];
  const out: DocNode[] = [];
  const re = new RegExp(ctx.pattern.source, ctx.pattern.flags);
  let at = 0;
  for (const m of text.matchAll(re)) {
    const name = m[1] ?? '';
    if (m.index > at) {
      out.push(withMarks({ type: 'text', text: text.slice(at, m.index) }));
    }
    out.push(
      withMarks({
        type: 'mention',
        attrs: { id: ctx.ids.get(name) ?? null, label: name },
      }),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) {
    out.push(withMarks({ type: 'text', text: text.slice(at) }));
  }
  return out;
}

function inlineNodes(nodes: Inline[], marks: DocMark[], ctx: Ctx): DocNode[] {
  const out: DocNode[] = [];
  const add = (mark: DocMark, c: Inline[]) =>
    out.push(...inlineNodes(c, [...marks, mark], ctx));
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out.push(...textNodes(n.v, marks, ctx));
        break;
      case 'code':
        out.push(...textNodes(n.v, [...marks, { type: 'code' }], ctx));
        break;
      case 'strong':
        add({ type: 'bold' }, n.c);
        break;
      case 'em':
        add({ type: 'italic', attrs: { marker: n.star ? '*' : '_' } }, n.c);
        break;
      case 's':
        add({ type: 'strike' }, n.c);
        break;
      case 'link':
        // A bare URL is text: the renderer links it, the editor need not.
        if (n.bare) out.push(...inlineNodes(n.c, marks, ctx));
        else add({ type: 'link', attrs: { href: n.href } }, n.c);
        break;
      case 'mention':
        // A stored token in text being edited stays as it was written.
        out.push(...textNodes(`@{${n.id}}`, marks, ctx));
        break;
    }
  }
  return out;
}

function inline(text: string, ctx: Ctx): DocNode[] {
  return inlineNodes(parseInline(text), [], ctx);
}

function paragraph(content: DocNode[]): DocNode {
  return content.length
    ? { type: 'paragraph', content }
    : { type: 'paragraph' };
}

/** The editor's document for a note's Markdown (mentions as `@Name`). */
export function markdownToDoc(
  text: string,
  people: Record<string, Person> = {},
): DocNode {
  const ctx: Ctx = { pattern: mentionPattern(people), ids: idsByName(people) };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocNode[] = [];
  const last = (type: string) => {
    const b = blocks[blocks.length - 1];
    return b?.type === type ? b : null;
  };
  const addTo = (
    type: string,
    attrs: Record<string, unknown>,
    item: DocNode,
  ) => {
    const list = last(type);
    if (list) list.content?.push(item);
    else blocks.push({ type, attrs, content: [item] });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++;
      const code = body.join('\n');
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[1] || null },
        ...(code ? { content: [{ type: 'text', text: code }] } : {}),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    const check = CHECK_LINE.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (line.trim() === '') {
      // A blank line is an empty paragraph; spaces on it stay.
      blocks.push(paragraph(line ? [{ type: 'text', text: line }] : []));
    } else if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3);
      blocks.push({
        type: 'heading',
        attrs: { level },
        ...contentOf(inline(heading[2] ?? '', ctx)),
      });
    } else if (DIVIDER.test(line)) {
      blocks.push({ type: 'horizontalRule' });
    } else if (QUOTE.test(line)) {
      const item = paragraph(inline(QUOTE.exec(line)?.[1] ?? '', ctx));
      addTo('blockquote', {}, item);
    } else if (check) {
      addTo(
        'taskList',
        {},
        {
          type: 'taskItem',
          attrs: { checked: check[2] !== ' ', marker: marker(check[1]) },
          content: [paragraph(inline(check[4] ?? '', ctx))],
        },
      );
    } else if (bullet) {
      addTo(
        'bulletList',
        {},
        {
          type: 'listItem',
          attrs: { marker: marker(bullet[1]) },
          content: [paragraph(inline(bullet[2] ?? '', ctx))],
        },
      );
    } else if (numbered) {
      addTo(
        'orderedList',
        { start: Number(numbered[1] ?? 1), delim: numbered[2] ?? '.' },
        {
          type: 'listItem',
          content: [paragraph(inline(numbered[3] ?? '', ctx))],
        },
      );
    } else {
      blocks.push(paragraph(inline(line, ctx)));
    }
    i++;
  }
  return { type: 'doc', content: blocks.length ? blocks : [paragraph([])] };
}

function contentOf(content: DocNode[]): { content?: DocNode[] } {
  return content.length ? { content } : {};
}

function marker(text: string | undefined): string {
  const m = (text ?? '').trim()[0];
  return m === '*' || m === '•' ? m : '-';
}

/* ---- Document → Markdown ----------------------------------------------- */

/** Outermost first: the order marks open in. */
const MARK_ORDER: readonly MarkType[] = [
  'link',
  'bold',
  'italic',
  'strike',
  'code',
];

interface Unit {
  /** One character, or a whole mention (`@Name`). */
  text: string;
  atom: boolean;
  marks: Map<MarkType, DocMark>;
}

function markKey(mark: DocMark): string {
  if (mark.type === 'link') return `link ${String(mark.attrs?.href ?? '')}`;
  if (mark.type === 'italic') return `italic ${italicMarker(mark)}`;
  return mark.type;
}

function italicMarker(mark: DocMark): string {
  return mark.attrs?.marker === '*' ? '*' : '_';
}

function open(mark: DocMark): string {
  if (mark.type === 'link') return '[';
  return delimiter(mark);
}

function close(mark: DocMark): string {
  if (mark.type === 'link') return `](${String(mark.attrs?.href ?? '')})`;
  return delimiter(mark);
}

function delimiter(mark: DocMark): string {
  switch (mark.type) {
    case 'bold':
      return '**';
    case 'italic':
      return italicMarker(mark);
    case 'strike':
      return '~~';
    case 'code':
      return '`';
    default:
      return '';
  }
}

function units(nodes: readonly DocNode[]): Unit[] {
  const out: Unit[] = [];
  for (const node of nodes) {
    const marks = new Map<MarkType, DocMark>();
    for (const m of node.marks ?? []) marks.set(m.type, m);
    if (node.type === 'text') {
      for (const ch of node.text ?? '') {
        out.push({ text: ch, atom: false, marks: new Map(marks) });
      }
    } else if (node.type === 'mention') {
      out.push({
        text: `@${String(node.attrs?.label ?? 'unknown')}`,
        atom: true,
        marks,
      });
    }
  }
  return out;
}

/**
 * Bold, italic and strike only read when they hug their text
 * (`**word**`, never `** word**`): spaces at either end of a run move
 * outside it.
 */
function hugText(list: Unit[]) {
  for (const type of ['bold', 'italic', 'strike'] as const) {
    let i = 0;
    while (i < list.length) {
      if (!list[i]?.marks.has(type)) {
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && list[j]?.marks.has(type)) j++;
      const blank = (u: Unit | undefined) =>
        !!u && !u.atom && /\s/.test(u.text);
      let a = i;
      while (a < j && blank(list[a])) list[a++]?.marks.delete(type);
      let b = j - 1;
      while (b >= a && blank(list[b])) list[b--]?.marks.delete(type);
      i = j;
    }
  }
}

/** A block's inline content as Markdown. */
export function inlineToMarkdown(nodes: readonly DocNode[] = []): string {
  const list = units(nodes);
  hugText(list);
  let out = '';
  const stack: DocMark[] = [];
  const keys = (u: Unit) => new Set([...u.marks.values()].map(markKey));
  for (const u of list) {
    const want = keys(u);
    // Close from the first open mark this unit does not carry.
    const keep = stack.findIndex((m) => !want.has(markKey(m)));
    if (keep !== -1) {
      while (stack.length > keep) out += close(stack.pop() as DocMark);
    }
    const have = new Set(stack.map(markKey));
    for (const type of MARK_ORDER) {
      const mark = u.marks.get(type);
      if (mark && !have.has(markKey(mark))) {
        out += open(mark);
        stack.push(mark);
      }
    }
    out += u.text;
  }
  while (stack.length) out += close(stack.pop() as DocMark);
  return out;
}

/** The inline content of a list item: its first paragraph's. */
function itemLines(item: DocNode): { first: string; rest: string[] } {
  const [head, ...more] = item.content ?? [];
  return {
    first: inlineToMarkdown(head?.content),
    rest: more.flatMap(blockLines),
  };
}

function blockLines(node: DocNode): string[] {
  const kids = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return [inlineToMarkdown(kids)];
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      return [`${'#'.repeat(level)} ${inlineToMarkdown(kids)}`];
    }
    case 'blockquote':
      return kids.flatMap(blockLines).map((l) => (l ? `> ${l}` : '>'));
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '');
      const code = kids.map((k) => k.text ?? '').join('');
      return [`\`\`\`${lang}`, ...(code ? code.split('\n') : []), '```'];
    }
    case 'horizontalRule':
      return ['---'];
    case 'bulletList':
      return kids.flatMap((item) => {
        const { first, rest } = itemLines(item);
        return [
          `${marker(String(item.attrs?.marker ?? '-'))} ${first}`,
          ...rest,
        ];
      });
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      const delim = node.attrs?.delim === ')' ? ')' : '.';
      return kids.flatMap((item, i) => {
        const { first, rest } = itemLines(item);
        return [`${start + i}${delim} ${first}`, ...rest];
      });
    }
    case 'taskList':
      return kids.flatMap((item) => {
        const { first, rest } = itemLines(item);
        const box = item.attrs?.checked ? '[x]' : '[ ]';
        const m = marker(String(item.attrs?.marker ?? '-'));
        return [`${m} ${box} ${first}`, ...rest];
      });
    default:
      return kids.length ? kids.flatMap(blockLines) : [];
  }
}

/** The stored Markdown for the editor's document (mentions as `@Name`). */
export function docToMarkdown(doc: DocNode): string {
  return (doc.content ?? []).flatMap(blockLines).join('\n');
}
