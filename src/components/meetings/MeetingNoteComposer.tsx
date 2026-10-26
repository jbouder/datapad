import type { Ref } from 'react';
import type { Meeting, Person } from '#shared/types';
import {
  InlineNoteComposer,
  type InlineNoteComposerHandle,
} from '@/components/notes/InlineNoteComposer';

/** The composer's accessible name for a note on `meeting`. */
export const meetingNoteLabel = (meeting: Meeting) =>
  `New note for “${meeting.title}”`;

/** Where a meeting's unsaved note waits (sessionStorage). */
export const meetingDraftKey = (meeting: Meeting) =>
  `datapad:draft:note:meeting:${meeting.id}`;

/**
 * A note on a meeting, written in place (docs/SPEC.md § Meetings and notes
 * linkage): the inline composer, empty, sending the meeting's project and
 * its id.
 */
export function MeetingNoteComposer({
  meeting,
  people,
  onDone,
  ref,
  className,
}: {
  meeting: Meeting;
  people: Record<string, Person>;
  onDone: (noteId: string | null) => void;
  ref?: Ref<InlineNoteComposerHandle>;
  className?: string;
}) {
  return (
    <InlineNoteComposer
      ref={ref}
      fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
      people={people}
      label={meetingNoteLabel(meeting)}
      draftKey={meetingDraftKey(meeting)}
      onDone={onDone}
      className={className}
    />
  );
}
