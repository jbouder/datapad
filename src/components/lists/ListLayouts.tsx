import { SquaresFourIcon, TableIcon } from '@phosphor-icons/react';
import { relativeTime } from '#shared/dates';
import {
  isListDone,
  type ListSort,
  listCounts,
  listProgress,
  listProject,
  previewItems,
} from '#shared/lists';
import type { List, Project } from '#shared/types';
import { CardGrid } from '@/components/layouts/CardGrid';
import { DataTable } from '@/components/layouts/DataTable';
import type { ViewOption } from '@/components/layouts/ViewSwitcher';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

export type ListView = 'cards' | 'table';

export const LIST_VIEWS: readonly ViewOption<ListView>[] = [
  { id: 'cards', label: 'Cards', icon: SquaresFourIcon },
  { id: 'table', label: 'Table', icon: TableIcon },
];

/** The table's columns that sort the way Sort does. */
const SORTABLE: Record<string, ListSort> = {
  title: 'title',
  created: 'created',
  updated: 'updated',
};

/** "3 of 8", "Done" once every item is, or "No items". */
export function progressText(list: List): string {
  if (list.items.length === 0) return 'No items';
  return isListDone(list) ? 'Done' : listProgress(list);
}

/** A list's project as a chip: its name, or General (dashed). */
export function ProjectChip({
  project,
  className,
}: {
  project: Project | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'max-w-full truncate border px-1.5 py-0.5',
        !project && 'border-dashed',
        className,
      )}
    >
      <span className="sr-only">Project: </span>
      {project
        ? `${project.name}${project.archived ? ' (archived)' : ''}`
        : 'General'}
    </span>
  );
}

const open = (id: string) => navigate({ name: 'list', id });

/**
 * The lists as Cards or a Table (#299), in the page's order. A card is a
 * link to the list's page: its title, project (or General), progress and
 * the first few open items. Below 820px the table is rows.
 */
export function ListLayouts({
  view,
  lists,
  projects,
  sort,
  onSort,
}: {
  view: ListView;
  lists: List[];
  projects: Record<string, Project>;
  sort: ListSort;
  onSort: (sort: ListSort) => void;
}) {
  if (view === 'cards') {
    return (
      <CardGrid
        label="Lists"
        items={lists}
        getId={(l) => l.id}
        renderCard={(l) => (
          <ListCard list={l} project={listProject(l, projects)} />
        )}
      />
    );
  }
  const now = new Date();
  return (
    <DataTable<List>
      label="Lists"
      groups={[{ id: 'all', label: '', rows: lists }]}
      getId={(l) => l.id}
      rowLabel={(l) => l.title}
      sort={{
        column: Object.entries(SORTABLE).find(([, s]) => s === sort)?.[0] ?? '',
        // Each sort has one natural direction: A–Z, newest first.
        dir: sort === 'title' ? 'asc' : 'desc',
      }}
      onSort={(column) => {
        const s = SORTABLE[column];
        if (s) onSort(s);
      }}
      onOpen={(l) => open(l.id)}
      columns={[
        {
          id: 'title',
          header: 'Title',
          sortable: true,
          cell: (l) => (
            <a
              {...linkProps({ name: 'list', id: l.id })}
              className="font-medium outline-ring/50 hover:underline focus-visible:outline-2"
            >
              {l.title}
            </a>
          ),
        },
        {
          id: 'project',
          header: 'Project',
          cell: (l) => (
            <span className="text-muted-foreground">
              {listProject(l, projects)?.name ?? 'General'}
            </span>
          ),
        },
        {
          id: 'progress',
          header: 'Progress',
          className: 'whitespace-nowrap tabular-nums',
          cell: (l) => progressText(l),
        },
        {
          id: 'created',
          header: 'Created',
          sortable: true,
          className: 'whitespace-nowrap text-xs text-muted-foreground',
          cell: (l) => relativeTime(l.createdAt, now),
        },
        {
          id: 'updated',
          header: 'Updated',
          sortable: true,
          className: 'whitespace-nowrap text-xs text-muted-foreground',
          cell: (l) => relativeTime(l.updatedAt, now),
        },
      ]}
      mobileRow={(l) => (
        <a
          {...linkProps({ name: 'list', id: l.id })}
          className="row flex items-center gap-2 border-b px-1 text-sm"
        >
          <span className="min-w-0 flex-1 truncate font-medium">{l.title}</span>
          <span className="max-w-[40%] truncate text-xs text-muted-foreground">
            {listProject(l, projects)?.name ?? 'General'}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {progressText(l)}
          </span>
        </a>
      )}
    />
  );
}

/** One list as a card, the whole card a link to its page. */
function ListCard({ list, project }: { list: List; project: Project | null }) {
  const preview = previewItems(list);
  const { done, total } = listCounts(list);
  const more = total - done - preview.length;
  return (
    <a
      {...linkProps({ name: 'list', id: list.id })}
      data-list-card={list.id}
      className="press group flex min-h-36 flex-col gap-2 border bg-card p-4 text-card-foreground outline-ring/50 hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ProjectChip project={project} className="min-w-0" />
        <span className="ml-auto shrink-0 tabular-nums">
          {progressText(list)}
        </span>
      </div>
      <h2 className="text-card-name break-words group-hover:underline group-hover:underline-offset-4">
        {list.title}
      </h2>
      {preview.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {preview.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 border border-muted-foreground/70"
              />
              <span className="min-w-0 truncate">{item.text}</span>
            </li>
          ))}
          {more > 0 && (
            <li className="text-xs tabular-nums">{more} more open</li>
          )}
        </ul>
      )}
    </a>
  );
}
