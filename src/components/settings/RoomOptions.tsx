import { LIMITS } from '#shared/limits';
import { PAGES, savedPrefs } from '#shared/pages';
import {
  DEFAULT_SETTINGS,
  LANE_KEYS,
  type LaneKey,
  type LaneLabels,
  type RoomTab,
  SETTINGS_ID,
  settingsOf,
} from '#shared/types';
import { Field } from '@/components/Field';
import { Segmented } from '@/components/inputs/Segmented';
import { SectionsEditor } from '@/components/SectionsEditor';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { usePagePrefs } from '@/providers/PagePrefsProvider';
import { Group, Hint, SwitchRow } from './parts';

/** The person room's lanes: their section keys and their names' keys. */
const PERSON_LANES = [
  { key: 'mine', name: 'youOwe' },
  { key: 'waiting', name: 'theyOwe' },
  { key: 'decide', name: 'discuss' },
] as const;

const LANE_HINTS: Record<LaneKey, string> = {
  youOwe: 'Your open tasks that touch them.',
  theyOwe: 'Tasks assigned to them, or waiting on them.',
  discuss: 'Things to decide with them, and their meetings’ open topics.',
};

/**
 * Settings → Rooms' options below the pinned rooms (#343): whether the
 * rail lists the people who owe you, a project room's lanes (hidden and
 * moved, saved under the `project` page) and the tab it opens on, and the
 * person room's lanes (hidden and moved under the `person` page) and
 * their names, which the person room reads. Space-wide, each default in
 * `DEFAULT_SETTINGS`, saved as nothing.
 */
export function RoomOptions() {
  const { state, actions } = useDatapad();
  const { save } = usePagePrefs();
  if (!state) return null;
  const settings = settingsOf(state);
  const stored: LaneLabels = state.settings[SETTINGS_ID]?.laneLabels ?? {};

  const saveLane = (key: LaneKey, text: string) => {
    const name = text.trim().slice(0, LIMITS.laneLabelMax);
    const next: LaneLabels = { ...stored };
    if (!name || name === DEFAULT_SETTINGS.laneLabels[key]) delete next[key];
    else next[key] = name;
    if (JSON.stringify(next) === JSON.stringify(stored)) return;
    actions.setSettings({
      patch: { laneLabels: Object.keys(next).length > 0 ? next : null },
    });
  };

  return (
    <>
      <Group title="In the rail">
        <SwitchRow
          id="rooms-rail-owed"
          label="People who owe you"
          hint="Under the rooms, each with how many of your tasks wait on them."
          checked={settings.railOwed}
          onChange={(on) =>
            actions.setSettings({ patch: { railOwed: on ? null : false } })
          }
        />
      </Group>
      <Group title="Project rooms">
        <SectionsEditor
          label="Project room lanes"
          noun="lane"
          sections={PAGES.project.sectionKeys ?? []}
          prefs={savedPrefs(state, 'project')}
          onChange={(patch) => save('project', patch, true)}
        />
        <Segmented<RoomTab>
          legend="Open on"
          value={settings.roomTab}
          onChange={(value) =>
            actions.setSettings({
              patch: {
                roomTab: value === DEFAULT_SETTINGS.roomTab ? null : value,
              },
            })
          }
          options={[
            { value: 'stream', label: 'Stream' },
            { value: 'plan', label: 'Plan' },
            { value: 'whiteboard', label: 'Whiteboard' },
          ]}
          className="max-w-sm"
        />
        <Hint>
          The tab a project’s room opens on from the rail, All and Search.
        </Hint>
      </Group>
      <Group title="Person rooms">
        <SectionsEditor
          label="Person room lanes"
          noun="lane"
          sections={PERSON_LANES.map(({ key, name }) => ({
            key,
            label: settings.laneLabels[name],
          }))}
          prefs={savedPrefs(state, 'person')}
          onChange={(patch) => save('person', patch, true)}
        />
        <Hint>Your own words for the three lanes. Empty keeps the name.</Hint>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {LANE_KEYS.map((key) => (
            <Field
              key={key}
              label={DEFAULT_SETTINGS.laneLabels[key]}
              hint={LANE_HINTS[key]}
            >
              <Input
                // A change from elsewhere starts the field over.
                key={settings.laneLabels[key]}
                defaultValue={stored[key] ?? ''}
                placeholder={DEFAULT_SETTINGS.laneLabels[key]}
                maxLength={LIMITS.laneLabelMax}
                autoComplete="off"
                onBlur={(e) => saveLane(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-11 text-base desk:h-8 desk:text-xs"
              />
            </Field>
          ))}
        </div>
      </Group>
    </>
  );
}
