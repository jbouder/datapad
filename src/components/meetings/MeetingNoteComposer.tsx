import type { Ref } from 'react';
import { formatDay } from '#shared/dates';
import { uncoveredTopicList } from '#shared/meetings';
import type { Meeting, NotePhase, Person } from '#shared/types';
import {
  InlineNoteComposer,
  type InlineNoteComposerHandle,
} from '@/components/notes/InlineNoteComposer';
import { useToday } from '@/hooks/useNow';

export const PHASE_LABELS: Record<NotePhase, string> = {
  pre: 'Prep',
  post: 'Debrief',
};

/**
 * A linked note's first line: "## Prep: Shield review — Tue 27 Oct", or
 * without a phase "## Shield review — Tue 27 Oct".
 */
export function seedLine(
  meeting: Meeting,
  phase: NotePhase | null,
  today: string,
) {
  const lead = phase ? `${PHASE_LABELS[phase]}: ` : '';
  return `## ${lead}${meeting.title} — ${formatDay(meeting.date, today)}`;
}

/** The seed line, and for a Prep note the uncovered topics under it. */
export function seedText(
  meeting: Meeting,
  phase: NotePhase | null,
  today: string,
) {
  const line = seedLine(meeting, phase, today);
  const topics = phase === 'pre' ? uncoveredTopicList(meeting) : '';
  return `${topics ? `${line}\n${topics}` : line}\n`;
}

/**
 * A note on a meeting, written in place (docs/SPEC.md § Meetings and notes
 * linkage): the inline composer with the phase picker, sending the
 * meeting's project, its id and the phase.
 */
export function MeetingNoteComposer({
  meeting,
  people,
  phase,
  onPhaseChange,
  onDone,
  ref,
  className,
}: {
  meeting: Meeting;
  people: Record<string, Person>;
  phase: NotePhase | null;
  onPhaseChange: (phase: NotePhase | null) => void;
  onDone: (noteId: string | null) => void;
  ref?: Ref<InlineNoteComposerHandle>;
  className?: string;
}) {
  const today = useToday();
  return (
    <InlineNoteComposer
      ref={ref}
      fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
      people={people}
      label={`New note for “${meeting.title}”`}
      phase={{ value: phase, onChange: onPhaseChange }}
      seed={seedText(meeting, phase, today)}
      draftKey={`datapad:draft:note:meeting:${meeting.id}`}
      onDone={onDone}
      className={className}
    />
  );
}
