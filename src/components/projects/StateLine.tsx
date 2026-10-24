import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Project } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The project's one-line current state, edited in place. Enter blurs, Esc
 * puts it back, and blur saves only when it changed ("Updated current
 * state"). While you are typing, a sync from elsewhere does not overwrite
 * the text; it shows once you leave the field.
 */
export function StateLine({ project }: { project: Project }) {
  const { actions } = useDatapad();
  const [text, setText] = useState(project.state);
  const editing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing.current) setText(project.state);
  }, [project.state]);

  const save = () => {
    editing.current = false;
    const next = text.trim();
    if (next === project.state) {
      setText(project.state);
      return;
    }
    if (!actions.setState({ id: project.id, state: next })) {
      setText(project.state);
    }
  };

  return (
    <div className="flex flex-col">
      <label htmlFor="state-line" className="sr-only">
        Current state
      </label>
      <input
        ref={input}
        id="state-line"
        value={text}
        maxLength={LIMITS.stateMax}
        placeholder="What’s the current state?"
        autoComplete="off"
        enterKeyHint="done"
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText(project.state);
            editing.current = false;
            // Blur without saving: the text is already back.
            requestAnimationFrame(() => input.current?.blur());
          }
        }}
        className="text-state-lg -mx-2 w-[calc(100%+1rem)] border border-transparent bg-transparent px-2 py-1 outline-none placeholder:text-muted-foreground/60 hover:border-border focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
      />
    </div>
  );
}
