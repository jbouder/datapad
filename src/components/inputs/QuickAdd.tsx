import { PlusIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { Input } from '@/components/ui/input';
import { QUICK_ADD_ID, takeQuickAddFocus } from '@/lib/quickAdd';
import { cn } from '@/lib/utils';

/**
 * One line, a + glyph, Enter adds and keeps focus; Esc clears; an empty
 * Enter does nothing. With `onProjectChange`, a project picker sits beside
 * it (Focus, Tasks); without, the list it belongs to decides (a project).
 * The page's main quick-add takes `QUICK_ADD_ID`, which `n` and + focus.
 */
export function QuickAdd({
  onAdd,
  label = 'Add a task',
  projectId,
  onProjectChange,
  main = true,
  className,
}: {
  /** Return false to keep the text (the add was refused). */
  onAdd: (title: string) => boolean;
  label?: string;
  projectId?: string | null;
  onProjectChange?: (projectId: string | null) => void;
  /** The page's main quick-add (the one `n` focuses). */
  main?: boolean;
  className?: string;
}) {
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const id = main ? QUICK_ADD_ID : undefined;

  const add = () => {
    if (!title.trim()) return;
    if (onAdd(title)) setTitle('');
    input.current?.focus();
  };

  useEffect(() => {
    if (main && takeQuickAddFocus()) input.current?.focus();
  }, [main]);

  return (
    <form
      className={cn('flex flex-col gap-1 desk:flex-row', className)}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="relative flex-1">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <PlusIcon
          weight="bold"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          id={id}
          aria-label={id ? undefined : label}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // With the project picker the form has two fields and no submit
            // button, so the browser would not submit on Enter by itself.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
              return;
            }
            if (e.key === 'Escape' && title) {
              e.preventDefault();
              e.stopPropagation();
              setTitle('');
            }
          }}
          placeholder={label}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 pl-8 text-base desk:h-9 desk:text-sm"
        />
      </div>
      {onProjectChange && (
        <ProjectPicker
          aria-label="Project for new tasks"
          value={projectId ?? null}
          onChange={onProjectChange}
          className="desk:w-56"
        />
      )}
    </form>
  );
}
