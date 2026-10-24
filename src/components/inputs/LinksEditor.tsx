import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useId } from 'react';
import { LIMITS } from '#shared/limits';
import type { Link } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TYPES = ['link', 'meeting', 'issue', 'doc', 'pr'];

/**
 * Rows of type, URL and label. The type is free text with the usual
 * suggestions; empty rows are dropped by the form on save.
 */
export function LinksEditor({
  value,
  onChange,
  label = 'Links',
}: {
  value: Link[];
  onChange: (links: Link[]) => void;
  label?: string;
}) {
  const id = useId();
  const list = `${id}-types`;
  const set = (i: number, patch: Partial<Link>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      <datalist id={list}>
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No links yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {value.map((link, i) => (
          // Rows have no identity of their own; position is the key.
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <li key={i} className="grid grid-cols-[5.5rem_1fr_auto] gap-1">
            <Input
              aria-label={`Link ${i + 1} type`}
              list={list}
              value={link.type}
              maxLength={LIMITS.linkTypeMax}
              onChange={(e) => set(i, { type: e.target.value })}
              className="h-11 text-base desk:h-8 desk:text-xs"
            />
            <Input
              aria-label={`Link ${i + 1} URL`}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={link.url}
              maxLength={LIMITS.urlMax}
              onChange={(e) => set(i, { url: e.target.value })}
              className="h-11 text-base desk:h-8 desk:text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="press size-11 desk:size-8"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <TrashIcon />
              <span className="sr-only">Remove link {i + 1}</span>
            </Button>
            <Input
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              value={link.label}
              maxLength={LIMITS.linkLabelMax}
              onChange={(e) => set(i, { label: e.target.value })}
              className="col-span-2 col-start-2 h-11 text-base desk:h-8 desk:text-xs"
            />
          </li>
        ))}
      </ul>
      {value.length < LIMITS.linksMax && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="press self-start"
          onClick={() =>
            onChange([...value, { type: 'link', url: '', label: '' }])
          }
        >
          <PlusIcon />
          Add link
        </Button>
      )}
    </fieldset>
  );
}

/** Links worth keeping: a URL, trimmed. */
export function cleanLinks(links: Link[]): Link[] {
  return links
    .map((l) => ({
      type: l.type.trim() || 'link',
      url: l.url.trim(),
      label: l.label.trim(),
    }))
    .filter((l) => l.url);
}
