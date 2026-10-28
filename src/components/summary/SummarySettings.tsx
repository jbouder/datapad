import { TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { MODEL_SOURCE } from '#shared/summaries';
import { ModelPicker } from '@/components/summary/ModelPicker';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/providers/ToastProvider';

/**
 * Settings → Summaries: whether this device offers Summarize at all,
 * which model it uses, and the way to take its weights back off the
 * device.
 */
export function SummarySettings() {
  const summaries = useSummaries();
  const { model, enabled } = summaries;

  return (
    <>
      <label
        htmlFor="summaries-switch"
        className="flex min-h-11 items-center justify-between gap-4 text-sm desk:min-h-8"
      >
        <span className="flex flex-col">
          <span className="font-medium">Summaries</span>
          <span className="text-xs text-muted-foreground">
            {enabled
              ? 'Summarize on projects, tasks, meetings, notes and the digest. Remembered on this device.'
              : 'Off on this device: nothing offers Summarize and the model is never loaded.'}
          </span>
        </span>
        <Switch
          id="summaries-switch"
          checked={enabled}
          onCheckedChange={(on) => summaries.setEnabled(on)}
        />
      </label>
      {model.kind === 'unsupported' ? (
        <p className="text-sm text-muted-foreground">
          Summaries are not supported in this browser. They run on your device
          and need WebGPU, which recent Chrome, Edge, Safari and Firefox have on
          most hardware.
        </p>
      ) : (
        <ModelSettings />
      )}
    </>
  );
}

/** The model and its weights; off, only the way to remove them. */
function ModelSettings() {
  const summaries = useSummaries();
  const { model, choice, enabled } = summaries;
  const { show } = useToast();
  const [removing, setRemoving] = useState(false);

  useEffect(() => summaries.checkCache(), [summaries.checkCache]);

  const cached =
    model.kind === 'ready' || (model.kind === 'consent' && model.cached);
  const busy = model.kind === 'loading' || removing;

  const remove = async () => {
    setRemoving(true);
    try {
      await summaries.remove();
      show(`Removed ${choice.name} from this browser`);
    } catch {
      show('Could not remove the model. Clear this site’s data instead.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      {enabled && (
        <>
          <p className="text-sm text-muted-foreground">
            Summarize runs a small language model in this browser. The weights
            download once from {MODEL_SOURCE} when you first agree; nothing
            about your projects, tasks, notes or meetings is ever sent anywhere.
            Remembered on this device.
          </p>
          <ModelPicker
            value={choice.id}
            onChange={summaries.choose}
            disabled={busy}
          />
        </>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Downloaded model</h3>
        <p role="status" className="text-sm text-muted-foreground">
          {model.kind === 'loading'
            ? `${choice.name} is loading.`
            : model.kind === 'consent' && model.cached === null
              ? 'Checking this browser…'
              : cached
                ? enabled
                  ? `${choice.name} is in this browser’s cache.`
                  : `${choice.name} is still in this browser’s cache. Remove it to free the space; turning summaries on again downloads it when you next agree.`
                : `${choice.name} is not downloaded.`}
        </p>
        <Button
          variant="outline"
          className="press self-start"
          disabled={!cached || busy}
          onClick={remove}
        >
          <TrashIcon />
          Remove downloaded model
        </Button>
      </div>
    </>
  );
}
