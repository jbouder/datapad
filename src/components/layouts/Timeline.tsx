import { useMemo, useRef, useState } from 'react';
import { addDays, formatDay, localDate } from '#shared/dates';
import type { DateString } from '#shared/types';
import { Segmented } from '@/components/inputs/Segmented';
import { cn } from '@/lib/utils';

export interface TimelinePoint {
  id: string;
  date: DateString;
  label: string;
  /** Milestones and deadlines read differently (filled / outlined). */
  kind?: 'milestone' | 'deadline' | 'task';
}

export interface TimelineRow {
  id: string;
  label: string;
  /** The bar; either end may be missing. */
  start?: DateString;
  end?: DateString;
  /** No real end: draw the bar dashed. */
  open?: boolean;
  /** Points only (tasks): no bar from the first to the last. */
  noBar?: boolean;
  points: TimelinePoint[];
}

export type Zoom = 'week' | 'month' | 'quarter';

const DAY_PX: Record<Zoom, number> = { week: 36, month: 10, quarter: 3.5 };
const LANE_LABEL = 'w-(--lane)';

function days(from: DateString, to: DateString): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Month starts (or Mondays, zoomed in) across the range, for the scale. */
function ticks(from: DateString, to: DateString, zoom: Zoom): DateString[] {
  const out: DateString[] = [];
  if (zoom === 'week') {
    let d = from;
    while (d <= to) {
      out.push(d);
      d = addDays(d, 7);
    }
    return out;
  }
  let [y, m] = from.split('-').map(Number) as [number, number];
  while (true) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d > to) break;
    if (d >= from) out.push(d);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Rows on a time axis: a bar from start to end (dashed when it has no real
 * end) and points for dated things on it, with a line for today. Zoom by
 * week, month or quarter; scrolls sideways inside its own box. The visual
 * is hidden from assistive tech; the same rows are listed for it (and that
 * list appears when it gets keyboard focus).
 */
