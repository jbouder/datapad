import { Dialog } from '@base-ui/react/dialog';
import {
  BuildingsIcon,
  CalendarBlankIcon,
  CheckSquareIcon,
  CircleHalfIcon,
  DownloadSimpleIcon,
  FolderIcon,
  GavelIcon,
  type Icon,
  MagnifyingGlassIcon,
  NewspaperIcon,
  NoteIcon,
  PlusIcon,
  SquaresFourIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { useMemo, useRef, useState } from 'react';
import {
  type SearchHit,
  type SearchKind,
  search,
  searchIndex,
} from '#shared/search';
import { useDecisionPanel } from '@/components/decisions/DecisionPanelProvider';
import { useImportExport } from '@/components/ImportExport';
import { useNotes } from '@/components/notes/NotesProvider';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import { useNewSpace } from '@/components/SpaceSwitcher';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { useDatapad } from '@/hooks/useDatapad';
import { NAV } from '@/lib/nav';
import { navigate, type Route } from '@/lib/router';
import { useSpaces } from '@/providers/DatapadProvider';
import { useTheme } from '@/providers/ThemeProvider';

const SECTIONS: { kind: SearchKind; heading: string; icon: Icon }[] = [
  { kind: 'project', heading: 'Projects', icon: FolderIcon },
  { kind: 'task', heading: 'Tasks', icon: CheckSquareIcon },
  { kind: 'note', heading: 'Notes', icon: NoteIcon },
  { kind: 'meeting', heading: 'Events', icon: CalendarBlankIcon },
  { kind: 'decision', heading: 'Decisions', icon: GavelIcon },
  { kind: 'org', heading: 'Orgs', icon: BuildingsIcon },
  { kind: 'person', heading: 'People', icon: UserIcon },
];

interface Action {
  id: string;
  label: string;
  icon: Icon;
  run: () => void;
}

const ITEM =
  'flex min-h-11 cursor-default items-center gap-2.5 px-3 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground desk:min-h-9';

/**
 * ⌘K: search everything, and the keyboard's way around the app. Results
 * come from the shared index (`shared/search.ts`), so cmdk only handles
 * the list and the keys. Choosing something closes the palette first and
 * acts once it has gone, so a panel it opens keeps focus. It sits on the
 * panels' scrim: over an open panel it adds no second shade, and Esc
 * closes it before the panel.
 */
export function Palette({
  open,
  onOpenChange,
  currentProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** New task and New note start here. */
  currentProject: string | null;
}) {
  const { state } = useDatapad();
  const { openDecision } = useDecisionPanel();
  const { openTask, newTask } = useTaskPanels();
  const { newNote } = useNotes();
  const { openProjectForm } = useProjectForm();
  const { exportNow } = useImportExport();
  const { mode, setTheme } = useTheme();
  const { spaces, current, switchSpace } = useSpaces();
  const { openNewSpace } = useNewSpace();
  const [query, setQuery] = useState('');
  const [overPanel, setOverPanel] = useState(false);
  /** What to do once the palette has closed. */
  const pending = useRef<(() => void) | null>(null);

  const index = state
    ? searchIndex(
        state.projects,
        state.tasks,
        state.notes,
        state.meetings,
        state.people,
        state.decisions,
        state.orgs,
      )
    : null;
  const results = useMemo(
    () => (index ? search(index, query) : null),
    [index, query],
  );

  const actions = useMemo<Action[]>(() => {
    const go = (route: Route) => () => navigate(route);
    return [
      {
        id: 'new-task',
        label: 'New task',
        icon: PlusIcon,
        run: () => newTask(currentProject),
      },
      {
        id: 'new-note',
        label: 'New note',
        icon: PlusIcon,
        run: () => newNote(currentProject),
      },
      {
        id: 'new-project',
        label: 'New project',
        icon: PlusIcon,
        run: () => openProjectForm(),
      },
      ...NAV.map((n) => ({
        id: `go-${n.route.name}`,
        label: `Go to ${n.label}`,
        icon: n.icon,
        run: go(n.route),
      })),
      {
        id: 'go-digest',
        label: 'Go to Weekly digest',
        icon: NewspaperIcon,
        run: go({ name: 'digest' }),
      },
      {
        id: 'go-decisions',
        label: 'Go to Decisions',
        icon: GavelIcon,
        run: go({ name: 'decisions' }),
      },
      {
        id: 'go-people',
        label: 'Go to People',
        icon: UserIcon,
        run: go({ name: 'people' }),
      },
      {
        id: 'theme',
        label:
          mode === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme',
        icon: CircleHalfIcon,
        run: () => setTheme(mode === 'dark' ? 'light' : 'dark'),
      },
      ...spaces
        .filter((s) => s.id !== current.id)
        .map((s) => ({
          id: `space-${s.id}`,
          label: `Switch to ${s.name}`,
          icon: SquaresFourIcon,
          run: () => switchSpace(s.id),
        })),
      {
        id: 'new-space',
        label: 'New space…',
        icon: PlusIcon,
        run: openNewSpace,
      },
      {
        id: 'export',
        label: 'Export',
        icon: DownloadSimpleIcon,
        run: () => void exportNow(),
      },
    ];
  }, [
    spaces,
    current,
    switchSpace,
    openNewSpace,
    newTask,
    newNote,
    currentProject,
    openProjectForm,
    mode,
    setTheme,
    exportNow,
  ]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shownActions = actions.filter((a) =>
    words.every((w) => a.label.toLowerCase().includes(w)),
  );

  const choose = (run: () => void) => {
    pending.current = run;
    onOpenChange(false);
  };

  const openHit = (kind: SearchKind, id: string) => {
    switch (kind) {
      case 'project':
        return choose(() => navigate({ name: 'project', id }));
      case 'task':
        return choose(() => openTask(id));
      case 'note':
        return choose(() =>
          navigate({ name: 'notes' }, { query: `note=${id}` }),
        );
      case 'meeting':
        return choose(() =>
          navigate({ name: 'events' }, { query: `view=list&event=${id}` }),
        );
      case 'decision':
        return choose(() => openDecision(id));
      case 'org':
        return choose(() => navigate({ name: 'orgs', org: id }));
      case 'person':
        return choose(() => navigate({ name: 'people', person: id }));
    }
  };

  const projectName = (hit: SearchHit) => {
    const { projectId, kind } = hit.entry;
    if (kind === 'project' || kind === 'person' || kind === 'org') return null;
    return projectId ? (state?.projects[projectId]?.name ?? null) : 'General';
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOverPanel(document.querySelector('.side-panel') !== null);
        }
        onOpenChange(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        setQuery('');
        const run = pending.current;
        pending.current = null;
        run?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className="scrim palette-scrim"
          data-over-panel={overPanel || undefined}
        />
        <Dialog.Popup
          className="palette"
          finalFocus={() => pending.current === null}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Dialog.Description className="sr-only">
            Projects, tasks, notes, events, decisions, orgs, people and actions.
            Arrow keys move, Enter opens, Esc closes.
          </Dialog.Description>
          <Command label="Search" shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-3">
              <MagnifyingGlassIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search projects, tasks, notes, events, people…"
                className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground desk:text-sm"
              />
            </div>
            <Command.List className="scrollbar-thin max-h-[min(60dvh,28rem)] overflow-y-auto py-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{query.trim()}”.
              </Command.Empty>
              {results &&
                SECTIONS.map(({ kind, heading, icon: KindIcon }) =>
                  results[kind].length === 0 ? null : (
                    <Command.Group
                      key={kind}
                      heading={
                        kind === 'project' && words.length === 0
                          ? 'Recent projects'
                          : heading
                      }
                      className="**:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground"
                    >
                      {results[kind].map((hit) => {
                        const where = projectName(hit);
                        return (
                          <Command.Item
                            key={hit.entry.id}
                            value={`${kind}:${hit.entry.id}`}
                            onSelect={() => openHit(kind, hit.entry.id)}
                            className={ITEM}
                          >
                            <KindIcon
                              aria-hidden
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">
                                {hit.entry.title || 'Untitled'}
                              </span>
                              {hit.snippet && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {hit.snippet}
                                </span>
                              )}
                            </span>
                            {where && (
                              <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground max-sm:hidden">
                                {where}
                              </span>
                            )}
                            {hit.entry.archived && (
                              <span className="shrink-0 border px-1 text-[11px] text-muted-foreground">
                                Archived
                              </span>
                            )}
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  ),
                )}
              {shownActions.length > 0 && (
                <Command.Group
                  heading="Actions"
                  className="**:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground"
                >
                  {shownActions.map(({ id, label, icon: ActionIcon, run }) => (
                    <Command.Item
                      key={id}
                      value={`action:${id}`}
                      onSelect={() => choose(run)}
                      className={ITEM}
                    >
                      <ActionIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1 truncate">{label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export function paletteHint(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
}
