import { LIMITS } from '#shared/limits';
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
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { Group, Hint, SwitchRow } from './parts';

const LANE_HINTS: Record<LaneKey, string> = {
  youOwe: 'Your open tasks that touch them.',
  theyOwe: 'Tasks assigned to them, or waiting on them.',
  discuss: 'Things to decide with them, and their meetings’ open topics.',
};

/**
 * Settings → Rooms' options below the pinned rooms (#343): whether the
 * rail lists the people who owe you, the tab a project room opens on, and
 * the person room's lane names. Space-wide, each default in
 * `DEFAULT_SETTINGS`, saved as nothing.
 */
export function RoomOptions() {
  const { state, actions } = useDatapad();
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
        <Hint>The tab a project’s room shows first.</Hint>
      </Group>
      <Group title="Person room lanes">
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
