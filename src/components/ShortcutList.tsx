import { SHORTCUTS, type Shortcut } from '@/lib/shortcuts';

const SCOPES: Shortcut['scope'][] = [
  'Anywhere',
  'Focus',
  'Task lists and tables',
  'Collection pages',
  'Panels',
  'Whiteboard',
];

/** Every binding from `SHORTCUTS`, by where it works. */
export function ShortcutList({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-col gap-4">
      {SCOPES.map((scope) => (
        <section key={scope} aria-label={scope} className="flex flex-col gap-1">
          <Heading className="text-xs font-semibold text-muted-foreground">
            {scope}
          </Heading>
          <dl className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {SHORTCUTS.filter((s) => s.scope === scope).map((s) => (
              <div key={s.keys.join()} className="contents">
                <dt className="flex flex-wrap items-start gap-1 self-start">
                  {s.keys.map((k) => (
                    <kbd
                      key={k}
                      className="border bg-muted px-1.5 font-mono text-xs leading-5"
                    >
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>
                  {s.action}
                  {s.later && (
                    <span className="text-muted-foreground">
                      {' '}
                      (coming {s.later})
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
