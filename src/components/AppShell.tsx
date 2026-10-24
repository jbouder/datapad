import { lazy, Suspense, useCallback, useEffect } from 'react';
import { Rail } from '@/components/Rail';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { withViewTransition } from '@/lib/motion';
import { titleOf } from '@/lib/nav';
import { focusQuickAdd, QUICK_ADD_ID } from '@/lib/quickAdd';
import { type Route, setRouteTransition, useRoute } from '@/lib/router';
import { shortcutAllowed } from '@/lib/shortcuts';
import { ArchivePage } from '@/pages/ArchivePage';
import { FocusPage } from '@/pages/FocusPage';
import { HelpPage } from '@/pages/HelpPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { SettingsPage } from '@/pages/SettingsPage';
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

  useEffect(() => {
    setRouteTransition((update) => withViewTransition(update, active, 'page'));
  }, [active]);

  const projectName =
    route.name === 'project' ? state?.projects[route.id]?.name : undefined;

  // + opens the new-task panel, preset to the project you are on.
  const currentProject = route.name === 'project' ? route.id : null;
  const addTask = useCallback(() => {
    newTask(currentProject);
  }, [newTask, currentProject]);

  // `n`: the nearest quick-add, or the panel where there is none (#24
  // centralises every binding).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'n' && shortcutAllowed(event)) {
        event.preventDefault();
        if (!document.getElementById(QUICK_ADD_ID)) newTask(currentProject);
        else focusQuickAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newTask, currentProject]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Rail route={route} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          route={route}
          title={titleOf(route, projectName)}
          email={email}
          onAddTask={addTask}
        />
        {/* Keyed by page so each mounts fresh and its entrances replay. */}
        <main
          id="main"
          key={pageKey(route)}
          className="page mx-auto flex w-full max-w-(--content-max) min-w-0 flex-1 flex-col px-4 pt-6 pb-[calc(1.5rem+var(--tabbar-height)+env(safe-area-inset-bottom))] sm:px-6"
        >
          <Page route={route} />
        </main>
      </div>
      <TabBar route={route} />
    </div>
  );
}

// Not in production bundles: DEV_ROUTES is false there, so this is dead code.
const DevComponentsPage = __DEV_ROUTES__
  ? lazy(() => import('@/pages/DevComponentsPage'))
  : () => null;

function pageKey(route: Route): string {
  return route.name === 'project' ? `project:${route.id}` : route.name;
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'focus':
      return <FocusPage />;
    case 'help':
      return <HelpPage />;
    case 'project':
      return <ProjectPage id={route.id} />;
    case 'projects':
      return <ProjectsPage />;
    case 'archive':
      return <ArchivePage />;
    case 'tasks':
      return (
        <PlaceholderPage title="Tasks">
          Every task across projects, grouped and filtered, is on its way.
        </PlaceholderPage>
      );
    case 'notes':
      return (
        <PlaceholderPage title="Notes">
          Notes, with mentions and a proper editor, are on their way.
        </PlaceholderPage>
      );
    case 'events':
      return (
        <PlaceholderPage title="Events">
          Meetings, milestones and deadlines are on their way.
        </PlaceholderPage>
      );
    case 'settings':
      return <SettingsPage section={route.section} />;
    case 'devComponents':
      return (
        <Suspense fallback={null}>
          <DevComponentsPage />
        </Suspense>
      );
    case 'notFound':
      return <NotFoundPage />;
  }
}
