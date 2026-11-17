import {
  CalendarBlankIcon,
  ChalkboardSimpleIcon,
  CheckSquareIcon,
  FoldersIcon,
  type Icon,
  NoteIcon,
} from '@phosphor-icons/react';
import type { AllKind } from '#shared/routes';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import { ArchivePage } from '@/pages/ArchivePage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { NotesPage } from '@/pages/NotesPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { TasksPage } from '@/pages/TasksPage';

const KINDS: { kind: AllKind; label: string; icon: Icon }[] = [
  { kind: 'project', label: 'Projects', icon: FoldersIcon },
  { kind: 'task', label: 'Tasks', icon: CheckSquareIcon },
  { kind: 'note', label: 'Notes', icon: NoteIcon },
  { kind: 'meeting', label: 'Meetings', icon: CalendarBlankIcon },
];

/**
 * All (`/all`, #329): every kind of item. Until #337 makes it one list,
 * `?kind=` shows that kind's page from before v2 (Projects, Tasks, Notes,
 * Meetings; archived projects with `archived=1`) under a row of kinds,
 * and with no kind it links to each, and to the space's whiteboard.
 */
export function AllPage({
  kind,
  archived,
}: {
  kind?: AllKind;
  archived?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <KindLinks kind={kind} />
      {kind === 'project' && archived ? (
        <ArchivePage />
      ) : kind === 'project' ? (
        <ProjectsPage />
      ) : kind === 'task' ? (
        <TasksPage />
      ) : kind === 'note' ? (
        <NotesPage />
      ) : kind === 'meeting' ? (
        <MeetingsPage />
      ) : (
        <Everything />
      )}
    </div>
  );
}

/** The kinds, as links: the one shown is current. */
function KindLinks({ kind }: { kind?: AllKind }) {
  return (
    <nav
      aria-label="Kinds"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max gap-1 pr-4 sm:pr-0">
        {KINDS.map(({ kind: k, label, icon: KindIcon }) => {
          const current = k === kind;
          return (
            <li key={k}>
              <a
                {...linkProps({ name: 'all', kind: k })}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'press flex min-h-11 items-center gap-2 border px-3 text-sm outline-ring/50 hover:bg-accent focus-visible:outline-2 desk:min-h-8',
                  current && 'bg-accent font-semibold text-accent-foreground',
                )}
              >
                <KindIcon weight={current ? 'fill' : 'regular'} aria-hidden />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** `/all` with no kind: each kind, with how many there are. */
function Everything() {
  usePageTitle('All');
  const { state } = useDatapad();
  const counts: Record<AllKind, number> = {
    project: Object.values(state?.projects ?? {}).filter((p) => !p.archived)
      .length,
    task: Object.values(state?.tasks ?? {}).filter((t) => t.status === 'open')
      .length,
    note: Object.keys(state?.notes ?? {}).length,
    meeting: Object.keys(state?.meetings ?? {}).length,
  };
  const items: { route: Route; label: string; icon: Icon; count?: number }[] = [
    ...KINDS.map(({ kind, label, icon }) => ({
      route: { name: 'all', kind } as Route,
      label,
      icon,
      count: state ? counts[kind] : undefined,
    })),
    {
      route: { name: 'whiteboard' },
      label: 'Whiteboard',
      icon: ChalkboardSimpleIcon,
    },
  ];
  return (
    <section aria-labelledby="all-title" className="enter flex flex-col gap-4">
      <h1 id="all-title" className="text-page-title">
        All
      </h1>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 desk:grid-cols-3">
        {items.map(({ route, label, icon: ItemIcon, count }) => (
          <li key={label}>
            <a
              {...linkProps(route)}
              className="press flex min-h-16 items-center gap-3 border bg-card p-3 text-card-foreground outline-ring/50 hover:bg-accent/40 focus-visible:outline-2"
            >
              <ItemIcon className="size-5" aria-hidden />
              <span className="flex-1 font-medium">{label}</span>
              {count !== undefined && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
