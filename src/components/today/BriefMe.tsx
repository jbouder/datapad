import { SparkleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { namesToTokens } from '#shared/mentions';
import type { FocusOptions } from '#shared/select';
import { briefLabel, briefNoteBody } from '#shared/summaries';
import { SummaryCardView } from '@/components/summary/SummaryCard';
import {
  useSummaries,
  useSummaryCard,
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

/**
 * Today's header button: asks the model for today's brief (#259, on
 * Today since #332), with the saved settings (#311).
 */
export function BriefMeButton({
  today,
  options,
}: {
  today: string;
  options: FocusOptions;
}) {
  const { summarize } = useSummaries();
  if (!useBriefAvailable()) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className={BUTTON}
      onClick={() => summarize({ kind: 'brief', today, options })}
    >
      <SparkleIcon />
      Brief me
    </Button>
  );
}

/**
 * The brief, as a card above Today's timeline: the model's consent and
 * loading steps the first time, then the text streaming in (announced
 * politely once it settles), with Stop, Regenerate, Save as note (a
 * General note, "Brief · <day>") and dismiss. The text is kept on this
 * device per space and per day (`brief-cache.ts`), so it is still here
 * when Today is opened again today. Leaving Today stops a run.
 */
export function BriefCard({
  today,
  options,
}: {
  today: string;
  options: FocusOptions;
}) {
  const summaries = useSummaries();
  const live = useSummaryCard('brief');
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

  // Leaving Today (or another space) stops the run; the card is Today's.
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
  const gated = live !== null && summaries.model.kind !== 'ready';
  const label = live?.request.label ?? briefLabel(today);

  const regenerate = () =>
    summaries.summarize({ kind: 'brief', today, options });

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

  return (
    <SummaryCardView
      label={label}
      text={text}
      run={live?.run}
      gated={gated}
      onStop={live?.stop}
      onRegenerate={regenerate}
      onSave={save}
      saved={savedText === text}
      onDismiss={dismiss}
      dismissLabel="Dismiss the brief"
      footnote="Written on this device by a small model from what Today shows. Check it before you rely on it."
      attr="brief"
    />
  );
}
