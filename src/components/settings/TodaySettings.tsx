import { PAGES, savedPrefs } from '#shared/pages';
import { meId } from '#shared/select';
import { SectionsEditor } from '@/components/SectionsEditor';
import { useDatapad } from '@/hooks/useDatapad';
import { usePagePrefs } from '@/providers/PagePrefsProvider';
import { Group, Hint, PageFields, ResetToDefaults } from './parts';

/**
 * Settings → Today (#343): who Mine means, how far Next up looks ahead,
 * the day the week starts on (the week zoom's and the recap's), Brief me
 * on or off, the lanes shown and their order, and meeting mode's
 * sections and done items. Saved under the `focus` and `meeting` pages,
 * so what Focus saved carries over; Reset to defaults clears both.
 */
export function TodaySettings() {
  const { state } = useDatapad();
  const { save } = usePagePrefs();
  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const hasMe = meId(state.people) !== null;
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          How Today reads in this space, on every device. A change is saved at
          once.
        </p>
        <ResetToDefaults section="today" label="Today" />
      </div>
      <PageFields
        page="focus"
        state={state}
        keys={['who', 'days', 'weekStart', 'brief']}
        hints={{
          who: hasMe
            ? 'Mine is what is assigned to you.'
            : 'Mark yourself in People to tell your tasks apart.',
          days: 'How far ahead a due date counts as next up.',
          weekStart: 'Where the week zoom starts, and the recap’s weekend.',
          brief: 'The on-device summary at the top of Today.',
        }}
      />
      <Group title="Lanes">
        <SectionsEditor
          label="Today lanes"
          noun="lane"
          sections={PAGES.focus.sectionKeys ?? []}
          prefs={savedPrefs(state, 'focus')}
          onChange={(patch) => save('focus', patch, true)}
        />
      </Group>
      <Group title="Meeting mode">
        <SectionsEditor
          label="Meeting mode sections"
          sections={PAGES.meeting.sectionKeys ?? []}
          prefs={savedPrefs(state, 'meeting')}
          fixedOrder
          onChange={(patch) => save('meeting', patch, true)}
        />
        <PageFields
          page="meeting"
          state={state}
          keys={['covered', 'doneActions']}
        />
        <Hint>Shown or hidden in every meeting.</Hint>
      </Group>
    </>
  );
}
