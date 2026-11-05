import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useMemo } from 'react';
import {
  type ListSort,
  type ListState,
  listFiltersOf,
  selectLists,
} from '#shared/lists';
import { LIST_SHOW_OPTIONS, LIST_SORT_OPTIONS } from '#shared/pages';
import { FindField } from '@/components/inputs/FindField';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { SortField } from '@/components/inputs/SortField';
import {
  ListEmpty,
  ListToolbar,
  useListFilters,
} from '@/components/layouts/ListToolbar';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { LIST_VIEWS, ListLayouts } from '@/components/lists/ListLayouts';
import { useListPanel } from '@/components/lists/ListPanelProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

const SHOWS = LIST_SHOW_OPTIONS as unknown as Array<{
  value: ListState;
  label: string;
}>;

const SORTS = LIST_SORT_OPTIONS as unknown as Array<{
  value: ListSort;
  label: string;
}>;

/**
 * Every list (#299) as Cards or a Table, on the list toolbar: Find (title
 * and item text), Project, Show (All, In progress, Done) and Sort, kept in
 * the URL and all but Find saved for the page (#186). New list opens the
 * panel, preset to the filtered project, and lands on the new list.
 */
export function ListsPage() {
  usePageTitle('Lists');
  const { state } = useDatapad();
  const { active } = useMotion();
  const { openPanel } = useListPanel();
  const [query, changePage] = usePageQuery('lists');
  const queryText = query.toString();
  const filters = useMemo(
    () => listFiltersOf(new URLSearchParams(queryText)),
    [queryText],
  );
  const [view, setView] = useView('lists', LIST_VIEWS, 'cards');

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      changePage(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active, changePage],
  );
  const listFilters = useListFilters('lists', query, changeQuery);

  const lists = useMemo(
    () => (state ? selectLists(state.lists, filters) : []),
    [state, filters],
  );
  const projects = useMemo(
    () =>
      Object.values(state?.projects ?? {}).sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.name.localeCompare(b.name),
      ),
    [state],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const anyLists = Object.keys(state.lists).length > 0;
  const preset =
    filters.projectId !== undefined &&
    (filters.projectId === null || state.projects[filters.projectId])
      ? filters.projectId
      : null;
  const newList = () => openPanel({ kind: 'new', projectId: preset });
  const newButton = (
    <Button className="press h-11 desk:h-8" onClick={newList}>
      <PlusIcon />
      New list
    </Button>
  );

  return (
    <section
      aria-labelledby="lists-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="lists-title" className="text-page-title flex-1">
          Lists
        </h1>
        {anyLists && (
          <ViewSwitcher views={LIST_VIEWS} value={view} onChange={setView} />
        )}
        {anyLists && newButton}
      </div>

      <ListToolbar
        state={listFilters}
        find={
          <FindField
            value={filters.q ?? ''}
            placeholder="Title or item"
            onChange={(q) => changePage({ q: q || null }, { replace: true })}
          />
        }
        filters={
          <>
            <SelectField
              label="Project"
              value={query.get('project') || 'all'}
              options={[
                { value: 'all', label: 'All projects' },
                { value: 'general', label: 'General' },
                ...projects.map((p) => ({
                  value: p.id,
                  label: p.archived ? `${p.name} (archived)` : p.name,
                })),
              ]}
              onChange={(v) => changeQuery({ project: v === 'all' ? null : v })}
            />
            <Segmented
              legend="Show"
              value={filters.state ?? 'all'}
              onChange={(v) => changeQuery({ show: v === 'all' ? null : v })}
              options={SHOWS}
            />
          </>
        }
        sort={
          <SortField
            value={filters.sort ?? 'updated'}
            options={SORTS}
            onChange={(sort) =>
              changeQuery({ sort: sort === 'updated' ? null : sort })
            }
          />
        }
      />

      {!anyLists ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-state">
            No lists yet. A list is a checklist of short items, for a project or
            General: packing, hiring steps, things to buy.
          </p>
          {newButton}
        </div>
      ) : lists.length === 0 ? (
        <ListEmpty state={listFilters}>No lists here.</ListEmpty>
      ) : (
        <ListLayouts
          view={view}
          lists={lists}
          projects={state.projects}
          sort={filters.sort ?? 'updated'}
          onSort={(sort) =>
            changeQuery({ sort: sort === 'updated' ? null : sort })
          }
        />
      )}
    </section>
  );
}
