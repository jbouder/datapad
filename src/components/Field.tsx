import { cloneElement, type ReactElement, useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * A label, one control, and an optional hint or error. The control gets
 * the id, `aria-describedby` and `aria-invalid` it needs; the error is
 * announced with the field.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
  labelHidden = false,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  labelHidden?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium', labelHidden && 'sr-only')}
      >
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
