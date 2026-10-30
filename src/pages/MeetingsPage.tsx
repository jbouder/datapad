import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useMemo } from 'react';
import { localDate } from '#shared/dates';
import { type MeetingFilters, selectMeetings } from '#shared/meetings';
import { FindField } from '@/components/inputs/FindField';
import { SelectField } from '@/components/inputs/SelectField';
import { ListToolbar, useListFilters } from '@/components/layouts/ListToolbar';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { useMeetingForm } from '@/components/meetings/MeetingFormProvider';
import {
  MEETING_VIEWS,
  MeetingLayouts,
} from '@/components/meetings/MeetingLayouts';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { useMotion } from '@/providers/MotionProvider';
import { usePageQuery } from '@/providers/PagePrefsProvider';

/**
 * The view's controls, from the URL so Back restores them, over what is
 * saved for the page (never the Find text).
 */
function useMeetingFilters(query: URLSearchParams): MeetingFilters {
  const value = query.toString();
  return useMemo(() => {
    const q = new URLSearchParams(value);
    return { project: q.get('project') ?? '', q: q.get('q') ?? '' };
  }, [value]);
}

/**
 * Every meeting as a List (upcoming by month, then Past, collapsed), a
 * Calendar or a Timeline. Add meeting (any project, or General), then the
 * list toolbar (#271): Find (title, agenda, topics, attendees) and a
 * project filter. Filters and layout live in the URL, and all but Find
 * are saved for the page (#186).
 */
export function MeetingsPage() {
  usePageTitle('Meetings');
  const { state } = useDatapad();
  const { newMeeting } = useMeetingForm();
  const { active } = useMotion();
  const [query, changePage] = usePageQuery('meetings');
  const filters = useMeetingFilters(query);
  const [view, setView] = useView('meetings', MEETING_VIEWS, 'list');

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      changePage(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active, changePage],
  );
  const listFilters = useListFilters('meetings', query, changeQuery);

  const meetings = useMemo(
    () => (state ? selectMeetings(state.meetings, filters, state.people) : []),
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
  const filterProject =
    filters.project && filters.project !== 'general' ? filters.project : null;

  return (
    <section
      aria-labelledby="meetings-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="meetings-title" className="text-page-title flex-1">
          Meetings
        </h1>
        <ViewSwitcher views={MEETING_VIEWS} value={view} onChange={setView} />
        <Button
          className="press h-11 desk:h-8"
          onClick={() => newMeeting({ projectId: filterProject })}
        >
          <PlusIcon />
          Add meeting
        </Button>
      </div>

      <ListToolbar
        state={listFilters}
        find={
          <FindField
            value={filters.q ?? ''}
            placeholder="Title, agenda, topic or attendee"
            onChange={(q) => changePage({ q: q || null }, { replace: true })}
          />
        }
        filters={
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
        }
      />

      <MeetingLayouts
        view={view}
        meetings={meetings}
        state={state}
        today={today}
        projectId={filterProject}
        filters={listFilters}
        empty={
          meetings.length === 0
            ? 'No meetings yet. Add a meeting.'
            : listFilters.filtered
              ? 'Nothing coming up that matches.'
              : 'Nothing coming up.'
        }
      />
    </section>
  );
}
