import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useMemo } from 'react';
import { localDate } from '#shared/dates';
import {
  EVENT_TYPE_LABELS,
  type EventFilters,
  selectEvents,
} from '#shared/events';
import { EVENT_TYPES, type EventType } from '#shared/types';
import { useEventForm } from '@/components/events/EventFormProvider';
import { EVENT_VIEWS, EventLayouts } from '@/components/events/EventLayouts';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

/** The view's controls, from the URL so Back restores them. */
function useEventFilters(): EventFilters {
  const value = useQuery().toString();
  return useMemo(() => {
    const q = new URLSearchParams(value);
    const type = q.get('type') ?? '';
    return {
      project: q.get('project') ?? '',
      type: (EVENT_TYPES as readonly string[]).includes(type)
        ? (type as EventType)
        : '',
    };
  }, [value]);
}

/**
 * Every event as a List (upcoming by month, then Past, collapsed), a
 * Calendar or a Timeline. Add event (any project, or General), a project
 * filter and a type segment; the filters and layout live in the URL.
 */
export function EventsPage() {
  usePageTitle('Events');
  const { state } = useDatapad();
  const { newEvent } = useEventForm();
  const { active } = useMotion();
  const filters = useEventFilters();
  const [view, setView] = useView('events', EVENT_VIEWS, 'list');

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      setQuery(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active],
  );

  const events = useMemo(
    () => (state ? selectEvents(state.events, filters) : []),
    [state, filters],
  );

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const today = localDate(new Date());
  const projects = Object.values(state.projects).sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
  );
  const filtered = Boolean(filters.project || filters.type);
  const filterProject =
    filters.project && filters.project !== 'general' ? filters.project : null;

  return (
    <section
      aria-labelledby="events-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="events-title" className="text-page-title flex-1">
          Events
        </h1>
        <ViewSwitcher views={EVENT_VIEWS} value={view} onChange={setView} />
        <Button
          className="press h-11 desk:h-8"
          onClick={() => newEvent({ projectId: filterProject })}
        >
          <PlusIcon />
          Add event
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 desk:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SelectField
          label="Project"
          value={filters.project || 'all'}
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
          legend="Type"
          wrap
          value={filters.type || 'all'}
          onChange={(v) => changeQuery({ type: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All' },
            ...EVENT_TYPES.map((t) => ({
              value: t,
              label: EVENT_TYPE_LABELS[t],
            })),
          ]}
        />
      </div>

      <EventLayouts
        view={view}
        events={events}
        state={state}
        today={today}
        projectId={filterProject}
        empty={
          filtered
            ? 'Nothing coming up that matches.'
            : 'Nothing coming up. Add a meeting, milestone or deadline.'
        }
      />
    </section>
  );
}
