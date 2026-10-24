import { safeHref } from '#shared/markdown';

/** Plain text that is already Markdown is pasted as it is. */
export function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,3} |[-*•] |\d+[.)] |> |```)|\*\*|~~|\]\(/m.test(text);
}

/**
 * Rich text from the clipboard (`text/html`) as the Markdown subset notes
 * support: headings, paragraphs, lists and checklists, bold, italic,
 * strike, code, quotes and links. Everything else keeps only its text.
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = block(doc.body).replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (!(node instanceof HTMLElement)) return '';
  const inner = () => [...node.childNodes].map(inline).join('');
  const wrap = (mark: string) => {
    const text = inner();
    const trimmed = text.trim();
    if (!trimmed) return text;
    const lead = text.slice(0, text.indexOf(trimmed));
    const tail = text.slice(lead.length + trimmed.length);
    return `${lead}${mark}${trimmed}${mark}${tail}`;
  };
  const weight = node.style.fontWeight;
  switch (node.tagName) {
    case 'STRONG':
      return wrap('**');
    case 'B':
      // Google Docs wraps everything in <b style="font-weight:normal">.
      return weight === 'normal' || weight === '400' ? inner() : wrap('**');
    case 'EM':
    case 'I':
      return wrap('_');
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return wrap('~~');
    case 'CODE':
      return `\`${node.textContent ?? ''}\``;
    case 'BR':
      return '\n';
    case 'A': {
      const href = safeHref(node.getAttribute('href') ?? '');
      const text = inner().trim();
      if (!href) return text;
      return text && text !== href ? `[${text}](${href})` : href;
    }
    case 'SCRIPT':
    case 'STYLE':
      return '';
    default:
      return inner();
  }
}

function block(node: Node): string {
  if (!(node instanceof HTMLElement)) return inline(node);
  const kids = () => [...node.childNodes].map(block).join('');
  const line = () => inline(node).trim();
  switch (node.tagName) {
    case 'H1':
      return `# ${line()}\n\n`;
    case 'H2':
      return `## ${line()}\n\n`;
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return `### ${line()}\n\n`;
    case 'P':
      return `${line()}\n\n`;
    case 'UL':
    case 'OL': {
      const ordered = node.tagName === 'OL';
      const items = [...node.children].filter((c) => c.tagName === 'LI');
      const lines = items.map((li, i) => {
        const box = li.querySelector('input[type="checkbox"]');
        const text = [...li.childNodes]
          .filter(
            (c) => !(c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName)),
          )
          .map(inline)
          .join('')
          .trim();
        if (box instanceof HTMLInputElement) {
          return `- [${box.checked ? 'x' : ' '}] ${text}`;
        }
        return ordered ? `${i + 1}. ${text}` : `- ${text}`;
      });
      return `${lines.join('\n')}\n\n`;
    }
    case 'PRE':
      return `\`\`\`\n${(node.textContent ?? '').replace(/\n$/, '')}\n\`\`\`\n\n`;
    case 'BLOCKQUOTE':
      return `${kids()
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}\n\n`;
    case 'HR':
      return '---\n\n';
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'BODY':
    case 'MAIN':
      return [...node.childNodes].some(
        (c) =>
          c instanceof HTMLElement &&
          /^(P|H\d|UL|OL|PRE|BLOCKQUOTE|DIV|HR)$/.test(c.tagName),
      )
        ? kids()
        : `${line()}\n\n`;
    default:
      return inline(node);
  }
}
