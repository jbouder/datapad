/**
 * Prototype: Day, Rooms, All, at `/v2`. A second shell over the same
 * data and ops as the classic app: the rail is Today, Unfiled, the active
 * project rooms and All; a phone gets three tabs and the capture line
 * docked above them. Meeting mode takes the whole screen.
 */
import { useEffect } from 'react';
import { meId } from '#shared/select';
import { SyncStatus } from '@/components/SyncStatus';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';
import { useSpaceTitle } from '@/providers/DatapadProvider';
import { AllPage } from './All';
import { Capture } from './Capture';
import { MeetingMode } from './MeetingMode';
import { lanesOf, unfiledNotes } from './model';
import { useV2Route, type V2Route } from './nav';
import { Go } from './parts';
import { PersonRoom, ProjectRoom } from './Room';
import { Today } from './Today';
import { UnfiledPage } from './Unfiled';

export default function V2App() {
  const route = useV2Route();
  const { state } = useDatapad();
  const space = useSpaceTitle();

  useEffect(() => {
    document.title = `${titleOf(route, state)} · Datapad v2`;
  }, [route, state]);

  if (!state) {
    return <div aria-busy="true" className="min-h-dvh bg-background" />;
  }
  if (route.name === 'meeting') {
    return (
      <div className="min-h-dvh bg-background">
        <MeetingMode id={route.id} />
      </div>
    );
  }

  const roomContext =
    route.name === 'project'
      ? { projectId: route.id }
      : route.name === 'person'
        ? { personId: route.id }
        : undefined;

  return (
    <div className="flex min-h-dvh bg-background">
      <Rail route={route} space={space} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          id="main"
          className="flex-1 px-4 pt-6 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:px-6 desk:pb-28"
        >
          <Page route={route} />
        </main>
        {/* Rooms carry their own capture line in the stream. */}
        {!roomContext && (
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-border border-t bg-background/95 px-4 py-2 backdrop-blur desk:bottom-0 desk:left-56 sm:px-6">
            <Capture className="mx-auto max-w-3xl" />
          </div>
        )}
      </div>
      <TabBar route={route} />
    </div>
  );
}

function Page({ route }: { route: V2Route }) {
  switch (route.name) {
    case 'today':
      return <Today />;
    case 'unfiled':
      return <UnfiledPage />;
    case 'all':
      return <AllPage />;
    case 'project':
      return <ProjectRoom key={route.id} id={route.id} />;
    case 'person':
      return <PersonRoom key={route.id} id={route.id} />;
    case 'meeting':
      return null;
  }
}

function titleOf(
  route: V2Route,
  state: ReturnType<typeof useDatapad>['state'],
): string {
  switch (route.name) {
    case 'today':
      return 'Today';
    case 'unfiled':
      return 'Unfiled';
    case 'all':
      return 'All';
    case 'project':
      return state?.projects[route.id]?.name ?? 'Project';
    case 'person':
      return state?.people[route.id]?.name ?? 'Person';
    case 'meeting':
      return state?.meetings[route.id]?.title ?? 'Meeting';
  }
}

function NavLink({
  to,
  active,
  children,
  count,
}: {
  to: V2Route;
  active: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <Go
      to={to}
      className={cn(
        'flex h-8 items-center justify-between gap-2 px-2 text-sm hover:bg-sidebar-accent',
        active &&
          'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
      )}
    >
      <span className="truncate">{children}</span>
      {count ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      ) : null}
    </Go>
  );
}

function Rail({ route, space }: { route: V2Route; space: string | null }) {
  const { state } = useDatapad();
  if (!state) return null;
  const unfiled = unfiledNotes(state).length;
  const me = meId(state.people);
  const lanes = lanesOf(state, me);
  const rooms = Object.values(state.projects)
    .filter((p) => !p.archived && p.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const people = lanes.waiting
    .filter((g) => g.personId && state.people[g.personId])
    .slice(0, 5);
  const here = (r: V2Route) =>
    r.name === route.name &&
    (!('id' in r) || ('id' in route && r.id === route.id));

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-4 overflow-y-auto border-sidebar-border border-r bg-sidebar p-3 text-sidebar-foreground desk:flex"
    >
      <div className="px-2">
        <p className="font-heading text-sm">Datapad</p>
        <p className="text-muted-foreground text-xs">
          {space ?? 'Main'} · prototype
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <NavLink to={{ name: 'today' }} active={here({ name: 'today' })}>
          Today
        </NavLink>
        <NavLink
          to={{ name: 'unfiled' }}
          active={here({ name: 'unfiled' })}
          count={unfiled}
        >
          Unfiled
        </NavLink>
        <NavLink to={{ name: 'all' }} active={here({ name: 'all' })}>
          All
        </NavLink>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="px-2 text-muted-foreground text-xs uppercase tracking-wider">
          Rooms
        </p>
        {rooms.map((p) => (
          <NavLink
            key={p.id}
            to={{ name: 'project', id: p.id }}
            active={here({ name: 'project', id: p.id })}
          >
            {p.name}
          </NavLink>
        ))}
        {people.map((g) => (
          <NavLink
            key={g.personId}
            to={{ name: 'person', id: g.personId }}
            active={here({ name: 'person', id: g.personId })}
            count={g.tasks.length}
          >
            {state.people[g.personId]?.name}
          </NavLink>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2 px-2 text-xs">
        <SyncStatus />
        <a href="/" className="text-muted-foreground underline">
          Back to the classic app
        </a>
      </div>
    </nav>
  );
}

function TabBar({ route }: { route: V2Route }) {
  const tabs: { to: V2Route; label: string }[] = [
    { to: { name: 'today' }, label: 'Today' },
    { to: { name: 'unfiled' }, label: 'Unfiled' },
    { to: { name: 'all' }, label: 'All' },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-border border-t bg-background pb-[env(safe-area-inset-bottom)] desk:hidden"
    >
      {tabs.map((t) => (
        <Go
          key={t.label}
          to={t.to}
          className={cn(
            'flex h-14 items-center justify-center text-sm',
            route.name === t.to.name
              ? 'font-medium text-primary'
              : 'text-muted-foreground',
          )}
        >
          {t.label}
        </Go>
      ))}
    </nav>
  );
}
