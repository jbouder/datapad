import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { projectRoomOf, taskRoom } from '#shared/routes';
import {
  CrashForTests,
  ErrorBoundary,
  PageError,
} from '@/components/ErrorBoundary';
import { Palette } from '@/components/Palette';
import { Rail } from '@/components/Rail';
import { ShortcutSheet } from '@/components/ShortcutSheet';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { CAPTURE_ID, focusCapture } from '@/lib/capture';
import { focusPage, hasFocus } from '@/lib/focus';
import { withViewTransition } from '@/lib/motion';
import { titleOf } from '@/lib/nav';
import {
  navigate,
  type Route,
  setRouteTransition,
  settingsSectionOf,
  useQuery,
  useRoute,
} from '@/lib/router';
import { handleRowKey, shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import {
  AllPage,
  HelpPage,
  MeetingMode,
  preloadPages,
  SettingsPage,
  WhiteboardPage,
} from '@/pages/lazy';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PersonRoom } from '@/pages/PersonRoom';
import { ProjectRoom } from '@/pages/ProjectRoom';
import { RoomsPage } from '@/pages/RoomsPage';
import { TodayPage } from '@/pages/TodayPage';
import { UnfiledPage } from '@/pages/UnfiledPage';
import { useEmail } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';

/**
 * The rail (desktop) or tab bar (phone), the top bar, and one page. Route
 * changes run inside a `page` view transition: only `.page` has a
 * transition name, so the page lifts out and the next settles in while the
 * rail, top bar and tab bar hold still. DOM order is rail → top bar →
 * main, which is the tab order.
 */
export function AppShell() {
  const route = useRoute();
  const { active } = useMotion();
  const email = useEmail();
  const { state } = useDatapad();
  const { newTask } = useTaskPanels();
  usePreloadPages();

  useEffect(() => {
    setRouteTransition((update) => withViewTransition(update, active, 'page'));
  }, [active]);

  const room = projectRoomOf(route);
  const pageName = room
    ? state?.projects[room.id]?.name
    : route.name === 'person'
      ? state?.people[route.id]?.name
      : route.name === 'task'
        ? state?.tasks[route.id]?.title
        : route.name === 'meeting'
          ? state?.meetings[route.id]?.title
          : undefined;

  // New task, note and meeting (`n`, ⌘K) start in the project you are on,
  // or on All, the room it is filtered to.
  const query = useQuery();
  const allRoom = route.name === 'all' ? query.get('room') : null;
  const currentProject =
    room?.id ??
    (route.name === 'meeting'
      ? (state?.meetings[route.id]?.projectId ?? null)
      : allRoom && allRoom !== 'general' && state?.projects[allRoom]
        ? allRoom
        : null);

  // The page-wide keys (shared/shortcuts.ts lists them all): `n` focuses
  // the capture line (where there is none, the new-task panel), `?` shows
  // the sheet, and the row
  // keys work on whatever list or table the page shows, starting from its
  // first row when none is focused.
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘K / Ctrl+K works even while typing; it opens or closes search.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (!shortcutAllowed(event)) return;
      if (event.key === '/') {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (event.key === 'n') {
        event.preventDefault();
        if (!document.getElementById(CAPTURE_ID)) newTask(currentProject);
        else focusCapture();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setSheet(true);
        return;
      }
      const main = document.getElementById('main');
      if (!main) return;
      if (handleRowKey(event, main)) {
        event.preventDefault();
        return;
      }
      // A table's rows are their own focus targets (DataTable handles the
      // rest once one is focused).
      if (event.key === 'j' || event.key === 'k') {
        const row = [
          ...main.querySelectorAll<HTMLElement>('tr[data-row-id]'),
        ].find((r) => r.getClientRects().length > 0);
        if (row) {
          event.preventDefault();
          row.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newTask, currentProject]);

  // A link inside the page took focus away with the old page: give it to
  // the new one, so the next Tab goes on from there, not from the top. A
  // rail or tab bar link keeps it (it is still there).
  // Not on the first page: a fresh load starts from the top, skip link
  // first.
  const key = pageKey(route);
  const firstPage = useRef(key);
  useEffect(() => {
    if (key !== firstPage.current && !hasFocus()) focusPage();
    firstPage.current = '';
  }, [key]);

  // A whiteboard takes the whole viewport below the top bar (and above
  // the tab bar): the page itself never scrolls.
  const fullBleed = route.name === 'whiteboard';
  // Meeting mode (#336) is the whole screen: no rail, top bar or tab bar.
  // Leave (or Esc) goes back; search and the shortcut sheet still open.
  const fullScreen = route.name === 'meeting';

  if (fullScreen) {
    return (
      <div className="flex min-h-dvh">
        <main
          id="main"
          key={key}
          tabIndex={-1}
          className="page flex w-full min-w-0 flex-1 flex-col px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none sm:px-6"
        >
          <ErrorBoundary
            where="page"
            fallback={(reset) => <PageError reset={reset} />}
          >
            <Suspense fallback={<PageLoading />}>
              <Page route={route} />
            </Suspense>
          </ErrorBoundary>
        </main>
        <ShortcutSheet open={sheet} onOpenChange={setSheet} />
        <Palette
          open={palette}
          onOpenChange={setPalette}
          currentProject={currentProject}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('flex', fullBleed ? 'h-dvh overflow-hidden' : 'min-h-dvh')}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Rail route={route} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          title={titleOf(
            room ? { name: 'project', id: room.id } : route,
            pageName,
          )}
          pageKey={pageKey(route)}
          email={email}
          onSearch={() => setPalette(true)}
        />
        {/* Keyed by page so each mounts fresh and its entrances replay. */}
        <main
          id="main"
          key={key}
          tabIndex={-1}
          className={cn(
            'page flex w-full min-w-0 flex-1 flex-col outline-none',
            fullBleed
              ? 'min-h-0 pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))]'
              : 'px-4 pt-6 pb-[calc(1.5rem+var(--tabbar-height)+env(safe-area-inset-bottom))] sm:px-6',
          )}
        >
          {/* A page that throws shows "Reload this view" in its place; the
              key above resets it on the next page. */}
          <ErrorBoundary
            where="page"
            fallback={(reset) => <PageError reset={reset} />}
          >
            <Suspense fallback={<PageLoading />}>
              <Page route={route} />
            </Suspense>
            {__DEV_ROUTES__ && <CrashForTests where="page" />}
          </ErrorBoundary>
        </main>
      </div>
      <TabBar route={route} />
      <ShortcutSheet open={sheet} onOpenChange={setSheet} />
      <Palette
        open={palette}
        onOpenChange={setPalette}
        currentProject={currentProject}
      />
    </div>
  );
}

/** Fetch the lazy pages' chunks once the browser has nothing else to do. */
function usePreloadPages() {
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preloadPages, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preloadPages, 1000);
    return () => clearTimeout(id);
  }, []);
}

