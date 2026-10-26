import { TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { MODEL_SOURCE } from '#shared/summaries';
import { ModelPicker } from '@/components/summary/ModelPicker';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/providers/ToastProvider';

/**
 * Settings → Summaries: which model Summarize uses on this device, and
 * the way to take its weights back off the device.
 */
export function SummarySettings() {
  const summaries = useSummaries();
  const { model, choice } = summaries;
  const { show } = useToast();
  const [removing, setRemoving] = useState(false);

  useEffect(() => summaries.checkCache(), [summaries.checkCache]);

  if (model.kind === 'unsupported') {
    return (
      <p className="text-sm text-muted-foreground">
        Summaries are not supported in this browser. They run on your device and
        need WebGPU, which recent Chrome, Edge, Safari and Firefox have on most
        hardware.
      </p>
    );
  }

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
      <p className="text-sm text-muted-foreground">
        Summarize runs a small language model in this browser. The weights
        download once from {MODEL_SOURCE} when you first agree; nothing about
        your projects, tasks, notes or meetings is ever sent anywhere.
        Remembered on this device.
      </p>
      <ModelPicker
        value={choice.id}
        onChange={summaries.choose}
        disabled={busy}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Downloaded model</h3>
        <p role="status" className="text-sm text-muted-foreground">
          {model.kind === 'loading'
            ? `${choice.name} is loading.`
            : model.kind === 'consent' && model.cached === null
              ? 'Checking this browser…'
              : cached
                ? `${choice.name} is in this browser’s cache.`
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
