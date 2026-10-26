import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNotes } from '@/components/notes/NotesProvider';
import { Palette } from '@/components/Palette';
import { Rail } from '@/components/Rail';
import { ShortcutSheet } from '@/components/ShortcutSheet';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { withViewTransition } from '@/lib/motion';
import { titleOf } from '@/lib/nav';
import { focusQuickAdd, QUICK_ADD_ID } from '@/lib/quickAdd';
import { type Route, setRouteTransition, useRoute } from '@/lib/router';
import { handleRowKey, shortcutAllowed } from '@/lib/shortcuts';
import { ArchivePage } from '@/pages/ArchivePage';
import { DecisionsPage } from '@/pages/DecisionsPage';
import { DigestPage } from '@/pages/DigestPage';
import { FocusPage } from '@/pages/FocusPage';
import { HelpPage } from '@/pages/HelpPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { NotesPage } from '@/pages/NotesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OrgsPage } from '@/pages/OrgsPage';
import { PeoplePage } from '@/pages/PeoplePage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TasksPage } from '@/pages/TasksPage';
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
  const { newNote } = useNotes();

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
  const addNote = useCallback(() => {
    newNote(currentProject);
  }, [newNote, currentProject]);

  // The page-wide keys (src/lib/shortcuts.ts lists them all): `n` adds a
  // task, `N` a note,
  // `?` shows the sheet, and the row keys work on whatever list or table
  // the page shows, starting from its first row when none is focused.
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
        if (!document.getElementById(QUICK_ADD_ID)) newTask(currentProject);
        else focusQuickAdd();
        return;
      }
      if (event.key === 'N') {
        event.preventDefault();
        newNote(currentProject);
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
  }, [newTask, newNote, currentProject]);

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
          pageKey={pageKey(route)}
          email={email}
          onAddTask={addTask}
          onAddNote={addNote}
          onSearch={() => setPalette(true)}
        />
        {/* Keyed by page so each mounts fresh and its entrances replay. */}
        <main
          id="main"
          key={pageKey(route)}
          className="page flex w-full min-w-0 flex-1 flex-col px-4 pt-6 pb-[calc(1.5rem+var(--tabbar-height)+env(safe-area-inset-bottom))] sm:px-6"
        >
          <Page route={route} />
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
      return <HelpPage section={route.section} />;
    case 'project':
      return <ProjectPage id={route.id} />;
    case 'projects':
      return <ProjectsPage />;
    case 'archive':
      return <ArchivePage />;
    case 'tasks':
      return <TasksPage />;
    case 'notes':
      return <NotesPage />;
    case 'meetings':
      return <MeetingsPage />;
    case 'decisions':
      return <DecisionsPage />;
    case 'digest':
      return <DigestPage />;
    case 'people':
      return <PeoplePage person={route.person} />;
    case 'orgs':
      return <OrgsPage org={route.org} />;
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
