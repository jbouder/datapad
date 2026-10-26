import { useId, useMemo, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { LIMITS } from '#shared/limits';
import {
  carryOps,
  checkTopicLines,
  parseTime,
  previousMeeting,
  topicOps,
  topicsNoun,
  topicsToCarry,
} from '#shared/meetings';
import type { OpOf } from '#shared/protocol';
import { notesOfMeeting } from '#shared/select';
import type { Meeting } from '#shared/types';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { MemberChips } from '@/components/inputs/MemberChips';
import {
  meetingDraftKey,
  meetingNoteLabel,
} from '@/components/meetings/MeetingNoteComposer';
import {
  MeetingTopics,
  PendingTopics,
} from '@/components/meetings/MeetingTopics';
import { LinkedNoteList } from '@/components/notes/LinkedNoteList';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { newId } from '@/lib/ids';
import { useToast } from '@/providers/ToastProvider';

/** Where a new meeting starts: its project (fixed or picked) and day. */
export interface MeetingPreset {
  projectId: string | null;
  /** A project page's Add meeting: the project is not asked for. */
  fixedProject?: boolean;
  date?: string;
}

interface Values {
  title: string;
  projectId: string | null;
  date: string;
  time: string;
  end: string;
  attendees: string[];
  link: string;
  note: string;
  /**
   * A new meeting's topics, saved with it. An existing meeting's are
   * changed in place in the panel, as ops, like its notes.
   */
  topics: string[];
}

type MeetingOp = OpOf<'addMeeting'> | OpOf<'editMeeting'>;

function valuesOf(
  meeting: Meeting | undefined,
  preset?: MeetingPreset,
): Values {
  return {
    title: meeting?.title ?? '',
    projectId: meeting ? meeting.projectId : (preset?.projectId ?? null),
    date: meeting?.date ?? preset?.date ?? '',
    time: meeting?.time ?? '',
    end: meeting?.end ?? '',
    attendees: meeting?.attendees ?? [],
    link: meeting?.link ?? '',
    note: meeting?.note ?? '',
    topics: [],
  };
}

/**
 * A time you can type (`9`, `930`, `2pm`; see `parseTime`), tidied to
 * `HH:MM` when you leave the field. Text it cannot read stays, marked.
 */
function TimeInput({
  id,
  value,
  onChange,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  id?: string;
  value: string;
  /** The typed text, and the time it reads as (null: unreadable). */
  onChange: (text: string, time: string | null) => void;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <Input
      id={id}
      value={value}
      inputMode="text"
      autoComplete="off"
      placeholder="e.g. 9:30, 2pm"
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className="h-11 text-base tabular-nums desk:h-8 desk:text-xs"
      onChange={(e) => onChange(e.target.value, parseTime(e.target.value))}
      onBlur={(e) => {
        const time = parseTime(e.target.value);
        if (time !== null) onChange(time, time);
      }}
    />
  );
}

/**
 * Create or edit a meeting in the side panel. Title and date are all it
 * needs; the values are read once when it opens. Save moves focus to the
 * first problem instead of being disabled. Delete asks first and keeps
 * the meeting's notes. An existing meeting's topics and notes are listed
 * at the end, added and edited in place (a task's notes are too); they
 * save on their own. A new meeting's topics wait and go with it.
 */
export function MeetingForm({
  meeting,
  preset,
  open,
  onClose,
  onExited,
}: {
  /** Absent: a new meeting. */
  meeting?: Meeting;
  preset?: MeetingPreset;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const [initial] = useState(() => valuesOf(meeting, preset));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>(
    {},
  );
  const [dateInvalid, setDateInvalid] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = useDirty(values, initial);
  const today = useToday();
  const carryId = useId();
  /** The carry-forward line's checkbox (on by default). */
  const [carry, setCarry] = useState(true);

  // A new meeting in a series: the last one's uncovered topics, to carry.
  const meetings = state?.meetings;
  const previous = useMemo(
    () =>
      meeting || !meetings
        ? null
        : previousMeeting(meetings, {
            projectId: values.projectId,
            title: values.title,
            attendees: values.attendees,
            date: values.date,
            time: parseTime(values.time) ?? '',
          }),
    [
      meeting,
      meetings,
      values.projectId,
      values.title,
      values.attendees,
      values.date,
      values.time,
    ],
  );
  const carried = useMemo(
    () => (previous ? topicsToCarry(previous) : []),
    [previous],
  );
  const carrying = carry && previous !== null && carried.length > 0;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const people = useMemo(
    () =>
      Object.values(state?.people ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state?.people],
  );

  const check = (): Partial<Record<keyof Values, string>> => {
    const found: Partial<Record<keyof Values, string>> = {};
    if (!values.title.trim()) found.title = 'Give the meeting a title';
    if (dateInvalid) found.date = 'Try a date like fri, 10/31 or +3d';
    else if (!values.date) found.date = 'Pick a day';
    const time = parseTime(values.time);
    const end = parseTime(values.end);
    if (time === null) found.time = 'Try a time like 9, 9:30 or 2pm';
    if (end === null) found.end = 'Try a time like 10, 10:30 or 3pm';
    else if (end && !time) found.end = 'Give a start time first';
    else if (end && time && end <= time) found.end = 'End after it starts';
    const topics = meeting
      ? null
      : checkTopicLines(values.topics, carrying ? carried.length : 0);
    if (topics) found.topics = topics;
    return found;
  };

  const save = () => {
    const found = check();
    const first = (Object.keys(found) as (keyof Values)[])[0];
    if (first) {
      setErrors(found);
      document.getElementById(`meeting-${first}`)?.focus();
      return;
    }
    const fields = {
      title: values.title.trim(),
      projectId: values.projectId,
      date: values.date,
      time: parseTime(values.time) ?? '',
      end: parseTime(values.end) ?? '',
      attendees: values.attendees,
      link: values.link.trim(),
      note: values.note.trim(),
    };
    // The meeting op, then one addTopic per pending topic, as one batch
    // (or the meeting op alone when there are none).
    const id = meeting?.id ?? newId();
    let op: MeetingOp | null = null;
    if (!meeting) {
      op = { type: 'addMeeting', id, ...fields };
    } else {
      const before = valuesOf(meeting);
      const patch: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(before[key as keyof typeof fields]),
        ),
      );
      if (Object.keys(patch).length > 0) {
        op = { type: 'editMeeting', id, patch };
      }
    }
    // Carried topics first (they were on the agenda already), then the
    // typed ones.
    const topics = meeting
      ? []
      : [
          ...(carrying && previous
            ? carryOps(previous, carried, id, newId)
            : []),
          ...topicOps(id, values.topics, newId),
        ];
    if (op || topics.length > 0) {
      const ok =
        topics.length > 0
          ? actions.batch({ ops: op ? [op, ...topics] : topics })
          : op?.type === 'addMeeting'
            ? actions.addMeeting(op) !== null
            : op?.type === 'editMeeting' && actions.editMeeting(op);
      if (!ok) return;
      show(`${meeting ? 'Saved' : 'Added'} “${fields.title}”`);
    }
    onClose();
  };

  const remove = () => {
    if (!meeting) return;
    if (!actions.deleteMeeting({ id: meeting.id })) return;
    onClose();
    show(`Deleted “${meeting.title}”`);
  };

  const linked = meeting
    ? Object.values(state?.notes ?? {}).filter(
        (n) => n.meetingId === meeting.id,
      ).length
    : 0;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={meeting ? `Edit ${meeting.title}` : 'New meeting'}
      dirty={dirty}
      onSubmit={save}
      footer={
        confirmingDelete && meeting ? (
          <div
            role="alertdialog"
            aria-labelledby="meeting-delete-question"
            className="flex w-full flex-wrap items-center gap-2"
          >
            <p id="meeting-delete-question" className="flex-1 text-sm">
              {deleteMeetingQuestion(meeting.title, linked)}
            </p>
            <Button
              type="button"
              variant="outline"
              className="press"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="press"
              onClick={remove}
            >
              Delete meeting
            </Button>
          </div>
        ) : (
          <>
            {meeting && (
              <Button
                type="button"
                variant="ghost"
                className="press text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <SidePanelCancel />
            <Button type="submit" className="press">
              {meeting ? 'Save' : 'Add meeting'}
            </Button>
          </>
        )
      }
    >
      <Field label="Title" required error={errors.title}>
        <Input
          id="meeting-title"
          ref={titleRef}
          value={values.title}
          maxLength={LIMITS.titleMax}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 text-base desk:h-8 desk:text-xs"
          onChange={(e) => set('title', e.target.value)}
        />
      </Field>
      {!(preset?.fixedProject && !meeting) && (
        <Field label="Project">
          <ProjectPicker
            value={values.projectId}
            onChange={(id) => set('projectId', id)}
          />
        </Field>
      )}
      <Field
        label="Date"
        required
        error={errors.date}
        hint="today, fri, next tue, +3d, 10/31"
      >
        <DatePicker
          id="meeting-date"
          value={values.date}
          onChange={(date) => set('date', date)}
          onInvalidChange={setDateInvalid}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Time" error={errors.time}>
          <TimeInput
            id="meeting-time"
            value={values.time}
            onChange={(text) => set('time', text)}
          />
        </Field>
        <Field label="End" error={errors.end}>
          <TimeInput
            id="meeting-end"
            value={values.end}
            onChange={(text) => set('end', text)}
          />
        </Field>
      </div>
      <MemberChips
        label="Attendees"
        people={people}
        value={values.attendees}
        onChange={(attendees) => set('attendees', attendees)}
      />
      <Field label="Link" hint="The meeting room, the doc, the release">
        <Input
          id="meeting-link"
          type="url"
          value={values.link}
          maxLength={LIMITS.urlMax}
          autoComplete="off"
          placeholder="https://"
          className="h-11 text-base desk:h-8 desk:text-xs"
          onChange={(e) => set('link', e.target.value)}
        />
      </Field>
      <Field label="Agenda" hint="Plain text">
        <Textarea
          id="meeting-note"
          value={values.note}
          maxLength={LIMITS.meetingNoteMax}
          rows={3}
          className="text-base desk:text-sm"
          onChange={(e) => set('note', e.target.value)}
        />
      </Field>
      {previous && carried.length > 0 && (
        <div className="flex flex-col">
          <label
            htmlFor={carryId}
            data-carry-forward
            className="flex min-h-11 items-center gap-2 text-sm desk:min-h-8"
          >
            <Checkbox
              id={carryId}
              checked={carry}
              aria-describedby={`${carryId}-list`}
              onCheckedChange={(on) => setCarry(on === true)}
            />
            Carry forward {topicsNoun(carried.length)} from{' '}
            {formatDay(previous.date, today)}
          </label>
          <p
            id={`${carryId}-list`}
            className="pl-6 text-xs break-words text-muted-foreground"
          >
            {carried.map((t) => t.title).join(' · ')}
          </p>
        </div>
      )}
      {meeting ? (
        <MeetingTopics meeting={state?.meetings[meeting.id] ?? meeting} panel />
      ) : (
        <PendingTopics
          id="meeting-topics"
          titles={values.topics}
          onChange={(topics) => set('topics', topics)}
          existing={carrying ? carried.length : 0}
          error={errors.topics}
        />
      )}
      {meeting && state && (
        <LinkedNoteList
          notes={notesOfMeeting(state.notes, meeting.id)}
          fields={{ projectId: meeting.projectId, meetingId: meeting.id }}
          people={state.people}
          label={meetingNoteLabel(meeting)}
          draftKey={meetingDraftKey(meeting)}
        />
      )}
    </SidePanel>
  );
}

/** "Delete Shield review? Its 2 notes are kept." */
export function deleteMeetingQuestion(title: string, notes: number): string {
  if (notes === 0) return `Delete ${title}?`;
  return `Delete ${title}? ${notes === 1 ? 'Its note is' : `Its ${notes} notes are`} kept.`;
}
