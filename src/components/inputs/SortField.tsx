import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react';
import { SelectField } from '@/components/inputs/SelectField';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

/**
 * A list toolbar's Sort (#269): what to sort by, and a button that turns
 * the order around. Pages without a direction leave `dir` out.
 */
export function SortField<T extends string>({
  value,
  options,
  dir,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  dir?: SortDir;
  onChange: (sort: T, dir: SortDir) => void;
  className?: string;
}) {
  const next: SortDir = dir === 'desc' ? 'asc' : 'desc';
  const DirIcon = dir === 'desc' ? ArrowDownIcon : ArrowUpIcon;
  return (
    <div className={cn('flex items-end gap-1', className)}>
      <SelectField
        label="Sort"
        value={value}
        options={options}
        onChange={(sort) => onChange(sort, dir ?? 'asc')}
        className="min-w-0 flex-1"
      />
      {dir && (
        <Button
          variant="outline"
          className="press size-11 shrink-0 border-border desk:size-8"
          aria-label={`Order: ${dir === 'desc' ? 'descending' : 'ascending'}`}
          title={`Sorted ${dir === 'desc' ? 'descending' : 'ascending'}; press for ${next === 'desc' ? 'descending' : 'ascending'}`}
          onClick={() => onChange(value, next)}
        >
          <DirIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}
