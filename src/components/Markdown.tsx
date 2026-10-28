import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { Fragment, memo, type ReactNode, useId, useMemo } from 'react';
import { type Inline, parseMarkdown } from '#shared/markdown';
import type { Person } from '#shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

/**
 * Stored Markdown (`#shared/markdown`) as React: notes, project
 * descriptions, meeting-linked notes and summaries all render through here
 * and share the `.prose-note` text styles. Mentions show the person's
 * current name. With `onToggle`, checklist items are checkboxes that hand
 * back the line to flip; without it they are read-only marks. `highlight`
 * marks every occurrence of those (lower-case) words.
 */
export const Markdown = memo(function Markdown({
  text,
  people,
  onToggle,
  highlight,
  className,
}: {
  text: string;
  people: Record<string, Person>;
  onToggle?: (line: number) => void;
  highlight?: string[];
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const base = useId();
  const words = highlight?.length ? highlight : undefined;
  const inline = (nodes: Inline[]) => renderInline(nodes, people, words);

  return (
    <div className={cn('prose-note', className)}>
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        switch (b.t) {
          case 'h': {
            const Tag = `h${b.level + 2}` as 'h3' | 'h4' | 'h5';
            return (
              <Tag key={key} className={`note-h${b.level}`}>
                {inline(b.c)}
              </Tag>
            );
          }
          case 'p':
            return <p key={key}>{lines(b.lines, inline)}</p>;
          case 'quote':
            return <blockquote key={key}>{lines(b.lines, inline)}</blockquote>;
          case 'ul':
            return (
              <ul key={key}>
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: items are positional
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} start={b.start}>
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: items are positional
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'check':
            return (
              <ul key={key} className="note-checklist">
                {b.items.map((item) => {
                  const labelId = `${base}-${item.line}`;
                  return (
                    <li
                      key={item.line}
                      data-checked={item.checked || undefined}
                    >
                      <span className="note-check">
                        {onToggle ? (
                          <input
                            type="checkbox"
                            checked={item.checked}
                            aria-labelledby={labelId}
                            onChange={() => onToggle(item.line)}
                            className="note-input"
                          />
                        ) : (
                          <span className="sr-only">
                            {item.checked ? 'Done: ' : 'To do: '}
                          </span>
                        )}
                        <span className="note-box" aria-hidden>
                          {item.checked && <CheckIcon weight="bold" />}
                        </span>
                      </span>
                      <span id={labelId}>{inline(item.c)}</span>
                    </li>
                  );
                })}
              </ul>
            );
          case 'code':
            return (
              <CodeBlock key={key} lang={b.lang} text={b.text} words={words} />
            );
          case 'hr':
            return <hr key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
});

function lines(
  rows: Inline[][],
  inline: (nodes: Inline[]) => ReactNode,
): ReactNode {
  return rows.map((row, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(row)}
    </Fragment>
  ));
}

/** `text` with every occurrence of `words` in a `<mark>`. */
function marked(text: string, words: string[] | undefined): ReactNode {
  if (!words) return text;
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    // Odd parts are the captured matches.
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part,
  );
}

function renderInline(
  nodes: Inline[],
  people: Record<string, Person>,
  words?: string[],
): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
        return <Fragment key={i}>{marked(n.v, words)}</Fragment>;
      case 'code':
        // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
        return <code key={i}>{marked(n.v, words)}</code>;
      case 'strong':
        // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
        return <strong key={i}>{renderInline(n.c, people, words)}</strong>;
      case 'em':
        // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
        return <em key={i}>{renderInline(n.c, people, words)}</em>;
      case 's':
        // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
        return <s key={i}>{renderInline(n.c, people, words)}</s>;
      case 'link':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c, people, words)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      case 'mention': {
        const person = people[n.id];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional
          <span key={i} className="mention" data-person={person?.id}>
            {marked(`@${person?.name ?? 'unknown'}`, words)}
          </span>
        );
      }
      default:
        return null;
    }
  });
}

function CodeBlock({
  lang,
  text,
  words,
}: {
  lang: string;
  text: string;
  words?: string[];
}) {
  const { show } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      show('Copied');
    } catch {
      show('Could not copy. Select the text instead.');
    }
  };
  return (
    <div className="note-code">
      <div className="note-code-bar">
        <span>{lang}</span>
        <Button
          variant="ghost"
          size="xs"
          className="press h-11 desk:h-6"
          onClick={copy}
          aria-label={lang ? `Copy ${lang} code` : 'Copy code'}
        >
          <CopyIcon />
          Copy
        </Button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access */}
      <pre tabIndex={0}>
        <code>{marked(text, words)}</code>
      </pre>
    </div>
  );
}
