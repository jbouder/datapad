/**
 * Prototype: meeting mode. A full screen with the agenda on the left,
 * notes in the middle and the room's open loops on the right; action
 * items collect under the notes. Prep and debrief are the same screen,
 * before and after. Esc leaves.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatTimeRange, longDay } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { namesToTokens } from '#shared/mentions';
import { meId, notesOfMeeting, tasksOfMeeting } from '#shared/select';
import { topicsOf } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { lanesOf, taskTouches } from './model';
import { go } from './nav';
import { Go, LanesPanel, personName, SectionTitle, TaskList } from './parts';

export function MeetingMode({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const today = useToday();
  const clock = useClock();
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const meeting = state?.meetings[id];
  const me = state ? meId(state.people) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      )
        go({ name: 'today' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The person's loops for a 1:1, otherwise the project's.
  const others = meeting?.attendees.filter((p) => p !== me) ?? [];
  const oneOnOne = others.length === 1 ? others[0] : null;
  const lanes = useMemo(() => {
    if (!state || !meeting) return null;
    if (oneOnOne) return lanesOf(state, me, (t) => taskTouches(t, oneOnOne));
    if (meeting.projectId)
      return lanesOf(state, me, (t) => t.projectId === meeting.projectId);
    return null;
  }, [state, meeting, me, oneOnOne]);

  if (!state) return null;
  if (!meeting) {
    return (
      <div className="p-6">
        <p className="mb-2">That meeting is not in this space.</p>
        <Go to={{ name: 'today' }} className="underline">
          Back to Today
        </Go>
      </div>
    );
  }
  const topics = topicsOf(meeting);
  const notes = notesOfMeeting(state.notes, id);
  const actionItems = tasksOfMeeting(state.tasks, id);
  const items = [...actionItems.open, ...actionItems.done];
  const project = meeting.projectId ? state.projects[meeting.projectId] : null;
  const phase =
    meeting.date > today ? 'Prep' : meeting.date < today ? 'Debrief' : 'Live';

  const addTopic = () => {
    if (
      topic.trim() &&
      actions.addTopic({ meetingId: id, title: topic.trim() })
    )
      setTopic('');
  };
  const addNote = () => {
    const body = namesToTokens(note.trim(), state.people);
    if (
      body &&
      actions.addNote({ projectId: meeting.projectId, meetingId: id, body })
    )
      setNote('');
  };
  const addAction = () => {
    const title = action.trim();
    if (
      title &&
      actions.addTask({ projectId: meeting.projectId, meetingId: id, title })
    )
      setAction('');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-primary text-xs uppercase tracking-wider">
            {phase} · {longDay(meeting.date, today)}
            {meeting.time &&
              `, ${formatTimeRange(meeting.time, meeting.end, clock)}`}
          </p>
          <h1 className="truncate font-heading text-xl">{meeting.title}</h1>
          <p className="text-muted-foreground text-sm">
            {project && (
              <Go
                to={{ name: 'project', id: project.id }}
                className="hover:underline"
              >
                {project.name}
              </Go>
            )}
            {project && meeting.attendees.length > 0 && ' · '}
            {meeting.attendees.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <Go to={{ name: 'person', id: p }} className="hover:underline">
                  {personName(state, p)}
                </Go>
              </span>
            ))}
          </p>
        </div>
        <div className="flex gap-2">
          {meeting.link && (
            <a
              href={meeting.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center border border-border px-3 text-xs hover:bg-muted desk:h-8"
            >
              Join
            </a>
          )}
          <Button
            variant="outline"
            onClick={() =>
              window.history.length > 1
                ? window.history.back()
                : go({ name: 'today' })
            }
          >
            Leave <kbd className="ml-1 text-muted-foreground">Esc</kbd>
          </Button>
        </div>
      </header>

      <div className="grid flex-1 gap-6 p-4 sm:p-6 desk:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <section aria-label="Agenda">
          <SectionTitle count={topics.length}>Agenda</SectionTitle>
          <ul className="flex flex-col">
            {topics.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2">
                <span className="flex h-6 items-center">
                  <Checkbox
                    checked={t.done}
                    onCheckedChange={(done) =>
                      actions.toggleTopic({
                        meetingId: id,
                        id: t.id,
                        done: Boolean(done),
                      })
                    }
                    aria-label={
                      t.done ? `Reopen ${t.title}` : `Cover ${t.title}`
                    }
                  />
                </span>
                <span
                  className={cn(
                    'text-sm leading-6',
                    t.done && 'text-muted-foreground line-through',
                  )}
                >
                  {t.title}
                  {t.carriedFrom && (
                    <span className="block text-muted-foreground text-xs">
                      carried forward
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTopic()}
            placeholder="Add a topic, Enter"
            aria-label="Add a topic"
            className="mt-2 h-11 w-full border border-border bg-transparent px-2 text-base outline-none focus:border-ring desk:h-8 desk:text-sm"
          />
          {meeting.note && (
            <p className="mt-4 whitespace-pre-wrap text-muted-foreground text-sm">
              {meeting.note}
            </p>
          )}
        </section>

        <section aria-label="Notes" className="min-w-0">
          <SectionTitle count={notes.length}>Notes</SectionTitle>
          <div className="mb-4 border border-border focus-within:border-ring">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  addNote();
                }
              }}
              rows={6}
              placeholder="Notes as you go. ⌘Enter saves."
              aria-label="Meeting note"
              className="block w-full resize-y bg-transparent p-3 text-base outline-none placeholder:text-muted-foreground desk:text-sm"
            />
            <div className="flex justify-end border-border border-t p-1.5">
              <Button size="sm" onClick={addNote} disabled={!note.trim()}>
                Save note
              </Button>
            </div>
          </div>
          <ol className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="border border-border p-3">
                <Markdown
                  text={n.body}
                  people={state.people}
                  onToggle={(line) =>
                    actions.editNote({
                      id: n.id,
                      body: toggleCheck(n.body, line),
                    })
                  }
                />
              </li>
            ))}
          </ol>

          <div className="mt-6">
            <SectionTitle count={items.length}>Action items</SectionTitle>
            <TaskList
              tasks={items}
              empty="None yet."
              showProject={false}
              limit={50}
            />
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAction()}
              placeholder="Add an action item, Enter"
              aria-label="Add an action item"
              className="mt-2 h-11 w-full border border-border bg-transparent px-2 text-base outline-none focus:border-ring desk:h-8 desk:text-sm"
            />
          </div>
        </section>

        <aside aria-label="Open loops">
          {lanes ? (
            <>
              <p className="mb-3 text-muted-foreground text-xs">
                Open with{' '}
                {oneOnOne ? personName(state, oneOnOne) : project?.name}
              </p>
              <LanesPanel
                lanes={lanes}
                labels={
                  oneOnOne
                    ? ['You owe', 'They owe you', 'To discuss']
                    : undefined
                }
                groupWaiting={!oneOnOne}
                showProject={!!oneOnOne}
              />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No project or single attendee, so no open loops to show.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
