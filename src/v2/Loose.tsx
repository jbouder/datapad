/**
 * Prototype: Loose, what Notepad becomes. One running pad, newest block on
 * top. Each block is a note with no home; file it to a project, make it a
 * task, or leave it. Checklists in a block tick in place, which is how
 * Lists fold into notes.
 */
import { useState } from 'react';
import { formatTimestamp, relativeTime } from '#shared/dates';
import { toggleCheck } from '#shared/markdown';
import { notepadOf, taskTitleFrom } from '#shared/notes';
import type { Note } from '#shared/types';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { useClock } from '@/hooks/useClock';
import { useDatapad } from '@/hooks/useDatapad';
import { useNow } from '@/hooks/useNow';
import { useToast } from '@/providers/ToastProvider';
import { looseNotes } from './model';
import { RoomHeader } from './parts';

export function Loose() {
  const { state, actions } = useDatapad();
  const [draft, setDraft] = useState('');
  if (!state) return null;
  const blocks = looseNotes(state);
  const pad = notepadOf(state.notes);

  const save = () => {
    const body = draft.trim();
    if (!body) return;
    if (actions.addNote({ projectId: null, body })) setDraft('');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <RoomHeader
        title="Loose"
        state="Everything with no home yet. Write first, file later."
      />
      <div className="mb-6 border border-border focus-within:border-ring">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          rows={4}
          placeholder="Start typing. ⌘Enter makes it a block. - [ ] makes a checklist."
          aria-label="New block"
          className="block w-full resize-y bg-transparent p-3 text-base outline-none placeholder:text-muted-foreground desk:text-sm"
        />
        <div className="flex justify-end border-border border-t p-1.5">
          <Button size="sm" onClick={save} disabled={!draft.trim()}>
            Add block
          </Button>
        </div>
      </div>
      {blocks.length === 0 && !pad?.body && (
        <p className="text-muted-foreground text-sm">Nothing loose. Nice.</p>
      )}
      <ol className="flex flex-col gap-3">
        {blocks.map((note) => (
          <Block key={note.id} note={note} />
        ))}
      </ol>
      {pad?.body && (
        <section className="mt-8" aria-label="Old Notepad">
          <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wider">
            Your Notepad, as it was
          </p>
          <div className="border border-border border-dashed p-3">
            <Markdown text={pad.body} people={state.people} />
          </div>
        </section>
      )}
    </div>
  );
}

function Block({ note }: { note: Note }) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const clock = useClock();
  const now = useNow();
  const [filing, setFiling] = useState(false);
  if (!state) return null;
  const projects = Object.values(state.projects)
    .filter((p) => !p.archived && p.status !== 'done')
    .sort((a, b) => a.name.localeCompare(b.name));

  const file = (projectId: string) => {
    const id = actions.addNote({ projectId, body: note.body });
    if (id) {
      actions.deleteNote({ id: note.id });
      show(`Filed to ${state.projects[projectId]?.name}`);
    }
  };

  const makeTask = () => {
    const title = taskTitleFrom(note.body, state.people).slice(0, 200);
    if (actions.addTask({ projectId: null, title, sourceNoteId: note.id })) {
      show('Made a task. The block stays.');
    }
  };

  return (
    <li className="border border-border p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className="text-muted-foreground text-xs"
          title={formatTimestamp(note.createdAt, clock)}
        >
          {relativeTime(note.createdAt, new Date(now))}
        </span>
      </div>
      <Markdown
        text={note.body}
        people={state.people}
        onToggle={(line) =>
          actions.editNote({ id: note.id, body: toggleCheck(note.body, line) })
        }
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {filing ? (
          <select
            ref={(el) => el?.focus()}
            aria-label="File to project"
            defaultValue=""
            onChange={(e) => e.target.value && file(e.target.value)}
            onBlur={() => setFiling(false)}
            className="h-11 border border-border bg-background px-2 text-sm desk:h-7 desk:text-xs"
          >
            <option value="" disabled>
              File to…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setFiling(true)}>
            File to project
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={makeTask}>
          Make task
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => actions.deleteNote({ id: note.id })}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
