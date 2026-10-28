/**
 * The Markdown subset notes, descriptions and summaries are written in
 * (docs/PLAN.md § Deliberate departures): a line-based parser with no
 * third-party library, producing a small tree the UI renders
 * (`src/components/Markdown.tsx`). Text stays text: nothing here is ever
 * turned into HTML, so a `<script>` in a note is just characters.
 *
 * Storage is plain Markdown with mentions as `@{personId}` (see
 * `mentions.ts`), so export and import never change.
 *
 * Supported: `#` `##` `###` headings (deeper render as `###`), paragraphs,
 * `-` `*` `•` bullets, `- [ ]` / `- [x]` checklists, `1.` / `1)` numbered
 * lists, fenced code blocks with an optional language, `>` quotes, `---`
 * dividers, and inline `code`, **bold**, _italic_ / *italic*, ~~strike~~,
 * links (bare `https://` and `[label](url)`) and mentions. Not supported:
 * nested lists, tables, images, raw HTML.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 's'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'mention'; id: string };

export interface CheckItem {
  /** The item's line in the source, for toggling it. */
  line: number;
  checked: boolean;
  c: Inline[];
}

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  /** One paragraph; its source lines stay separate lines. */
  | { t: 'p'; lines: Inline[][] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'check'; items: CheckItem[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; lines: Inline[][] }
  | { t: 'hr' };

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const DIVIDER = /^\s*---+\s*$/;
const QUOTE = /^>\s?(.*)$/;
export const CHECK_LINE = /^(\s*[-*•]\s+)\[( |x|X)\](\s+|$)(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;

/** The blocks of a text, in order. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  /** The block being added to, when it is the same kind. */
  const last = <T extends Block['t']>(t: T) => {
    const b = blocks[blocks.length - 1];
    return b?.t === t ? (b as Extract<Block, { t: T }>) : null;
  };

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
      i++; // the closing fence (or the end)
      blocks.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      // A blank line ends whatever was open; the next line starts afresh.
      blocks.push({ t: 'p', lines: [] });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      blocks.push({ t: 'h', level, c: parseInline(heading[2] ?? '') });
    } else if (DIVIDER.test(line)) {
      blocks.push({ t: 'hr' });
    } else if (QUOTE.test(line)) {
      const content = parseInline(QUOTE.exec(line)?.[1] ?? '');
      const quote = last('quote');
      if (quote) quote.lines.push(content);
      else blocks.push({ t: 'quote', lines: [content] });
    } else if (CHECK_LINE.test(line)) {
      const m = CHECK_LINE.exec(line);
      const item: CheckItem = {
        line: i,
        checked: m?.[2] !== ' ',
        c: parseInline(m?.[4] ?? ''),
      };
      const list = last('check');
      if (list) list.items.push(item);
      else blocks.push({ t: 'check', items: [item] });
    } else if (BULLET.test(line)) {
      const content = parseInline(BULLET.exec(line)?.[1] ?? '');
      const list = last('ul');
      if (list) list.items.push(content);
      else blocks.push({ t: 'ul', items: [content] });
    } else if (NUMBERED.test(line)) {
      const m = NUMBERED.exec(line);
      const content = parseInline(m?.[2] ?? '');
      const list = last('ol');
      if (list) list.items.push(content);
      else
        blocks.push({ t: 'ol', start: Number(m?.[1] ?? 1), items: [content] });
    } else {
      const content = parseInline(line);
      const para = last('p');
      if (para && para.lines.length > 0) para.lines.push(content);
      else blocks.push({ t: 'p', lines: [content] });
    }
    i++;
  }

  // The empty paragraphs above only separated blocks.
  return blocks.filter((b) => b.t !== 'p' || b.lines.length > 0);
}

/*
 * Inline: the earliest of these wins, then the text after it is scanned
 * again. Emphasis is word-boundary guarded so `snake_case_name` and
 * `2*3*4` stay as typed.
 */
const INLINE = new RegExp(
  [
    /`([^`\n]+)`/.source,
    /\[([^\]\n]+)\]\(([^)\s]+)\)/.source,
    /(https?:\/\/[^\s<>]+)/.source,
    /@\{([^}\s]+)\}/.source,
    /\*\*(?=\S)(.+?)(?<=\S)\*\*/.source,
    /~~(?=\S)(.+?)(?<=\S)~~/.source,
    /(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/u.source,
    /(?<![\p{L}\p{N}_*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\p{L}\p{N}_*])/u
      .source,
  ].join('|'),
  'gu',
);

/** Only these schemes become links; anything else stays text. */
export const SAFE_SCHEME = /^(https?:\/\/|mailto:)/i;

export function safeHref(url: string): string | null {
  return SAFE_SCHEME.test(url) ? url : null;
}

/** Trailing punctuation belongs to the sentence, not the URL. */
function trimUrl(url: string): string {
  let out = url.replace(/[.,;:!?'"]+$/, '');
  while (out.endsWith(')')) {
    const open = out.split('(').length - 1;
    const close = out.split(')').length - 1;
    if (close <= open) break;
    out = out.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  }
  return out;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (node: Inline) => {
    const prev = out[out.length - 1];
    if (node.t === 'text' && prev?.t === 'text') prev.v += node.v;
    else out.push(node);
  };
  const re = new RegExp(INLINE.source, INLINE.flags);
  let at = 0;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    if (m.index > at) push({ t: 'text', v: text.slice(at, m.index) });
    let end = m.index + m[0].length;
    const [
      ,
      code,
      label,
      href,
      bare,
      mention,
      strong,
      strike,
      underscore,
      star,
    ] = m;
    if (code !== undefined) {
      push({ t: 'code', v: code });
    } else if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      if (safe) push({ t: 'link', href: safe, c: parseInline(label) });
      else push({ t: 'text', v: m[0] });
    } else if (bare !== undefined) {
      const url = trimUrl(bare);
      end = m.index + url.length;
      push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
    } else if (mention !== undefined) {
      push({ t: 'mention', id: mention });
    } else if (strong !== undefined) {
      push({ t: 'strong', c: parseInline(strong) });
    } else if (strike !== undefined) {
      push({ t: 's', c: parseInline(strike) });
    } else {
      push({ t: 'em', c: parseInline(underscore ?? star ?? '') });
    }
    at = end;
    re.lastIndex = end;
    m = re.exec(text);
  }
  if (at < text.length) push({ t: 'text', v: text.slice(at) });
  return out;
}

/**
 * Flip the checklist item on `line` (`- [ ]` ↔ `- [x]`) and change
 * nothing else. Not a checklist line: the text comes back as it was.
 */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split('\n');
  const current = lines[line];
  if (current === undefined) return text;
  const m = CHECK_LINE.exec(current);
  if (!m) return text;
  const next = m[2] === ' ' ? 'x' : ' ';
  lines[line] = `${m[1]}[${next}]${m[3]}${m[4]}`;
  return lines.join('\n');
}
