import { TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { listProject } from '#shared/lists';
import { DetailActions } from '@/components/DetailActions';
import { ListItems } from '@/components/lists/ListItems';
import { ProjectChip, progressText } from '@/components/lists/ListLayouts';
import { useListPanel } from '@/components/lists/ListPanel';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps, navigate } from '@/lib/router';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useToast } from '@/providers/ToastProvider';

/**
 * One list (#299), where its items are ticked: the header with its
 * project (or General), progress and actions (Edit in the panel; under
 * More, Delete, which asks first in place and offers Undo), then the
 * items. One column at every width.
 */
export function ListPage({ id }: { id: string }) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const { openPanel, panel } = useListPanel();
  const list = state?.lists[id];
  usePageTitle(list?.title ?? (state ? 'Not found' : 'List'));
  const [confirming, setConfirming] = useState(false);
  /** Deleted just now: on the way to Lists. */
  const [leaving, setLeaving] = useState(false);

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!list && leaving) return null;
  if (!list) {
    return (
      <NotFoundPage
        what="list"
        back={{ name: 'lists' }}
        backLabel="Back to Lists"
      />
    );
  }

  const project = listProject(list, state.projects);
  const count = list.items.length;

  const remove = () => {
    const gone = list;
    setLeaving(true);
    if (!actions.deleteList({ id: gone.id })) {
      setLeaving(false);
      return;
    }
    navigate({ name: 'lists' }, { replace: true });
    // Undo puts the list back as it was, items and all.
    show(`Deleted “${gone.title}”`, () => {
      actions.put({ col: 'lists', doc: gone });
    });
  };

  return (
    <article
      aria-labelledby="list-page-title"
      className="enter flex max-w-3xl flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {project ? (
            <a
              {...linkProps({ name: 'project', id: project.id })}
              className="min-w-0 max-w-full hover:bg-accent hover:text-foreground"
            >
              <ProjectChip project={project} className="block" />
            </a>
          ) : (
            <ProjectChip project={null} />
          )}
          <span data-list-progress className="tabular-nums">
            {progressText(list)}
          </span>
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <h1
            id="list-page-title"
            className="text-page-title min-w-0 flex-1 basis-full break-words desk:basis-0"
          >
            {list.title}
          </h1>
          <DetailActions
            onEdit={() => openPanel({ kind: 'edit', list })}
            menu={[
              {
                label: 'Delete',
                icon: <TrashIcon />,
                onSelect: () => setConfirming(true),
                destructive: true,
              },
            ]}
          />
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-labelledby="list-page-delete"
            className="flex flex-wrap items-center gap-2 bg-muted px-2 py-2"
          >
            <p id="list-page-delete" className="flex-1 text-sm">
              {count === 0
                ? `Delete “${list.title}”?`
                : `Delete “${list.title}” and its ${count === 1 ? 'item' : `${count} items`}?`}
            </p>
            <Button
              type="button"
              variant="outline"
              className="press h-11 desk:h-8"
              autoFocus
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="press h-11 desk:h-8"
              onClick={remove}
            >
              Delete list
            </Button>
          </div>
        )}
      </header>

      <ListItems list={list} />
      {panel}
    </article>
  );
}
