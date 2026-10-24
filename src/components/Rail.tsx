import { ArchiveIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { agenda, focusBuckets, openCounts } from '#shared/select';
import { SyncStatus } from '@/components/SyncStatus';
import { DatapadMark } from '@/components/TopBar';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { NAV, sectionOf } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useEmail } from '@/providers/DatapadProvider';

const ANYONE = { kind: 'anyone' } as const;

/**
 * The desktop rail (≥ 820px): brand, the six sections with live counts, the
 * active projects (most recently updated first) with their open counts,
 * Archived when there is any, and a footer with sync status and who is
 * signed in (a link to Settings → Account). Hidden below 820px; the tab bar takes over.
 */
export function Rail({ route }: { route: Route }) {
  const { state } = useDatapad();
  const email = useEmail();
  const today = useToday();
  const section = sectionOf(route);

  const counts = useMemo(() => {
    if (!state) return null;
    const b = focusBuckets(state.tasks, state.projects, today, null, ANYONE);
    const open = openCounts(state.tasks);
    return {
      focus:
        b.overdue.length +
        b.today.length +
        b.thisWeek.length +
        b.later.length +
        b.noDate.length,
      tasks: [...open.values()].reduce((a, n) => a + n, 0),
      events: agenda(state.events, state.projects, today).length,
      open,
    };
  }, [state, today]);

  const projects = useMemo(
    () =>
      state
        ? Object.values(state.projects)
            .filter((p) => !p.archived && p.status !== 'done')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [],
    [state],
  );
  const archived = state
    ? Object.values(state.projects).filter((p) => p.archived).length
    : 0;

  const countFor = (name: string): number | undefined =>
    name === 'focus' || name === 'tasks' || name === 'events'
      ? counts?.[name]
      : undefined;

  return (
    <aside
      aria-label="Datapad"
      className="sticky top-0 hidden h-dvh w-(--rail-width) shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground desk:flex"
    >
      <a
        {...linkProps({ name: 'focus' })}
        className="press flex h-14 shrink-0 items-center gap-2 px-4 font-heading text-base font-semibold tracking-tight outline-ring/50 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <DatapadMark className="size-6" />
        <span>Datapad</span>
        <span className="sr-only">, Focus</span>
      </a>

      <nav
        aria-label="Sections"
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4"
      >
        <ul className="flex flex-col">
          {NAV.map(({ route: to, label, icon: Icon }) => {
            const count = countFor(to.name);
            const current = section === to.name;
            return (
              <li key={to.name}>
                <a
                  {...linkProps(to)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'press flex h-9 items-center gap-2.5 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
                    current &&
                      'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
                  )}
                >
                  <Icon weight={current ? 'fill' : 'regular'} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {count !== undefined && count > 0 && (
                    <span className="count text-xs text-muted-foreground tabular-nums">
                      {count}
                      <span className="sr-only">
                        {to.name === 'events' ? ' this week' : ' open'}
                      </span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {projects.length > 0 && (
          <section aria-labelledby="rail-projects">
            <h2
              id="rail-projects"
              className="px-2 pb-1 text-xs font-medium text-muted-foreground"
            >
              Active projects
            </h2>
            <ul className="flex flex-col">
              {projects.map((p) => {
                const current = route.name === 'project' && route.id === p.id;
                const open = counts?.open.get(p.id) ?? 0;
                return (
                  <li key={p.id}>
                    <a
                      {...linkProps({ name: 'project', id: p.id })}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'press flex h-8 items-center gap-2 px-2 text-sm outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
                        current &&
                          'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {open > 0 && (
                        <span className="count text-xs text-muted-foreground tabular-nums">
                          {open}
                          <span className="sr-only"> open</span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {archived > 0 && (
          <a
            {...linkProps({ name: 'archive' })}
            aria-current={route.name === 'archive' ? 'page' : undefined}
            className={cn(
              'press flex h-8 items-center gap-2.5 px-2 text-sm text-muted-foreground outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
              route.name === 'archive' &&
                'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
            )}
          >
            <ArchiveIcon aria-hidden />
            <span className="flex-1">Archived</span>
            <span className="count text-xs tabular-nums">{archived}</span>
          </a>
        )}
      </nav>

      <footer className="flex flex-col gap-2 border-t px-4 py-3">
        <SyncStatus />
        {email && (
          <a
            {...linkProps({ name: 'settings', section: 'account' })}
            className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
            title={email}
          >
            {email}
          </a>
        )}
      </footer>
    </aside>
  );
}
