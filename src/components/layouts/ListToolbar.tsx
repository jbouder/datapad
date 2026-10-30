import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { activeFilterCount, clearFilters, isFiltered } from '#shared/pages';
import type { PageKey } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useDesk } from '@/hooks/useMediaQuery';

export interface ListFilters {
  /** Filters away from the page's defaults (not Find, not the sort). */
  count: number;
  /** A filter is on or Find has words: Clear filters shows. */
  filtered: boolean;
  /** Every filter back to its default and Find emptied (not sort or view). */
  clear: () => void;
}

/**
 * A list page's filter state from its query (`usePageQuery`'s, so what is
 * saved counts too) and the change function it writes the query with.
 * The toolbar's count and Clear filters and the page's empty state all
 * come from here, so they agree.
 */
export function useListFilters(
  page: PageKey,
  query: URLSearchParams,
  change: (changes: Record<string, string | null>) => void,
): ListFilters {
  const value = query.toString();
  const { count, filtered } = useMemo(() => {
    const q = new URLSearchParams(value);
    return {
      count: activeFilterCount(page, q),
      filtered: isFiltered(page, q),
    };
  }, [page, value]);
  const clear = useCallback(() => change(clearFilters(page)), [change, page]);
  return { count, filtered, clear };
}

/**
 * The toolbar every list page shares (#269): Find first, then the page's
 * filters, then Sort, then Clear filters while anything is filtered. On
 * desktop they sit in one row that wraps; on phones it is Find and a
 * Filters (n) button whose bottom sheet holds the filters and Sort, with
 * Clear filters and Done. The controls render once, in whichever is
 * showing.
 */
export function ListToolbar({
  find,
  filters,
  sort,
  state,
}: {
  /** The page's `FindField`. */
  find: ReactNode;
  /** The page's filter controls (`SelectField`, `Segmented`), in order. */
  filters?: ReactNode;
  /** The page's `SortField`, when it has one here. */
  sort?: ReactNode;
  state: ListFilters;
}) {
  const desk = useDesk();
  const [open, setOpen] = useState(false);
  const more = Boolean(filters || sort);
  const clearButton = (
    <Button
      variant="outline"
      className="press h-11 desk:h-8"
      onClick={state.clear}
    >
      Clear filters
    </Button>
  );

  if (desk) {
    return (
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-[2_1_14rem]">{find}</div>
        {more && (
          <div className="contents *:min-w-36 *:flex-[1_1_10rem]">
            {filters}
            {sort}
          </div>
        )}
        {state.filtered && clearButton}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">{find}</div>
      {more && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" className="press h-11 shrink-0" />
            }
          >
            {state.count > 0 ? `Filters (${state.count})` : 'Filters'}
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4">
              {filters}
              {sort}
            </div>
            <SheetFooter className="flex-row justify-end">
              {state.filtered && clearButton}
              <SheetClose render={<Button className="press h-11" />}>
                Done
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * A list with nothing to show (#269): with filters or Find on, "None
 * match these filters." and Clear filters; otherwise the page's own
 * "nothing yet" words.
 */
export function ListEmpty({
  state,
  children,
}: {
  state: ListFilters;
  /** What the page says when it has nothing at all. */
  children: ReactNode;
}) {
  if (!state.filtered) return <p className="text-state">{children}</p>;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-state">None match these filters.</p>
      <Button
        variant="outline"
        className="press h-11 desk:h-8"
        onClick={state.clear}
      >
        Clear filters
      </Button>
    </div>
  );
}