export function Timeline({
  label,
  rows,
  onOpenRow,
  onOpenPoint,
  onMovePoint,
  onDropItem,
  defaultZoom = 'month',
}: {
  label: string;
  rows: TimelineRow[];
  onOpenRow?: (id: string) => void;
  onOpenPoint?: (rowId: string, pointId: string) => void;
  /** Dragging a point sideways moves it to another day. */
  onMovePoint?: (rowId: string, pointId: string, date: DateString) => void;
  /**
   * Something dragged in from outside (an undated tray item, carrying its
   * id as `text/plain`) dropped on a lane at a day.
   */
  onDropItem?: (itemId: string, rowId: string, date: DateString) => void;
  defaultZoom?: Zoom;
}) {
  const [zoom, setZoom] = useState<Zoom>(defaultZoom);
  /** The point being dragged and how far, in days. */
  const [dragging, setDragging] = useState<{
    rowId: string;
    pointId: string;
    startX: number;
    days: number;
  } | null>(null);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const moved = useRef(false);
  const today = localDate(new Date());

  const range = useMemo(() => {
    const all = [today];
    for (const r of rows) {
      if (r.start) all.push(r.start);
      if (r.end) all.push(r.end);
      for (const p of r.points) all.push(p.date);
    }
    all.sort();
    const first = all[0] ?? today;
    const last = all[all.length - 1] ?? today;
    // A margin either side, and never more than 18 months.
    const from = addDays(first, -7);
    const to =
      days(from, addDays(last, 14)) > 550
        ? addDays(from, 550)
        : addDays(last, 14);
    return { from, to, width: days(from, to) };
  }, [rows, today]);

  const px = DAY_PX[zoom];
  const x = (d: DateString) => Math.max(0, days(range.from, d)) * px;
  /** The day under a horizontal offset inside a lane. */
  const dayAt = (offset: number) =>
    addDays(range.from, Math.max(0, Math.round(offset / px)));
  const width = range.width * px;

  return (
    <section
      aria-label={label}
      className="vt-list relative flex flex-col gap-2"
    >
      <Segmented
        legend="Zoom"
        legendHidden
        value={zoom}
        onChange={setZoom}
        className="w-60 self-end"
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
        ]}
      />

      {/* For assistive tech (and visible when it has keyboard focus). */}
      <ul
        aria-label={`${label}, as a list`}
        className="sr-only flex-col gap-1 border p-2 text-sm focus-within:not-sr-only focus-within:flex"
      >
        {rows.map((r) => (
          <li key={r.id}>
            {onOpenRow ? (
              <button
                type="button"
                className="underline"
                onClick={() => onOpenRow(r.id)}
              >
                {r.label}
              </button>
            ) : (
              r.label
            )}
            {r.start && `, from ${formatDay(r.start, today)}`}
            {r.end && `, to ${formatDay(r.end, today)}`}
            {r.points.length > 0 && (
              <ul className="ml-4">
                {r.points.map((p) => (
                  <li key={p.id}>
                    {onOpenPoint ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => onOpenPoint(r.id, p.id)}
                      >
                        {p.label}
                      </button>
                    ) : (
                      p.label
                    )}
                    , {formatDay(p.date, today)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div
        aria-hidden
        className="overflow-x-auto border [--lane:9rem] desk:[--lane:12rem]"
      >
        <div
          className="relative"
          style={{ width: `calc(${width}px + var(--lane))` }}
        >
          <div className="sticky top-0 flex h-7 border-b bg-background text-[11px] text-muted-foreground">
            <div className={cn('shrink-0 border-r', LANE_LABEL)} />
            <div className="relative flex-1">
              {ticks(range.from, range.to, zoom).map((d) => (
                <span
                  key={d}
                  className="absolute top-1.5 border-l pl-1 whitespace-nowrap"
                  style={{ left: x(d) }}
                >
                  {formatDay(d, today).replace(/^\w+ /, '')}
                </span>
              ))}
            </div>
          </div>
          {rows.map((r) => {
            const start = r.start ?? r.end ?? r.points[0]?.date;
            const end = r.end ?? r.points[r.points.length - 1]?.date ?? start;
            return (
              <div
                key={r.id}
                data-layout-id={r.id}
                className="flex h-10 items-center border-b"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onOpenRow?.(r.id)}
                  className={cn(
                    'h-full shrink-0 truncate border-r px-2 text-left text-sm hover:underline',
                    LANE_LABEL,
                  )}
                >
                  {r.label}
                </button>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target in the aria-hidden visual; the tray and the list carry the keyboard path */}
                <div
                  className={cn(
                    'relative h-full flex-1',
                    dropRow === r.id && 'bg-accent/40',
                  )}
                  onDragOver={
                    onDropItem
                      ? (e) => {
                          e.preventDefault();
                          setDropRow(r.id);
                        }
                      : undefined
                  }
                  onDragLeave={() => setDropRow((d) => (d === r.id ? null : d))}
                  onDrop={
                    onDropItem
                      ? (e) => {
                          e.preventDefault();
                          setDropRow(null);
                          const id = e.dataTransfer.getData('text/plain');
                          const box = e.currentTarget.getBoundingClientRect();
                          if (id)
                            onDropItem(id, r.id, dayAt(e.clientX - box.left));
                        }
                      : undefined
                  }
                >
                  {!r.noBar && start && end && (
                    <span
                      className={cn(
                        'absolute top-1/2 h-2 -translate-y-1/2 bg-primary/25',
                        r.open &&
                          'border border-dashed border-primary/60 bg-transparent',
                      )}
                      style={{
                        left: x(start),
                        width: Math.max(px, x(end) - x(start)),
                      }}
                    />
                  )}
                  {r.points.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      tabIndex={-1}
                      data-layout-id={p.id}
                      title={`${p.label} · ${formatDay(p.date, today)}`}
                      onClick={() => {
                        // A drag ends with a click; only a still press opens.
                        if (!moved.current) onOpenPoint?.(r.id, p.id);
                        moved.current = false;
                      }}
                      onPointerDown={
                        onMovePoint
                          ? (e) => {
                              e.currentTarget.setPointerCapture(e.pointerId);
                              moved.current = false;
                              setDragging({
                                rowId: r.id,
                                pointId: p.id,
                                startX: e.clientX,
                                days: 0,
                              });
                            }
                          : undefined
                      }
                      onPointerMove={
                        onMovePoint
                          ? (e) => {
                              if (dragging?.pointId !== p.id) return;
                              const daysMoved = Math.round(
                                (e.clientX - dragging.startX) / px,
                              );
                              if (daysMoved !== 0) moved.current = true;
                              if (daysMoved !== dragging.days) {
                                setDragging({ ...dragging, days: daysMoved });
                              }
                            }
                          : undefined
                      }
                      onPointerUp={
                        onMovePoint
                          ? () => {
                              if (
                                dragging?.pointId === p.id &&
                                dragging.days !== 0
                              ) {
                                onMovePoint(
                                  r.id,
                                  p.id,
                                  addDays(p.date, dragging.days),
                                );
                              }
                              setDragging(null);
                            }
                          : undefined
                      }
                      className={cn(
                        'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-foreground',
                        p.kind === 'milestone' && 'bg-foreground',
                        p.kind === 'deadline' &&
                          'border-destructive bg-background',
                        p.kind === 'task' && 'rounded-full bg-background',
                      )}
                      style={{
                        left: x(p.date),
                        // While dragging: transform only; layout moves on drop.
                        translate:
                          dragging?.pointId === p.id
                            ? `calc(-50% + ${dragging.days * px}px) -50%`
                            : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-destructive"
            style={{ left: `calc(${x(today)}px + var(--lane))` }}
          />
        </div>
      </div>
    </section>
  );
}
