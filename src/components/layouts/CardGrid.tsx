import type { ReactNode } from 'react';

/**
 * Cards in a responsive grid: one column on phones, two from 640px,
 * three from 1024px. Each item carries `data-layout-id` so a layout switch
 * moves it rather than re-drawing it.
 */
export function CardGrid<T>({
  label,
  items,
  getId,
  renderCard,
}: {
  label: string;
  items: T[];
  getId: (item: T) => string;
  renderCard: (item: T, index: number) => ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className="vt-list grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {items.map((item, i) => (
        <li key={getId(item)} data-layout-id={getId(item)} className="flex">
          <div className="flex flex-1 flex-col *:flex-1">
            {renderCard(item, i)}
          </div>
        </li>
      ))}
    </ul>
  );
}
