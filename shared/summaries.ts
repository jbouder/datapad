import { formatDay } from './dates';
import { EVENT_TYPE_LABELS, timeRange } from './events';
import { tokensToNames } from './mentions';
import type { Event, Note, Snapshot } from './types';

/**
 * The plain-text context each Summarize action sends to the model
 * (docs/SPEC.md § Claude summaries): labelled sections, mentions as
 * names, nothing from outside the item. Event first; the rest land with
 * on-device summaries (M6).
 */

const PHASE_TAG = { pre: '[prep]', post: '[debrief]' } as const;

function noteDay(note: Note): string {
  return formatDay(note.createdAt.slice(0, 10), '0000-01-01');
}

/**
 * An event: title, type, date and times, project, attendees, agenda, and
 * every linked note, oldest first, labelled `[prep]`, `[debrief]` or
 * `[note]`.
 */
export function eventContext(
  event: Event,
  state: Pick<Snapshot, 'projects' | 'people' | 'notes'>,
): string {
  const project = event.projectId
    ? (state.projects[event.projectId]?.name ?? 'General')
    : 'General';
  const attendees = event.attendees
    .map((id) => state.people[id]?.name)
    .filter(Boolean)
    .join(', ');
  const range = timeRange(event);
  const lines = [
    `Event: ${event.title}`,
    `Type: ${EVENT_TYPE_LABELS[event.type]}`,
    `Date: ${formatDay(event.date, '0000-01-01')}${range ? `, ${range}` : ''}`,
    `Project: ${project}`,
    `Attendees: ${attendees || 'none listed'}`,
  ];
  if (event.note) lines.push(`Agenda: ${event.note}`);

  const notes = Object.values(state.notes)
    .filter((n) => n.eventId === event.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (notes.length > 0) {
    lines.push('', 'Linked notes:');
    for (const n of notes) {
      const tag = n.phase ? PHASE_TAG[n.phase] : '[note]';
      lines.push(
        `${tag} ${noteDay(n)}`,
        tokensToNames(n.body, state.people).trim(),
        '',
      );
    }
  }
  return lines.join('\n').trimEnd();
}
