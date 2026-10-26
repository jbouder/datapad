import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  NotePencilIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import {
  MODEL_SOURCE,
  type SummaryRequest,
  summaryNoteBody,
} from '#shared/summaries';
import { Markdown } from '@/components/Markdown';
import { SidePanel } from '@/components/SidePanel';
import { ModelPicker } from '@/components/summary/ModelPicker';
import type { Run, Summaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

/**
 * `Summary · <item>`: the model's consent and loading steps the first
 * time, then the summary streaming in as Markdown, with Stop, Copy and
 * Save as note. Closing interrupts the run (the provider's job).
 */
export function SummaryPanel({
  open,
  request,
  summaries,
  run,
  onStop,
  onClose,
  onExited,
}: {
  open: boolean;
  request: SummaryRequest;
  summaries: Summaries;
  run: Run;
  onStop: () => void;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = run.status === 'idle' ? '' : run.text;
  const running = run.status === 'running';
  const finished = run.status === 'done' || run.status === 'error';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      show('Could not copy. Select the text instead.');
    }
  };

  const save = () => {
    if (!state) return;
    const id = actions.addNote({
      projectId: request.projectId,
      body: namesToTokens(summaryNoteBody(request.label, text), state.people),
      meetingId: request.meetingId,
      summary: true,
    });
    if (!id) return;
    setSaved(true);
    show('Saved the summary as a note', () => {
      if (actions.deleteNote({ id })) setSaved(false);
    });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={`Summary · ${request.label}`}
      description="An on-device summary of this item"
      footer={
        summaries.model.kind === 'ready' && (
          <>
            <Button
              type="button"
              variant="outline"
              className="press"
              disabled={!running}
              onClick={onStop}
            >
              <StopIcon />
              Stop
            </Button>
            <span className="flex-1" />
            <Button
              type="button"
              variant="outline"
              className="press"
              disabled={!text}
              onClick={copy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              type="button"
              className="press"
              disabled={!finished || !text.trim() || saved}
              onClick={save}
            >
              {saved ? <CheckIcon /> : <NotePencilIcon />}
              {saved ? 'Saved' : 'Save as note'}
            </Button>
          </>
        )
      }
    >
      {summaries.model.kind === 'ready' ? (
        <Output run={run} people={state?.people ?? {}} />
      ) : (
        <ModelGate summaries={summaries} />
      )}
    </SidePanel>
  );
}

function Output({
  run,
  people,
}: {
  run: Run;
  people: Parameters<typeof Markdown>[0]['people'];
}) {
  const text = run.status === 'idle' ? '' : run.text;
  const status =
    run.status === 'idle' || (run.status === 'running' && !text)
      ? 'Thinking…'
      : run.status === 'running'
        ? 'Writing…'
        : run.status === 'error'
          ? run.message
          : run.stopped
            ? 'Stopped.'
            : 'Done.';
  return (
    <>
      {text && <Markdown text={text} people={people} />}
      {run.status === 'error' && (
        <p className="flex items-start gap-2 text-sm">
          <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
          {run.message}
        </p>
      )}
      <p
        role="status"
        className={
          run.status === 'error' ||
          (text && !(run.status === 'done' && run.stopped))
            ? 'sr-only'
            : 'text-sm text-muted-foreground'
        }
      >
        {status}
      </p>
      <p className="mt-auto text-xs text-muted-foreground">
        Written on this device by a small model. Check it before you rely on it.
      </p>
    </>
  );
}

/**
 * Before the model is ready: the browser check, the opt-in, the download
 * progress, or the error (holocron's `ModelGate`).
 */
function ModelGate({ summaries }: { summaries: Summaries }) {
  const { model, choice } = summaries;
  switch (model.kind) {
    case 'unsupported':
      return (
        <p className="text-sm text-muted-foreground">
          Summaries are not supported in this browser. They run on your device
          and need WebGPU, which recent Chrome, Edge, Safari and Firefox have on
          most hardware.
        </p>
      );
    case 'consent':
      return (
        <>
          <p className="text-sm">
            Summaries run on a small language model in this browser. Nothing
            about your projects, tasks, notes or events leaves the device.
          </p>
          <ModelPicker value={choice.id} onChange={summaries.choose} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>Download</dt>
            <dd>
              {model.cached
                ? 'Already in this browser’s cache.'
                : `${choice.downloadLabel}, once. It stays cached in this browser.`}
            </dd>
            <dt>From</dt>
            <dd>{MODEL_SOURCE}. It sees the download, never your data.</dd>
            <dt>Runs on</dt>
            <dd>Your GPU, in this tab.</dd>
          </dl>
          <Button type="button" className="press" onClick={summaries.load}>
            <DownloadSimpleIcon />
            {model.cached
              ? `Load ${choice.name}`
              : `Download ${choice.name} and summarize`}
          </Button>
        </>
      );
    case 'loading': {
      const percent = Math.round(model.fraction * 100);
      return (
        <>
          <p role="status" className="text-sm">
            Loading model… {percent}%
          </p>
          <div
            role="progressbar"
            aria-label="Model download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden bg-muted"
          >
            <div
              className="h-full origin-left bg-foreground transition-transform duration-(--duration-base) ease-(--ease-standard)"
              style={{ transform: `scaleX(${model.fraction})` }}
            />
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {model.text}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="press self-start"
            onClick={summaries.unload}
          >
            <XIcon />
            Cancel
          </Button>
        </>
      );
    }
    case 'error':
      return (
        <>
          <p className="flex items-start gap-2 text-sm">
            <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
            {model.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="press"
              onClick={summaries.load}
            >
              <ArrowClockwiseIcon />
              Try again
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="press"
              onClick={summaries.unload}
            >
              Pick another model
            </Button>
          </div>
        </>
      );
    case 'ready':
      return null;
  }
}
