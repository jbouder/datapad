import { PlusIcon } from '@phosphor-icons/react';
import { useCallback, useMemo } from 'react';
import { localDate } from '#shared/dates';
import { type MeetingFilters, selectMeetings } from '#shared/meetings';
import { SelectField } from '@/components/inputs/SelectField';
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
import { setQuery, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

/** The view's controls, from the URL so Back restores them. */
function useMeetingFilters(): MeetingFilters {
  const value = useQuery().toString();
  return useMemo(() => {
    const q = new URLSearchParams(value);
    return { project: q.get('project') ?? '' };
  }, [value]);
}

/**
 * Every meeting as a List (upcoming by month, then Past, collapsed), a
 * Calendar or a Timeline. Add meeting (any project, or General) and a
 * project filter; the filter and layout live in the URL.
 */
export function MeetingsPage() {
  usePageTitle('Meetings');
  const { state } = useDatapad();
  const { newMeeting } = useMeetingForm();
  const { active } = useMotion();
  const filters = useMeetingFilters();
  const [view, setView] = useView('meetings', MEETING_VIEWS, 'list');

  const changeQuery = useCallback(
    (changes: Record<string, string | null>) =>
      setQuery(changes, {
        transition: (update) => withViewTransition(update, active, 'filter'),
      }),
    [active],
  );

  const meetings = useMemo(
    () => (state ? selectMeetings(state.meetings, filters) : []),
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
  const filtered = Boolean(filters.project);
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

      <div className="grid grid-cols-1 gap-3 desk:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] desk:items-end">
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
      </div>

      <MeetingLayouts
        view={view}
        meetings={meetings}
        state={state}
        today={today}
        projectId={filterProject}
        empty={
          meetings.length === 0
            ? filtered
              ? 'No meetings match.'
              : 'No meetings yet. Add a meeting.'
            : filtered
              ? 'Nothing coming up that matches.'
              : 'Nothing coming up.'
        }
      />
    </section>
  );
}
