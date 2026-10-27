import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChatTextIcon,
  CheckIcon,
  CheckSquareOffsetIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  GavelIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { type Ref, useId, useRef, useState } from 'react';
import { formatDay } from '#shared/dates';
import { LIMITS } from '#shared/limits';
import { restoredOrder, topicCount } from '#shared/meetings';
import type { Op } from '#shared/protocol';
import { type Meeting, type Topic, topicsOf } from '#shared/types';
import { useDecisionPanel } from '@/components/decisions/DecisionPanelProvider';
import { useTaskPanels } from '@/components/tasks/TaskPanelProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDatapad } from '@/hooks/useDatapad';
import { useFlip } from '@/hooks/useFlip';
import { useToday } from '@/hooks/useNow';
import { dropIndex, moveItem } from '@/lib/reorder';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

type BatchOps = Extract<Op, { type: 'batch' }>['ops'];

const ICON_BUTTON =
  'press flex size-11 shrink-0 items-center justify-center text-muted-foreground outline-ring/50 hover:bg-accent hover:text-foreground focus-visible:outline-2 data-popup-open:bg-accent desk:size-8';

const INLINE_INPUT =
  'h-11 w-full min-w-0 border bg-transparent px-2 text-base outline-ring/50 focus-visible:outline-2 desk:h-8 desk:text-sm';

/**
 * A meeting's topics, on its page and in its panel: a checkbox (covered),
 * the title (click to edit), the outcome when there is one (muted; click
 * to edit), an Outcome button that opens a one-line input, and a menu
 * with Make a task, Record a decision, Move up / Move down and Delete
 * (Undo in the toast). Drag the handle to reorder with a mouse; touch and
 * keyboard move from the menu (or Alt+↑ / Alt+↓).
 *
 * The heading has the count and an Add topic button, as the Notes
 * section has Add note: the field shows only once it is pressed, stays
 * open for the next title after Enter, and Escape closes it. Every change
 * is an op at once.
 */
