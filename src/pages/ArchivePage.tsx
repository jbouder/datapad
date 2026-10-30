import { useCallback, useMemo } from 'react';
import { PROJECT_SORT_OPTIONS } from '#shared/pages';
import {
  DEFAULT_PROJECT_FILTERS,
  type ProjectSort,
  projectSortOf,
  selectProjects,
} from '#shared/projects';
import { FindField } from '@/components/inputs/FindField';
import { SortField } from '@/components/inputs/SortField';
import {
  ListEmpty,
  ListToolbar,
  useListFilters,
} from '@/components/layouts/ListToolbar';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import {
  PROJECT_VIEWS,
  ProjectLayouts,
} from '@/components/projects/ProjectLayouts';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

const SORTS = PROJECT_SORT_OPTIONS as unknown as Array<{
  value: ProjectSort;
  label: string;
}>;

/**
 * Archived projects: out of the default views, still here and findable.
 * The list toolbar (#270) has Find and the Projects page's Sort (saved for
 * the page, as there); the table's headers sort too.
 */
export function ArchivePage() {
  usePageTitle('Archived');
  const { state } = useDatapad();
  const { active } = useMotion();
  const [query, changePage] = usePageQuery('archive');
  const [view, setView] = useView('archive', PROJECT_VIEWS, 'cards');
  const today = useToday();
  const sort = projectSortOf(query);
  const q = query.get('q') ?? '';

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      changePage(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active, changePage],
  );
  const listFilters = useListFilters('archive', query, changeQuery);
  const sortTo = (next: ProjectSort) =>
    changeQuery({
      sort: next === DEFAULT_PROJECT_FILTERS.sort ? null : next,
    });

  const projects = useMemo(
    () =>
      state
        ? selectProjects(
            state.projects,
            { ...DEFAULT_PROJECT_FILTERS, sort, q },
            true,
            today,
          )
        : [],
    [state, sort, q, today],
  );
  const anyArchived = state
    ? Object.values(state.projects).some((p) => p.archived)
    : false;

  return (
    <section
      aria-labelledby="archive-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="archive-title" className="text-page-title flex-1">
          Archived
        </h1>
        {anyArchived && (
          <ViewSwitcher views={PROJECT_VIEWS} value={view} onChange={setView} />
        )}
      </div>
      <ListToolbar
        state={listFilters}
        find={
          <FindField
            value={q}
            placeholder="Name, org, tag or description"
            onChange={(text) =>
              changePage({ q: text || null }, { replace: true })
            }
          />
        }
        sort={<SortField value={sort} options={SORTS} onChange={sortTo} />}
      />
      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <ListEmpty
          state={
            anyArchived ? listFilters : { ...listFilters, filtered: false }
          }
        >
          Nothing archived.
        </ListEmpty>
      ) : (
        <ProjectLayouts
          view={view}
          projects={projects}
          label="Archived projects"
          sort={sort}
          onSort={sortTo}
        />
      )}
    </section>
  );
}