/** While a page's chunk loads: nothing to read, nothing that moves. */
function PageLoading() {
  return <div aria-busy="true" className="flex-1" />;
}

// Not in production bundles: DEV_ROUTES is false there, so this is dead code.
const DevComponentsPage = __DEV_ROUTES__
  ? lazy(() => import('@/pages/DevComponentsPage'))
  : () => null;

function pageKey(route: Route): string {
  // A project room's tabs, its whiteboard among them, are one page.
  const room = projectRoomOf(route);
  if (room) return `project:${room.id}`;
  if (route.name === 'person') return `person:${route.id}`;
  if (route.name === 'task') return `task:${route.id}`;
  if (route.name === 'meeting') return `meeting:${route.id}`;
  if (route.name === 'whiteboard') return 'whiteboard';
  // People and Orgs are Settings sections: the page stays mounted.
  return settingsSectionOf(route) ? 'settings' : route.name;
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'today':
      return <TodayPage />;
    case 'unfiled':
      return <UnfiledPage />;
    case 'rooms':
      return <RoomsPage />;
    case 'all':
      return <AllPage />;
    case 'help':
      return <HelpPage section={route.section} />;
    case 'project':
      return <ProjectRoom id={route.id} tab={route.tab ?? 'stream'} />;
    case 'person':
      return <PersonRoom id={route.id} />;
    case 'task':
      return <TaskLanding id={route.id} />;
    case 'meeting':
      return <MeetingMode id={route.id} />;
    case 'whiteboard':
      return route.project ? (
        <ProjectRoom id={route.project} tab="whiteboard" />
      ) : (
        <WhiteboardPage />
      );
    case 'people':
      return <SettingsPage section="people" />;
    case 'orgs':
      return <SettingsPage section="orgs" org={route.org} />;
    case 'settings':
      return <SettingsPage section={route.section} />;
    case 'devComponents':
      return <DevComponentsPage />;
    case 'notFound':
      return <NotFoundPage />;
  }
}

/**
 * `/tasks/:id`, from before v2: once the data is in, on to the task's
 * room (its project's, or Today for a General task) with its panel open,
 * in place of this address. A task that is gone is Not found.
 */
function TaskLanding({ id }: { id: string }) {
  const { state } = useDatapad();
  const { openTask } = useTaskPanels();
  const task = state?.tasks[id];
  const known = state !== null;
  useEffect(() => {
    if (!task) return;
    navigate(taskRoom(task), { replace: true });
    openTask(task.id);
  }, [task, openTask]);
  if (!known || task) return null;
  return <NotFoundPage what="task" />;
}
