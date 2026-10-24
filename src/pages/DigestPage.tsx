import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  NotePencilIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { addDays, formatDay } from '#shared/dates';
import { buildDigest, digestMarkdown, weekEnding } from '#shared/digest';
import { Markdown } from '@/components/Markdown';
import { useSummaries } from '@/components/summary/SummaryProvider';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { setQuery, useQuery } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

/**
 * Your own status report: what happened in each project over seven days
 * (the last seven by default; step back a week at a time), built from the
 * activity logs and the documents' dates. Copy it as Markdown for a status
 * update, keep it as a note, or ask the on-device model for prose.
 */
export function DigestPage() {
  usePageTitle('Weekly digest');
  const { state, actions } = useDatapad();
  const { summarize } = useSummaries();
  const { show } = useToast();
  const today = useToday();
  const asked = useQuery().get('to');
  const toDay =
    asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today
      ? asked
      : today;
  const [copied, setCopied] = useState(false);

  const digest = useMemo(
    () => (state ? buildDigest(state, weekEnding(toDay)) : null),
    [state, toDay],
  );
  const markdown = digest ? digestMarkdown(digest) : '';
  const go = (day: string) => setQuery({ to: day >= today ? null : day }, {});

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      show('Could not copy. Select the text instead.');
    }
  };

  const save = () => {
    const id = actions.addNote({ projectId: null, body: markdown });
    if (id) {
      show('Saved the digest as a note in General', () =>
        actions.deleteNote({ id }),
      );
    }
  };

  return (
    <section
      aria-labelledby="digest-title"
      className="enter flex max-w-prose min-w-0 flex-col gap-4"
    >
      <h1 id="digest-title" className="text-page-title">
        Weekly digest
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="press size-11 desk:size-8"
          onClick={() => go(addDays(toDay, -7))}
        >
          <CaretLeftIcon />
          <span className="sr-only">Previous week</span>
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm font-medium sm:flex-none">
          {digest
            ? `${formatDay(digest.range.fromDay, today)} – ${formatDay(toDay, today)}`
            : ''}
        </p>
        <Button
          variant="outline"
          size="icon"
          className="press size-11 desk:size-8"
          disabled={toDay >= today}
          onClick={() => go(addDays(toDay, 7))}
        >
          <CaretRightIcon />
          <span className="sr-only">Next week</span>
        </Button>
        <span className="hidden flex-1 sm:block" />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="outline" className="press" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy as Markdown'}
          </Button>
          <Button variant="outline" className="press" onClick={save}>
            <NotePencilIcon />
            Save as note
          </Button>
          <Button
            variant="outline"
            className="press"
            onClick={() => summarize({ kind: 'digest', toDay })}
          >
            <SparkleIcon />
            Summarize
          </Button>
        </div>
      </div>
      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <section aria-label="Digest" className="border p-4">
          <Markdown text={markdown} people={state.people} />
        </section>
      )}
    </section>
  );
}
