import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { SAFE_SCHEME } from '#shared/markdown';

/**
 * A link a document holds (a project's or task's links, an org's, a
 * meeting's), opened in a new tab. Only `https:`, `http:` and `mailto:`
 * become links, as in Markdown (`SAFE_SCHEME`); anything else, `javascript:`
 * say, from an import or an MCP client, is shown as text and never
 * followed.
 */
export function ExternalLink({
  url,
  className,
  icon = true,
  children,
}: {
  url: string;
  className?: string;
  icon?: boolean;
  children: ReactNode;
}) {
  const href = url.trim();
  // The test guards the very value the link gets, so a scanner sees it too.
  if (!SAFE_SCHEME.test(href)) {
    return <span className="break-all text-muted-foreground">{url}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      {icon && <ArrowSquareOutIcon aria-hidden />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
