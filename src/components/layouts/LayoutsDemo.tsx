import {
  CalendarBlankIcon,
  ChartBarHorizontalIcon,
  KanbanIcon,
  SquaresFourIcon,
  TableIcon,
} from '@phosphor-icons/react';
import { useCallback, useMemo, useState } from 'react';
import { localDate } from '#shared/dates';
import { milestonesOf, type Task } from '#shared/types';
import { Board } from '@/components/layouts/Board';
import { Calendar } from '@/components/layouts/Calendar';
import { CardGrid } from '@/components/layouts/CardGrid';
import { DataTable, type TableSort } from '@/components/layouts/DataTable';
import { Timeline } from '@/components/layouts/Timeline';
import { useView, ViewSwitcher } from '@/components/layouts/ViewSwitcher';
import { PriorityDot } from '@/components/PriorityDot';
import { DueDate } from '@/components/tasks/DueDate';
import { useDatapad } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

const VIEWS = [
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'cards', label: 'Cards', icon: SquaresFourIcon },
  { id: 'board', label: 'Board', icon: KanbanIcon },
  { id: 'timeline', label: 'Timeline', icon: ChartBarHorizontalIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarBlankIcon },
] as const;
type DemoView = (typeof VIEWS)[number]['id'];

/** Every layout primitive over the same items (dev page only). */
export function LayoutsDemo() {
  const { state } = useDatapad();
  const { show } = useToast();
  const [view, setView] = useView<DemoView>('dev', VIEWS, 'table');
  const [sort, setSort] = useState<TableSort>({ column: 'title', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const today = localDate(new Date());

  const tasks = useMemo(() => {
    const list = Object.values(state?.tasks ?? {});
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) =>
      sort.column === 'due'
        ? dir * (a.due || '9999').localeCompare(b.due || '9999')
        : dir * a.title.localeCompare(b.title),
    );
  }, [state?.tasks, sort]);
  const projects = useMemo(() => state?.projects ?? {}, [state?.projects]);
  const name = useCallback(
    (t: Task) =>
      t.projectId ? (projects[t.projectId]?.name ?? 'General') : 'General',
    [projects],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) map.set(name(t), [...(map.get(name(t)) ?? []), t]);
    return [...map.entries()].map(([label, rows]) => ({
      id: label,
      label,
      rows,
    }));
  }, [tasks, name]);

  if (!state) return null;
  return (
    <section
      id="layouts"
      aria-labelledby="layouts-title"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <h2
          id="layouts-title"
          className="flex-1 font-heading text-lg font-semibold"
        >
          Layouts
        </h2>
        <ViewSwitcher views={VIEWS} value={view} onChange={setView} />
      </div>
      {view === 'table' && (
        <DataTable<Task>
          label="Tasks"
          groups={groups}
          getId={(t) => t.id}
          rowLabel={(t) => t.title}
          sort={sort}
          onSort={(column) =>
            setSort((s) => ({
              column,
              dir: s.column === column && s.dir === 'asc' ? 'desc' : 'asc',
            }))
          }
          selection={{
            selected,
            toggle: (id) =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            toggleGroup: (ids) =>
              setSelected((s) => {
                const all = ids.every((id) => s.has(id));
                const next = new Set(s);
                for (const id of ids) {
                  if (all) next.delete(id);
                  else next.add(id);
                }
                return next;
              }),
          }}
          onOpen={(t) => show(`Would open “${t.title}”`)}
          columns={[
            {
              id: 'title',
              header: 'Title',
              sortable: true,
              cell: (t) => t.title,
            },
            {
              id: 'priority',
              header: 'Priority',
              cell: (t) => <PriorityDot priority={t.priority} />,
            },
            {
              id: 'due',
              header: 'Due',
              sortable: true,
              cell: (t) =>
                t.due ? <DueDate due={t.due} today={today} /> : null,
            },
          ]}
          mobileRow={(t) => (
            <div className="row flex items-center gap-2 border-b px-1 text-sm">
              <PriorityDot priority={t.priority} />
              <span className="flex-1 truncate">{t.title}</span>
            </div>
          )}
        />
      )}
      {view === 'cards' && (
        <CardGrid
          label="Tasks"
          items={tasks}
          getId={(t) => t.id}
          renderCard={(t) => (
            <div className="flex flex-col gap-1 border bg-card p-3 text-sm">
              <span className="text-xs text-muted-foreground">{name(t)}</span>
              <span className="font-medium">{t.title}</span>
            </div>
          )}
        />
      )}
      {view === 'board' && (
        <Board<Task>
          label="Tasks by status"
          getId={(t) => t.id}
          itemLabel={(t) => t.title}
          columns={[
            {
              id: 'open',
              title: 'Open',
              items: tasks.filter((t) => t.status === 'open'),
            },
            {
              id: 'done',
              title: 'Done',
              items: tasks.filter((t) => t.status === 'done'),
            },
          ]}
          renderCard={(t) => <div className="p-3 pr-10 text-sm">{t.title}</div>}
          onMove={(t, _from, to) => show(`Would move “${t.title}” to ${to}`)}
        />
      )}
      {view === 'timeline' && (
        <Timeline
          label="Projects over time"
          rows={Object.values(projects).map((p) => ({
            id: p.id,
            label: p.name,
            start: p.createdAt.slice(0, 10),
            end: p.targetDate || undefined,
            open: !p.targetDate,
            points: milestonesOf(p).map((m) => ({
              id: m.id,
              date: m.date,
              label: m.title,
              kind: 'milestone' as const,
            })),
          }))}
          onOpenRow={(id) => show(`Would open ${projects[id]?.name}`)}
          onOpenPoint={(r, id) =>
            show(
              `Would open ${milestonesOf(projects[r] ?? {}).find((m) => m.id === id)?.title}`,
            )
          }
        />
      )}
      {view === 'calendar' && (
        <Calendar
          label="Events"
          items={Object.values(state.meetings).map((e) => ({
            id: e.id,
            date: e.date,
            time: e.time,
            label: e.title,
          }))}
          onOpen={(id) => show(`Would open ${state.meetings[id]?.title}`)}
        />
      )}
    </section>
  );
}
