import {
  ArrowClockwiseIcon,
  CheckIcon,
  NotePencilIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import { cardOf, type SummaryTarget, summaryNoteBody } from '#shared/summaries';
import { Markdown } from '@/components/Markdown';
import { ModelGate } from '@/components/summary/SummaryPanel';
import {
  type Run,
  useSummaries,
  useSummaryCard,
} from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

/** 44px to touch, the usual height on desktop. */
const BUTTON = 'press h-11 desk:h-8';

/**
 * A header's Summarize button (a room's, #339): asks the model for the
 * target's summary, shown in its card. Hidden while summaries are off on
 * this device.
 */
export function SummarizeButton({
  target,
  label = 'Summarize',
}: {
  /** Built when pressed, so the room's time is the time it was asked. */
  target: () => SummaryTarget;
  label?: string;
}) {
  const { summarize, enabled } = useSummaries();
  if (!enabled) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className={BUTTON}
      onClick={() => summarize(target())}
    >
      <SparkleIcon />
      {label}
    </Button>
  );
}

/**
 * What a summary card shows (Today's Brief me, a room's state and
 * meeting mode's recap): the model's consent and loading steps the first
 * time, then the text streaming in (announced politely once it settles),
 * with Stop, Regenerate, Save as note and Dismiss, and a line saying a
 * small model wrote it. `attr` names the card's data attribute, and
 * `data-<attr>-text` the text's.
 */
export function SummaryCardView({
  label,
  text,
  run,
  gated,
  onStop,
  onRegenerate,
  onSave,
  saved,
  onDismiss,
  dismissLabel,
  footnote,
  attr,
  className,
}: {
  label: string;
  text: string;
  /** The live run; undefined for a kept one (Brief me's). */
  run: Run | undefined;
  /** The model is not ready yet: the gate shows instead. */
  gated: boolean;
  onStop?: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  saved: boolean;
  onDismiss: () => void;
  dismissLabel: string;
  footnote: string;
  attr: 'brief' | 'summary';
  className?: string;
}) {
  const summaries = useSummaries();
  const { state } = useDatapad();
  const titleId = useId();
  const running = run?.status === 'running';
  const finished = !run || run.status === 'done' || run.status === 'error';
  return (
    <section
      aria-labelledby={titleId}
      {...{ [`data-${attr}`]: '' }}
      className={cn(
        'enter flex min-w-0 flex-col gap-3 border bg-card p-3 text-card-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <h2
          id={titleId}
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
          onClick={onDismiss}
        >
          <XIcon />
          <span className="sr-only">{dismissLabel}</span>
        </Button>
      </div>

      {gated ? (
        <div className="flex flex-col gap-3">
          <ModelGate summaries={summaries} />
        </div>
      ) : (
        <>
          <div
            {...{ [`data-${attr}-text`]: '' }}
            aria-live="polite"
            aria-busy={running}
            className="min-w-0"
          >
            {text && <Markdown text={text} people={state?.people ?? {}} />}
          </div>
          {run?.status === 'error' && (
            <p className="flex items-start gap-2 text-sm">
              <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
              {run.message}
            </p>
          )}
          {run && (
            <p
              role="status"
              className={
                run.status === 'error' ||
                (text && !(run.status === 'done' && run.stopped))
                  ? 'sr-only'
                  : 'text-sm text-muted-foreground'
              }
            >
              {statusOf(run)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button
                type="button"
                variant="outline"
                className={BUTTON}
                onClick={onStop}
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
                onClick={onRegenerate}
              >
                <ArrowClockwiseIcon />
                Regenerate
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={BUTTON}
              disabled={!finished || !text.trim() || saved}
              onClick={onSave}
            >
              {saved ? <CheckIcon /> : <NotePencilIcon />}
              {saved ? 'Saved' : 'Save as note'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{footnote}</p>
        </>
      )}
    </section>
  );
}

/** The status line under the text, as the summary panel words it. */
function statusOf(run: Run): string {
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

/**
 * A room's or a meeting's summary card (#339), shown while it has a run:
 * `Summary · <label>`. Save as note files the summary where the request
 * says (the room's project, a person's mention, the meeting), and logs
 * "Saved a summary as a note". Nothing is kept on the device: leaving
 * the page, or narrowing the room, stops and drops it.
 */
export function SummaryCard({
  target,
  footnote,
  className,
}: {
  /** Built when Regenerate is pressed, as the header's button builds it. */
  target: () => SummaryTarget;
  footnote: string;
  className?: string;
}) {
  const summaries = useSummaries();
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const key = cardOf(target()) ?? '';
  const live = useSummaryCard(key);
  const [savedText, setSavedText] = useState<string | null>(null);

  // Leaving the page, or another key (the room narrowed): stop and drop it.
  const close = useRef(live?.close);
  close.current = live?.close;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on key change too
  useEffect(() => () => close.current?.(), [key]);

  if (!live || !state || !summaries.enabled) return null;
  const text = live.run.status === 'idle' ? '' : live.run.text;

  const save = () => {
    const id = actions.addNote({
      projectId: live.request.projectId,
      body: namesToTokens(
        summaryNoteBody(live.request.noteLabel, text),
        state.people,
      ),
      meetingId: live.request.meetingId,
      summary: true,
    });
    if (!id) return;
    setSavedText(text);
    show('Saved the summary as a note', () => {
      if (actions.deleteNote({ id })) setSavedText(null);
    });
  };

  return (
    <SummaryCardView
      label={`Summary · ${live.request.label}`}
      text={text}
      run={live.run}
      gated={summaries.model.kind !== 'ready'}
      onStop={live.stop}
      onRegenerate={() => summaries.summarize(target())}
      onSave={save}
      saved={savedText !== null && savedText === text}
      onDismiss={live.close}
      dismissLabel="Dismiss the summary"
      footnote={footnote}
      attr="summary"
      className={className}
    />
  );
}
