import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useMemo } from 'react';
import {
  HEALTH_OPTIONS,
  PROJECT_SORT_OPTIONS,
  PROJECT_STATUS_OPTIONS,
} from '#shared/pages';
import {
  DEFAULT_PROJECT_FILTERS,
  type HealthFilter,
  PROJECT_SORTS,
  type ProjectFilters,
  type ProjectSort,
  type StatusFilter,
  selectProjects,
} from '#shared/projects';
import { orgs } from '#shared/select';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { useProjectForm } from '@/components/projects/ProjectFormProvider';
import {
  PROJECT_VIEWS,
  ProjectLayouts,
} from '@/components/projects/ProjectLayouts';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

const STATUSES = PROJECT_STATUS_OPTIONS as unknown as Array<{
  value: StatusFilter;
  label: string;
}>;

const HEALTHS = HEALTH_OPTIONS as unknown as Array<{
  value: HealthFilter;
  label: string;
}>;

/**
 * Filters from the query string, so Back restores them, over what is
 * saved for the page.
 */
function projectFilters(query: URLSearchParams): ProjectFilters {
  const status = query.get('status');
  const health = query.get('health');
  const sort = query.get('sort');
  return {
    status: STATUSES.some((s) => s.value === status)
      ? (status as StatusFilter)
      : DEFAULT_PROJECT_FILTERS.status,
    health: HEALTHS.some((h) => h.value === health)
      ? (health as HealthFilter)
      : DEFAULT_PROJECT_FILTERS.health,
    org: query.get('org') ?? '',
    sort: (PROJECT_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as ProjectSort)
      : DEFAULT_PROJECT_FILTERS.sort,
  };
}

/**
 * Every project that is not archived, as cards: filter by status (Active
 * by default) and org, sort five ways, all kept in the URL and saved for
 * the page (#186). Changing them
 * runs a `filter` view transition over the grid.
 */
export function ProjectsPage() {
  usePageTitle('Projects');
  const { state } = useDatapad();
  const { openProjectForm } = useProjectForm();
  const { active } = useMotion();
  const [query, changePage] = usePageQuery('projects');
  const filters = projectFilters(query);
  const [view, setView] = useView('projects', PROJECT_VIEWS, 'cards');

  const change = useCallback(
    (key: keyof ProjectFilters, value: string) => {
      const fallback = DEFAULT_PROJECT_FILTERS[key];
      changePage(
        { [key]: value === fallback ? null : value },
        {
          transition: (update) => withViewTransition(update, active, 'filter'),
        },
      );
    },
    [active, changePage],
  );

  const today = useToday();
  const projects = useMemo(
    () => (state ? selectProjects(state.projects, filters, false, today) : []),
    [state, filters, today],
  );
  const anyProjects = state
    ? Object.values(state.projects).some((p) => !p.archived)
    : false;
  const orgOptions = useMemo(
    () => [
      { value: '', label: 'All orgs' },
      ...(state ? orgs(state.projects, state.orgs) : []).map((o) => ({
        value: o,
        label: o,
      })),
    ],
    [state],
  );

  return (
    <section
      aria-labelledby="projects-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="projects-title" className="text-page-title flex-1">
          Projects
        </h1>
        {anyProjects && (
          <ViewSwitcher views={PROJECT_VIEWS} value={view} onChange={setView} />
        )}
        {anyProjects && (
          <Button
            className="press h-11 desk:h-8"
            onClick={() => openProjectForm()}
          >
            <PlusIcon />
            Add project
          </Button>
        )}
      </div>

      {anyProjects && (
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]">
          <Segmented
            legend="Status"
            value={filters.status}
            onChange={(v) => change('status', v)}
            options={STATUSES}
            className="col-span-2 sm:col-span-1"
          />
          <SelectField
            label="Health"
            value={filters.health}
            options={HEALTHS}
            onChange={(v) => change('health', v)}
          />
          <SelectField
            label="Org"
            value={filters.org}
            options={orgOptions}
            onChange={(v) => change('org', v)}
          />
          <SelectField
            label="Sort by"
            value={filters.sort}
            options={[...PROJECT_SORT_OPTIONS]}
            onChange={(v) => change('sort', v)}
          />
        </div>
      )}

      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !anyProjects ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-state">
            No projects yet. A project needs only a name to start.
          </p>
          <Button
            className="press h-11 desk:h-8"
            onClick={() => openProjectForm()}
          >
            <PlusIcon />
            Add project
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-state">None match these filters.</p>
          <Button
            variant="outline"
            className="press"
            onClick={() =>
              changePage(
                { status: null, health: null, org: null, sort: null },
                {
                  transition: (update) =>
                    withViewTransition(update, active, 'filter'),
                },
              )
            }
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <ProjectLayouts
          view={view}
          projects={projects}
          label="Projects"
          sort={filters.sort}
          onSort={(sort) => change('sort', sort)}
        />
      )}
    </section>
  );
}
