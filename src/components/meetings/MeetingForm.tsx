import { useMemo, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { parseTime } from '#shared/meetings';
import type { Meeting } from '#shared/types';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { MemberChips } from '@/components/inputs/MemberChips';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDatapad } from '@/hooks/useDatapad';
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
}

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
 * the meeting's notes.
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
    if (!meeting) {
      const id = actions.addMeeting(fields);
      if (!id) return;
      onClose();
      show(`Added “${fields.title}”`);
      return;
    }
    const before = valuesOf(meeting);
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(before[key as keyof typeof fields]),
      ),
    );
    if (Object.keys(patch).length > 0) {
      if (!actions.editMeeting({ id: meeting.id, patch })) return;
      show(`Saved “${fields.title}”`);
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
    </SidePanel>
  );
}

/** "Delete Shield review? Its 2 notes are kept." */
export function deleteMeetingQuestion(title: string, notes: number): string {
  if (notes === 0) return `Delete ${title}?`;
  return `Delete ${title}? ${notes === 1 ? 'Its note is' : `Its ${notes} notes are`} kept.`;
}
