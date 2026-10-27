import { ArchiveIcon, NewspaperIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { agenda, focusBuckets, openCounts } from '#shared/select';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { sectionOf, useNav } from '@/lib/nav';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';

const ANYONE = { kind: 'anyone' } as const;

/**
 * The desktop rail (≥ 820px): the space switcher, the sections with live
 * counts (those Settings → Navigation shows, in its order), the active
 * projects (most recently updated first) with their open counts, Archived
 * when there is any, and the Weekly digest pinned at the foot. Each extra
 * can be switched off. Hidden below 820px; the tab bar takes over.
 */
export function Rail({ route }: { route: Route }) {
  const { state } = useDatapad();
  const today = useToday();
  const section = sectionOf(route);
  const nav = useNav();

  const counts = useMemo(() => {
    if (!state) return null;
    const b = focusBuckets(state.tasks, state.projects, today, null, ANYONE);
    const open = openCounts(state.tasks);
    return {
      focus:
        b.blocked.length +
        b.overdue.length +
        b.today.length +
        b.thisWeek.length +
        b.later.length +
        b.noDate.length,
      tasks: [...open.values()].reduce((a, n) => a + n, 0),
      meetings: agenda(state.meetings, state.projects, today).filter(
        (a) => a.kind === 'meeting',
      ).length,
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
  const anyProjects = state ? Object.keys(state.projects).length > 0 : false;
  const showDigest =
    nav.extras.digest && (anyProjects || route.name === 'digest');

  const countFor = (name: string): number | undefined =>
    name === 'focus' || name === 'tasks' || name === 'meetings'
      ? counts?.[name]
      : undefined;

  return (
    <aside
      aria-label="Datapad"
      className="vt-rail sticky top-0 hidden h-dvh w-(--rail-width) shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground desk:flex"
    >
      <SpaceSwitcher />

      <nav
        aria-label="Sections"
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4"
      >
        <ul className="flex flex-col">
          {nav.items.map(({ route: to, label, icon: Icon }) => {
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
                        {to.name === 'meetings' ? ' this week' : ' open'}
                      </span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {nav.extras.activeProjects && projects.length > 0 && (
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

        {nav.extras.archived && archived > 0 && (
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

      {showDigest && (
        <footer className="border-t px-2 py-2">
          <a
            {...linkProps({ name: 'digest' })}
            aria-current={route.name === 'digest' ? 'page' : undefined}
            className={cn(
              'press flex h-8 items-center gap-2.5 px-2 text-sm text-muted-foreground outline-ring/50 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
              route.name === 'digest' &&
                'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
            )}
          >
            <NewspaperIcon aria-hidden />
            <span className="flex-1">Weekly digest</span>
          </a>
        </footer>
      )}
    </aside>
  );
}
