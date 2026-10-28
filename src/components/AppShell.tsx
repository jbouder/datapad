import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { QuickAddAction } from '#shared/nav';
import {
  CrashForTests,
  ErrorBoundary,
  PageError,
} from '@/components/ErrorBoundary';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import { useNotes } from '@/components/notes/NotesProvider';
import { Palette } from '@/components/Palette';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { Rail } from '@/components/Rail';
import { ShortcutSheet } from '@/components/ShortcutSheet';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { focusPage, hasFocus } from '@/lib/focus';
import { withViewTransition } from '@/lib/motion';
import { titleOf, useNav } from '@/lib/nav';
import { focusQuickAdd, QUICK_ADD_ID } from '@/lib/quickAdd';
import {
  type Route,
  setRouteTransition,
  settingsSectionOf,
  useQuery,
  useRoute,
} from '@/lib/router';
import { handleRowKey, shortcutAllowed } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { ArchivePage } from '@/pages/ArchivePage';
import { FocusPage } from '@/pages/FocusPage';
import {
  DigestPage,
  HelpPage,
  MeetingPage,
  preloadPages,
  SettingsPage,
  TaskPage,
  WhiteboardPage,
} from '@/pages/lazy';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { NotesPage, notesPreset } from '@/pages/NotesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
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
  const { newMeeting } = useMeetingForm();
  const { openProjectForm } = useProjectForm();
  const { quickAdd } = useNav();
  usePreloadPages();

  useEffect(() => {
    setRouteTransition((update) => withViewTransition(update, active, 'page'));
  }, [active]);

  const pageName =
    route.name === 'project'
      ? state?.projects[route.id]?.name
      : route.name === 'task'
        ? state?.tasks[route.id]?.title
        : route.name === 'meeting'
          ? state?.meetings[route.id]?.title
          : undefined;

  // Add task opens the new-task panel, preset to the project you are on.
  const currentProject =
    route.name === 'project'
      ? route.id
      : route.name === 'whiteboard'
        ? (route.project ?? null)
        : null;
  const addTask = useCallback(() => {
    newTask(currentProject);
  }, [newTask, currentProject]);
  // On Notes, a new note starts in the filtered project, as Add note does.
  const query = useQuery();
  const noteProject =
    route.name === 'notes' ? notesPreset(query.get('project')) : currentProject;
  const addNote = useCallback(() => {
    newNote(noteProject);
  }, [newNote, noteProject]);
  // The top bar's +: whichever actions Settings → Navigation shows.
  const onQuickAdd = useCallback(
    (name: QuickAddAction) => {
      if (name === 'task') addTask();
      else if (name === 'note') addNote();
      else if (name === 'meeting') newMeeting({ projectId: currentProject });
      else openProjectForm();
    },
    [addTask, addNote, newMeeting, openProjectForm, currentProject],
  );

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
        newNote(noteProject);
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
  }, [newTask, newNote, currentProject, noteProject]);

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
          title={titleOf(route, pageName)}
          pageKey={pageKey(route)}
          email={email}
          quickAdd={quickAdd}
          onQuickAdd={onQuickAdd}
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
  if (route.name === 'project') return `project:${route.id}`;
  if (route.name === 'task') return `task:${route.id}`;
  if (route.name === 'meeting') return `meeting:${route.id}`;
  if (route.name === 'whiteboard') return `whiteboard:${route.project ?? ''}`;
  // People and Orgs are Settings sections: the page stays mounted.
  return settingsSectionOf(route) ? 'settings' : route.name;
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
    case 'task':
      return <TaskPage id={route.id} />;
    case 'notes':
      return <NotesPage />;
    case 'meetings':
      return <MeetingsPage />;
    case 'meeting':
      return <MeetingPage id={route.id} />;
    case 'digest':
      return <DigestPage />;
    case 'whiteboard':
      return <WhiteboardPage project={route.project} />;
    case 'people':
      return <SettingsPage section="people" person={route.person} />;
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
