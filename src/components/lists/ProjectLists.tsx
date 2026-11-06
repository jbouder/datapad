import { PlusIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { isListDone, previewItems, projectLists } from '#shared/lists';
import type { List } from '#shared/types';
import { progressText } from '@/components/lists/ListLayouts';
import { useListPanel } from '@/components/lists/ListPanelProvider';
import { type RememberSection, Section } from '@/components/Section';
import { Button } from '@/components/ui/button';
import { linkProps } from '@/lib/router';
import { cn } from '@/lib/utils';

/**
 * A project's lists on its page (#301), in the right column under Notes: a
 * row per list (its title opening its page, its progress and its first
 * open item), the ones in progress first and the done ones last and
 * muted. Add list opens the list panel preset to the project. Rows only:
 * the items stay on the list's page.
 */
export function ProjectLists({
  projectId,
  lists,
  remember,
}: {
  projectId: string;
  lists: Record<string, List>;
  remember: RememberSection;
}) {
  const { openPanel } = useListPanel();
  const rows = useMemo(
    () => projectLists(lists, projectId),
    [lists, projectId],
  );
  const inProgress = rows.filter((l) => !isListDone(l)).length;

  return (
    <Section
      title="Lists"
      count={inProgress}
      remember={remember}
      actions={
        <Button
          variant="outline"
          className="press h-11 desk:h-8"
          onClick={() => openPanel({ kind: 'new', projectId })}
        >
          <PlusIcon />
          Add list
        </Button>
      }
    >
      <div className="pt-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lists yet</p>
        ) : (
          <ul aria-label="Lists" className="flex flex-col">
            {rows.map((list) => {
              const done = isListDone(list);
              const next = previewItems(list, 1)[0];
              return (
                <li
                  key={list.id}
                  data-list-id={list.id}
                  data-done={done || undefined}
                  className={cn(
                    'flex min-w-0 items-start gap-3 border-b py-1.5 text-sm last:border-b-0',
                    done && 'text-muted-foreground',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <a
                      {...linkProps({ name: 'list', id: list.id })}
                      className="flex min-h-11 min-w-0 items-center break-words outline-ring/50 hover:underline focus-visible:outline-2 desk:min-h-7"
                    >
                      {list.title}
                    </a>
                    {next && (
                      <span className="truncate text-xs text-muted-foreground">
                        {next.text}
                      </span>
                    )}
                  </span>
                  <span
                    data-list-progress
                    className="flex min-h-11 shrink-0 items-center text-xs text-muted-foreground tabular-nums desk:min-h-7"
                  >
                    {progressText(list)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
