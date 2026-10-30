import {
  ArrowClockwiseIcon,
  CheckIcon,
  NotePencilIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import { briefLabel, briefNoteBody } from '#shared/summaries';
import { Markdown } from '@/components/Markdown';
import { ModelGate } from '@/components/summary/SummaryPanel';
import {
  type Run,
  useBrief,
  useSummaries,
} from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { clearBrief, readBrief, writeBrief } from '@/lib/brief-cache';
import { useSpaces } from '@/providers/DatapadProvider';
import { useToast } from '@/providers/ToastProvider';

/** 44px to touch, the usual height on desktop. */
const BUTTON = 'press h-11 desk:h-8';

/**
 * Brief me is offered where summaries are on for this device and the
 * browser can run the model: never on a device without WebGPU.
 */
function useBriefAvailable(): boolean {
  const { enabled, model } = useSummaries();
  return enabled && model.kind !== 'unsupported';
}

/** Focus's header button: asks the model for today's brief (#259). */
export function BriefMeButton({ today }: { today: string }) {
  const { summarize } = useSummaries();
  if (!useBriefAvailable()) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className={BUTTON}
      onClick={() => summarize({ kind: 'brief', today })}
    >
      <SparkleIcon />
      Brief me
    </Button>
  );
}

/**
 * The brief, as a card at the top of Focus: the model's consent and
 * loading steps the first time, then the text streaming in (announced
 * politely once it settles), with Stop, Regenerate, Save as note (a
 * General note, "Brief · <day>") and dismiss. The text is kept on this
 * device per space and per day (`brief-cache.ts`), so it is still here
 * when Focus is opened again today. Leaving Focus stops a run.
 */
export function BriefCard({ today }: { today: string }) {
  const summaries = useSummaries();
  const live = useBrief();
  const { state, actions } = useDatapad();
  const { current } = useSpaces();
  const { show } = useToast();
  const space = current.id;
  const available = useBriefAvailable();

  const [stored, setStored] = useState(() => readBrief(space, today));
  const [savedText, setSavedText] = useState<string | null>(null);
  // Another space, or midnight: what is kept for that one.
  useEffect(() => {
    setStored(readBrief(space, today));
  }, [space, today]);

  const run = live?.run;
  // A finished run is kept (a stopped one too: it is what was asked for).
  useEffect(() => {
    if (run?.status === 'done' && run.text.trim()) {
      writeBrief(space, today, run.text);
      setStored(run.text);
    }
  }, [run, space, today]);

  // Leaving Focus (or another space) stops the run; the card is Focus's.
  const close = useRef(live?.close);
  close.current = live?.close;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on space change too
  useEffect(() => () => close.current?.(), [space]);

  if (!available || !state) return null;
  if (!live && stored === null) return null;

  const text = live
    ? live.run.status === 'idle'
      ? ''
      : live.run.text
    : (stored ?? '');
  const running = live?.run.status === 'running';
  const gated = live !== null && summaries.model.kind !== 'ready';
  const finished =
    !live || live.run.status === 'done' || live.run.status === 'error';
  const label = live?.request.label ?? briefLabel(today);

  const regenerate = () => summaries.summarize({ kind: 'brief', today });

  const dismiss = () => {
    live?.close();
    clearBrief(space);
    setStored(null);
  };

  const save = () => {
    const id = actions.addNote({
      projectId: null,
      body: namesToTokens(briefNoteBody(today, text), state.people),
      meetingId: null,
      summary: true,
    });
    if (!id) return;
    setSavedText(text);
    show('Saved the brief as a note', () => {
      if (actions.deleteNote({ id })) setSavedText(null);
    });
  };

  const status = statusOf(live?.run);

  return (
    <section
      aria-labelledby="brief-title"
      data-brief
      className="enter flex min-w-0 flex-col gap-3 border bg-card p-3 text-card-foreground"
    >
      <div className="flex items-center gap-2">
        <h2
          id="brief-title"
          className="flex min-w-0 flex-1 items-center gap-1.5 font-heading text-sm font-semibold"
        >
          <SparkleIcon aria-hidden className="shrink-0" />
          <span className="truncate">{label}</span>
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="press size-11 desk:size-8"
          onClick={dismiss}
        >
          <XIcon />
          <span className="sr-only">Dismiss the brief</span>
        </Button>
      </div>

      {gated ? (
        <div className="flex flex-col gap-3">
          <ModelGate summaries={summaries} />
        </div>
      ) : (
        <>
          <div
            data-brief-text
            aria-live="polite"
            aria-busy={running}
            className="min-w-0"
          >
            {text && <Markdown text={text} people={state.people} />}
          </div>
          {live?.run.status === 'error' && (
            <p className="flex items-start gap-2 text-sm">
              <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
              {live.run.message}
            </p>
          )}
          {live && (
            <p
              role="status"
              className={
                live.run.status === 'error' ||
                (text && !(live.run.status === 'done' && live.run.stopped))
                  ? 'sr-only'
                  : 'text-sm text-muted-foreground'
              }
            >
              {status}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button
                type="button"
                variant="outline"
                className={BUTTON}
                onClick={live?.stop}
              >
                <StopIcon />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className={BUTTON}
                disabled={!finished}
                onClick={regenerate}
              >
                <ArrowClockwiseIcon />
                Regenerate
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={BUTTON}
              disabled={!finished || !text.trim() || savedText === text}
              onClick={save}
            >
              {savedText === text ? <CheckIcon /> : <NotePencilIcon />}
              {savedText === text ? 'Saved' : 'Save as note'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Written on this device by a small model from what Focus shows. Check
            it before you rely on it.
          </p>
        </>
      )}
    </section>
  );
}

/** The status line under the text, as the summary panel words it. */
function statusOf(run: Run | undefined): string {
  if (!run) return '';
  switch (run.status) {
    case 'idle':
      return 'Thinking…';
    case 'running':
      return run.text ? 'Writing…' : 'Thinking…';
    case 'error':
      return run.message;
    case 'done':
      return run.stopped ? 'Stopped.' : 'Done.';
  }
}