export function MeetingTopics({
  meeting,
  headingLevel = 3,
}: {
  meeting: Meeting;
  /** 2 on the meeting's page; 3 in its panel. */
  headingLevel?: 2 | 3;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { active } = useMotion();
  const topics = topicsOf(meeting);
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, active);
  const headingId = useId();
  const addRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [armedId, setArmedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const latest = useRef(state);
  latest.current = state;

  // What was there at first stays still; anything added later enters.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(topics.map((t) => t.id));

  const open = () => {
    if (adding) addRef.current?.focus();
    else setAdding(true);
  };
  const close = () => {
    setAdding(false);
    setDraft('');
    addButton.current?.focus();
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    if (actions.addTopic({ meetingId: meeting.id, title }) === null) return;
    setDraft('');
    setAnnouncement(`Added “${title}”`);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= topics.length || from === to) return;
    const topic = topics[from];
    if (!topic) return;
    const ids = moveItem(
      topics.map((t) => t.id),
      from,
      to,
    );
    if (actions.reorderTopics({ meetingId: meeting.id, ids })) {
      setAnnouncement(
        `Moved “${topic.title}” to position ${to + 1} of ${topics.length}`,
      );
    }
  };

  const remove = (topic: Topic) => {
    const before = topics.map((t) => t.id);
    if (!actions.deleteTopic({ meetingId: meeting.id, id: topic.id })) return;
    show(`Removed “${topic.title}”`, () => {
      const now = latest.current?.meetings[meeting.id];
      if (!now) return;
      const current = topicsOf(now).map((t) => t.id);
      const ops: BatchOps = [
        {
          type: 'addTopic',
          meetingId: meeting.id,
          id: topic.id,
          title: topic.title,
        },
      ];
      if (topic.outcome) {
        ops.push({
          type: 'editTopic',
          meetingId: meeting.id,
          id: topic.id,
          patch: { outcome: topic.outcome },
        });
      }
      if (topic.done) {
        ops.push({
          type: 'toggleTopic',
          meetingId: meeting.id,
          id: topic.id,
          done: true,
        });
      }
      const order = restoredOrder(before, current, topic.id);
      if (order[order.length - 1] !== topic.id) {
        ops.push({ type: 'reorderTopics', meetingId: meeting.id, ids: order });
      }
      actions.batch({ ops });
    });
  };

  const drop = () => {
    if (!dragId || overIndex === null) return;
    const from = topics.findIndex((t) => t.id === dragId);
    const to = from < 0 ? null : dropIndex(from, overIndex);
    if (to !== null) move(from, to);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2"
    >
      <TopicsHeading
        id={headingId}
        title={meeting.title}
        count={topicCount(topics)}
        adding={adding}
        onAdd={open}
        buttonRef={addButton}
        level={headingLevel}
      />
      {topics.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No topics yet</p>
      )}
      {topics.length > 0 && (
        <ul
          ref={list}
          aria-labelledby={headingId}
          className={cn(
            'flex min-w-0 flex-col',
            dragId && overIndex === topics.length && 'task-drop-end',
          )}
          onDragOver={
            dragId
              ? (event) => {
                  event.preventDefault();
                  if (event.target === event.currentTarget) {
                    setOverIndex(topics.length);
                  }
                }
              : undefined
          }
          onDrop={(event) => {
            event.preventDefault();
            drop();
          }}
        >
          {topics.map((topic, index) => (
            <li
              key={topic.id}
              data-flip-id={topic.id}
              data-topic-id={topic.id}
              draggable={armedId === topic.id}
              data-drop-before={
                dragId && overIndex === index && dragId !== topic.id
                  ? ''
                  : undefined
              }
              className={cn(
                'task-drop-target flex min-w-0 items-start border-l',
                !seen.current?.has(topic.id) && 'enter',
                dragId === topic.id && 'opacity-50',
              )}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', topic.id);
                setDragId(topic.id);
              }}
              onDragOver={
                dragId
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setOverIndex(index);
                    }
                  : undefined
              }
              onDragEnd={() => {
                setDragId(null);
                setArmedId(null);
                setOverIndex(null);
              }}
            >
              <TopicRow
                meeting={meeting}
                topic={topic}
                index={index}
                count={topics.length}
                onArm={() => setArmedId(topic.id)}
                onMove={(to) => move(index, to)}
                onRemove={() => remove(topic)}
              />
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <TopicInput
          ref={addRef}
          value={draft}
          label={`Add a topic to “${meeting.title}”`}
          autoFocus
          onChange={setDraft}
          onEnter={add}
          onEscape={close}
        />
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/**
 * The Topics heading in a meeting's panel: the count beside it and an
 * Add topic button, which stays put while the field is open (pressing it
 * again goes back to the field), as Add note does.
 */
function TopicsHeading({
  id,
  title,
  count,
  adding,
  onAdd,
  buttonRef,
  buttonId,
  describedBy,
  level = 3,
}: {
  id: string;
  /** The meeting's title, for the list's accessible name. */
  title: string;
  /** "1 of 3 topics", or `''`. */
  count: string;
  adding: boolean;
  onAdd: () => void;
  buttonRef: Ref<HTMLButtonElement>;
  buttonId?: string;
  describedBy?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-baseline gap-2">
        <Heading id={id} className="text-xs font-medium">
          Topics
          <span className="sr-only">{title ? ` for “${title}”` : ''}</span>
        </Heading>
        {count && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </span>
      <Button
        ref={buttonRef}
        id={buttonId}
        type="button"
        variant="outline"
        className="press h-11 desk:h-7"
        aria-expanded={adding}
        aria-describedby={describedBy}
        onClick={onAdd}
      >
        <PlusIcon />
        Add topic
      </Button>
    </div>
  );
}

/**
 * The one-line field a topic's title is typed into. Enter adds (and the
 * field stays for the next); Escape is `onEscape`'s (none: the panel's).
 */
function TopicInput({
  ref,
  value,
  label,
  autoFocus,
  onChange,
  onEnter,
  onEscape,
}: {
  ref?: Ref<HTMLInputElement>;
  value: string;
  label: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
  onEscape?: () => void;
}) {
  return (
    <input
      ref={ref}
      value={value}
      maxLength={LIMITS.titleMax}
      autoComplete="off"
      enterKeyHint="enter"
      placeholder="Add a topic"
      aria-label={label}
      // biome-ignore lint/a11y/noAutofocus: opened by Add topic.
      autoFocus={autoFocus}
      className={cn(
        INLINE_INPUT,
        'mt-1 border-dashed desk:max-w-md',
        // Opened on demand (the panel's): it enters.
        autoFocus && 'enter',
      )}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Escape' && onEscape) {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
      }}
    />
  );
}

/**
 * A new meeting's topics, in its panel: it has no id yet, so they wait
 * here and are saved with it (the form's batch). The same heading and
 * field as an existing meeting's; each Enter adds one, and each has a
 * Remove button. `existing` (the carried ones) counts toward the limit.
 */
export function PendingTopics({
  id,
  titles,
  onChange,
  existing,
  error,
}: {
  /** The Add topic button's, for the form to focus on a problem. */
  id: string;
  titles: string[];
  onChange: (titles: string[]) => void;
  existing: number;
  /** The form's, from Save. */
  error?: string;
}) {
  const headingId = useId();
  const errorId = useId();
  const addRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [full, setFull] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const problem = full ?? error;

  const close = () => {
    setAdding(false);
    setDraft('');
    setFull(null);
    addButton.current?.focus();
  };
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    if (existing + titles.length >= LIMITS.topicsMax) {
      setFull(`A meeting has ${LIMITS.topicsMax} topics at most`);
      return;
    }
    onChange([...titles, title]);
    setDraft('');
    setAnnouncement(`Added “${title}”`);
  };
  const remove = (index: number) => {
    const title = titles[index];
    onChange(titles.filter((_, i) => i !== index));
    setFull(null);
    setAnnouncement(`Removed “${title}”`);
    addButton.current?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2"
    >
      <TopicsHeading
        id={headingId}
        title=""
        count={titles.length > 0 ? `${titles.length} to add` : ''}
        adding={adding}
        onAdd={() => {
          if (adding) addRef.current?.focus();
          else setAdding(true);
        }}
        buttonRef={addButton}
        buttonId={id}
        describedBy={problem ? errorId : undefined}
      />
      {titles.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No topics yet</p>
      )}
      {titles.length > 0 && (
        <ul aria-labelledby={headingId} className="flex min-w-0 flex-col">
          {titles.map((title, index) => (
            <li
              // Titles may repeat; the list only grows at the end or loses one.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={`${index}:${title}`}
              data-pending-topic
              className="enter flex min-w-0 items-center border-l pl-3 text-sm"
            >
              <span className="min-w-0 flex-1 py-1 break-words">{title}</span>
              <button
                type="button"
                aria-label={`Remove “${title}”`}
                className={ICON_BUTTON}
                onClick={() => remove(index)}
              >
                <XIcon aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <TopicInput
          ref={addRef}
          value={draft}
          label="Add a topic"
          autoFocus
          onChange={(value) => {
            setDraft(value);
            setFull(null);
          }}
          onEnter={add}
          onEscape={close}
        />
      )}
      {problem && (
        <p id={errorId} className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/** One topic: its checkbox, title and outcome, editable in place. */
function TopicRow({
  meeting,
  topic,
  index,
  count,
  onArm,
  onMove,
  onRemove,
}: {
  meeting: Meeting;
  topic: Topic;
  index: number;
  count: number;
  /** A mouse pressed the handle: the row may be dragged. */
  onArm: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { state, actions } = useDatapad();
  const { newTask } = useTaskPanels();
  const { newDecision } = useDecisionPanel();
  const today = useToday();
  const [editing, setEditing] = useState<'title' | 'outcome' | null>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const outcomeButton = useRef<HTMLButtonElement>(null);
  /** Enter or Escape closed the input: its blur, as it goes, is not a save. */
  const closed = useRef(false);

  /**
   * Close the input, saving `value` (null: Escape, keep what was there).
   * From the keyboard, the focus goes back to what opened it.
   */
  const finish = (
    field: 'title' | 'outcome',
    value: string | null,
    keyboard: boolean,
  ) => {
    if (closed.current) return;
    closed.current = keyboard;
    setEditing(null);
    if (keyboard) {
      requestAnimationFrame(() => {
        closed.current = false;
        (field === 'title' ? titleButton : outcomeButton).current?.focus();
      });
    }
    if (value === null) return;
    const text = value.trim();
    if (text === topic[field] || (field === 'title' && !text)) return;
    actions.editTopic({
      meetingId: meeting.id,
      id: topic.id,
      patch: field === 'title' ? { title: text } : { outcome: text },
    });
  };
  const keys =
    (field: 'title' | 'outcome') =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        finish(field, e.currentTarget.value, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(field, null, true);
      }
    };

  const deciders = meeting.attendees.filter((id) => state?.people[id]);

  return (
    <div className="flex min-w-0 flex-1 items-start text-sm">
      <span
        aria-hidden
        title="Drag to reorder"
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') onArm();
        }}
        className="hidden h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing desk:flex hover-none:hidden"
      >
        <DotsSixVerticalIcon weight="bold" />
      </span>
      <label className="press group/check flex size-11 shrink-0 cursor-pointer items-center justify-center has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-ring desk:size-8">
        <input
          type="checkbox"
          checked={topic.done}
          onChange={(e) =>
            actions.toggleTopic({
              meetingId: meeting.id,
              id: topic.id,
              done: e.target.checked,
            })
          }
          aria-label={`Covered: “${topic.title}”`}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'task-check flex size-4 items-center justify-center border-[1.5px] border-muted-foreground/70 group-hover/check:border-foreground',
            topic.done && 'is-done border-ok bg-ok text-ok-foreground',
          )}
        >
          <CheckIcon weight="bold" className="task-check-mark size-3" />
        </span>
      </label>
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        {editing === 'title' ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by a click on the title.
            autoFocus
            defaultValue={topic.title}
            maxLength={LIMITS.titleMax}
            autoComplete="off"
            enterKeyHint="done"
            aria-label={`Title of “${topic.title}”`}
            className={INLINE_INPUT}
            onKeyDown={keys('title')}
            onBlur={(e) => finish('title', e.currentTarget.value, false)}
          />
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <button
              type="button"
              data-topic-title
              onClick={() => setEditing('title')}
              className={cn(
                'flex min-h-11 min-w-0 items-center text-left break-words outline-ring/50 focus-visible:outline-2 desk:min-h-7',
                topic.done && 'text-muted-foreground',
              )}
              ref={titleButton}
              aria-label={`${topic.title}, edit`}
            >
              <span className="min-w-0">{topic.title}</span>
            </button>
            {topic.carriedFrom && (
              <span
                data-topic-carried
                className="text-xs whitespace-nowrap text-muted-foreground"
              >
                <span className="sr-only">carried forward </span>from{' '}
                {formatDay(topic.carriedFrom, today)}
              </span>
            )}
          </span>
        )}
        {editing === 'outcome' ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by Outcome.
            autoFocus
            defaultValue={topic.outcome}
            maxLength={LIMITS.topicOutcomeMax}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="What came of it"
            aria-label={`Outcome of “${topic.title}”`}
            className={cn(INLINE_INPUT, 'mb-1')}
            onKeyDown={keys('outcome')}
            onBlur={(e) => finish('outcome', e.currentTarget.value, false)}
          />
        ) : (
          topic.outcome && (
            <button
              type="button"
              data-topic-outcome
              onClick={() => setEditing('outcome')}
              className="flex min-h-11 min-w-0 items-center pb-1 text-left text-xs break-words text-muted-foreground outline-ring/50 focus-visible:outline-2 desk:min-h-6"
              aria-label={`Outcome: ${topic.outcome}, edit`}
            >
              {topic.outcome}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        ref={outcomeButton}
        onClick={() => setEditing('outcome')}
        aria-label={`Outcome for “${topic.title}”`}
        className={cn(ICON_BUTTON, '@xl/row:w-auto @xl/row:gap-1 @xl/row:px-2')}
      >
        <ChatTextIcon aria-hidden />
        <span aria-hidden className="hidden text-xs @xl/row:inline">
          Outcome
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={ICON_BUTTON}
          aria-label={`More for topic “${topic.title}”`}
        >
          <DotsThreeIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => newTask(meeting.projectId, { title: topic.title })}
          >
            <CheckSquareOffsetIcon />
            Make a task
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              newDecision(meeting.projectId, topic.title, deciders)
            }
          >
            <GavelIcon />
            Record a decision
          </DropdownMenuItem>
          {count > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={index === 0}
                onClick={() => onMove(index - 1)}
              >
                <ArrowUpIcon />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              >
                <ArrowDownIcon />
                Move down
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
