import type { Person } from '#shared/types';
import { initials } from '@/lib/people';
import { cn } from '@/lib/utils';

/** A person's initials in a small square; the full name for everyone else. */
export function Initials({
  person,
  className,
}: {
  person: Person | undefined;
  className?: string;
}) {
  const name = person?.name ?? 'Unknown person';
  return (
    <span
      title={name}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center border bg-muted text-[10px] font-semibold tracking-wide text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden>{person ? initials(person.name) : '?'}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}
