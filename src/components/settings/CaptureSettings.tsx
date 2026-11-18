import type { BaseOp } from '#shared/protocol';
import {
  type CaptureAs,
  DEFAULT_SETTINGS,
  type EffectiveSettings,
  type RoomNotes,
  settingsOf,
} from '#shared/types';
import { PriorityPicker } from '@/components/inputs/PriorityPicker';
import { Segmented } from '@/components/inputs/Segmented';
import { PRIORITY_LABELS } from '@/components/PriorityDot';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';
import { Hint, ResetToDefaults, SwitchRow } from './parts';

/** The choices for "New tasks are due", in days from today (0: none). */
const DUE_DAYS = [0, 1, 3, 7, 14] as const;

function dueLabel(days: number): string {
  if (days === 0) return 'No date';
  if (days === 1) return 'Tomorrow';
  if (days === 7) return 'In a week';
  if (days === 14) return 'In 2 weeks';
  return `In ${days} days`;
}

type CaptureKey = 'captureAs' | 'mentionAssigns' | 'roomNotes';
type SetSettings = Extract<BaseOp, { type: 'setSettings' }>;

/**
 * Settings → Capture (#343): what a plain line on the capture line
 * becomes, whether `@Name` assigns a task, the priority new tasks start
 * at and when they are due (everywhere tasks are added), and where a note typed in a room goes.
 * Each is a space-wide setting with its default in `DEFAULT_SETTINGS`;
 * the default is saved as nothing.
 */
export function CaptureSettings() {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const settings = settingsOf(state);

  const set = <K extends CaptureKey>(key: K, value: EffectiveSettings[K]) => {
    if (settings[key] === value) return;
    const patch = { [key]: value === DEFAULT_SETTINGS[key] ? null : value };
    actions.setSettings({ patch } as Omit<SetSettings, 'type'>);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          What the capture line saves, on every page. Words in the line still
          win: <code>todo</code> or a date makes a task, <code>#word</code>{' '}
          files it.
        </p>
        <ResetToDefaults section="capture" label="Capture" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented<CaptureAs>
          legend="A plain line becomes"
          value={settings.captureAs}
          onChange={(value) => set('captureAs', value)}
          options={[
            { value: 'note', label: 'A note' },
            { value: 'task', label: 'A task' },
          ]}
          className="max-w-sm"
        />
        <Hint>A line with nothing that says otherwise.</Hint>
      </div>
      <SwitchRow
        id="capture-mention-assigns"
        label="@Name assigns a task"
        hint="Off, the person is only mentioned and the task stays yours or unassigned."
        checked={settings.mentionAssigns}
        onChange={(on) => set('mentionAssigns', on)}
      />
      <div className="flex flex-col gap-1.5">
        <PriorityPicker
          label="New task priority"
          value={settings.defaultPriority}
          onChange={(priority) => {
            const before = settings.defaultPriority;
            if (priority === before) return;
            const patch = (value: typeof priority) => ({
              defaultPriority:
                value === DEFAULT_SETTINGS.defaultPriority ? null : value,
            });
            if (!actions.setSettings({ patch: patch(priority) })) return;
            const said =
              priority === 'none'
                ? 'New tasks start with no priority'
                : `New tasks start at ${PRIORITY_LABELS[priority]}`;
            show(said, () => actions.setSettings({ patch: patch(before) }));
          }}
          className="max-w-sm"
        />
        <Hint>
          What a new task starts with when you do not pick one, everywhere you
          add tasks.
        </Hint>
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented<string>
          legend="New tasks are due"
          value={String(settings.defaultDueDays)}
          onChange={(value) => {
            const days = Number(value);
            const before = settings.defaultDueDays;
            if (days === before) return;
            const patch = (n: number) => ({
              defaultDueDays: n === DEFAULT_SETTINGS.defaultDueDays ? null : n,
            });
            if (!actions.setSettings({ patch: patch(days) })) return;
            show(
              days === 0
                ? 'New tasks start with no due date'
                : `New tasks are due ${dueLabel(days).toLowerCase()}`,
              () => actions.setSettings({ patch: patch(before) }),
            );
          }}
          options={DUE_DAYS.map((days) => ({
            value: String(days),
            label: dueLabel(days),
          }))}
          wrap
          className="max-w-md"
        />
        <Hint>
          When you do not give a date, everywhere you add tasks. A date in the
          line or the form wins.
        </Hint>
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented<RoomNotes>
          legend="A note in a room goes to"
          value={settings.roomNotes}
          onChange={(value) => set('roomNotes', value)}
          options={[
            { value: 'room', label: 'The room' },
            { value: 'unfiled', label: 'Scratch' },
          ]}
          className="max-w-sm"
        />
        <Hint>
          For a note that names no project. Tasks always file in the room.
        </Hint>
      </div>
    </>
  );
}
