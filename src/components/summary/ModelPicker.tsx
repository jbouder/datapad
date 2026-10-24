import { SUMMARY_MODELS } from '#shared/summaries';
import { cn } from '@/lib/utils';

/**
 * The three models as cards of radios: name, download and GPU memory,
 * and who each suits. In the summary panel's consent step and in
 * Settings → Summaries.
 */
export function ModelPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium">Summary model</legend>
      {SUMMARY_MODELS.map((m) => {
        const selected = m.id === value;
        return (
          <label
            key={m.id}
            className={cn(
              'press flex cursor-pointer flex-col gap-1 border p-3 outline-ring/50 has-focus-visible:outline-2 has-disabled:cursor-not-allowed has-disabled:opacity-60',
              selected ? 'border-foreground bg-muted/40' : 'hover:bg-muted/40',
            )}
          >
            <input
              type="radio"
              name="summary-model"
              value={m.id}
              checked={selected}
              onChange={() => onChange(m.id)}
              className="sr-only"
            />
            <span className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-sm font-medium">{m.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {m.downloadLabel} · {m.vramLabel} of GPU memory
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{m.note}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
