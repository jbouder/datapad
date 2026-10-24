import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { XIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

/**
 * Tags as chips. Enter or a comma adds what you typed, Backspace in an
 * empty field removes the last chip, and existing tags are suggested as
 * you type. Tags are trimmed, de-duplicated and kept to the limits.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  id,
  className,
  'aria-describedby': describedBy,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  id?: string;
  className?: string;
  'aria-describedby'?: string;
}) {
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const text = clean(query);
    const all = [...new Set([...suggestions, ...value])].sort((a, b) =>
      a.localeCompare(b),
    );
    return text && !all.includes(text) ? [text, ...all] : all;
  }, [suggestions, value, query]);

  const add = (raw: string) => {
    const tag = clean(raw);
    if (!tag || value.includes(tag) || value.length >= LIMITS.tagsMax) return;
    onChange([...value, tag]);
    setQuery('');
  };

  return (
    <Combobox
      multiple
      items={items}
      value={value}
      onValueChange={(next: string[]) =>
        onChange(
          [...new Set(next.map(clean).filter(Boolean))].slice(
            0,
            LIMITS.tagsMax,
          ),
        )
      }
      inputValue={query}
      onInputValueChange={setQuery}
      autoHighlight
    >
      <ComboboxChips
        ref={anchor}
        className={cn('min-h-11 desk:min-h-8', className)}
      >
        {value.map((tag) => (
          <ComboboxChip key={tag} showRemove={false} className="pr-0">
            {tag}
            <ComboboxPrimitive.ChipRemove
              render={<Button variant="ghost" size="icon-xs" />}
              className="press opacity-60 hover:opacity-100"
              aria-label={`Remove ${tag}`}
            >
              <XIcon aria-hidden />
            </ComboboxPrimitive.ChipRemove>
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          id={id}
          aria-describedby={describedBy}
          placeholder={value.length ? '' : 'Add a tag'}
          className="min-h-9 text-base desk:min-h-6 desk:text-xs"
          onKeyDown={(event) => {
            if (event.key === ',') {
              event.preventDefault();
              add(query);
            }
          }}
          onBlur={() => add(query)}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>Type a tag and press Enter.</ComboboxEmpty>
        <ComboboxList>
          {(tag: string) => (
            <ComboboxItem
              key={tag}
              value={tag}
              className="min-h-11 desk:min-h-8"
            >
              {suggestions.includes(tag) || value.includes(tag)
                ? tag
                : `Add “${tag}”`}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function clean(tag: string): string {
  return tag.replace(/,/g, ' ').trim().slice(0, LIMITS.tagMax);
}
