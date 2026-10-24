import { useMemo, useState } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import { InputGroupAddon, InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

/**
 * A typeahead combobox over a fixed list, keyboard operable (↑ ↓ move,
 * Enter picks, Esc closes), the shape every picker shares. With `create`,
 * text that matches nothing offers "Add “…”" as the last option.
 */

export interface PickerOption {
  /** The value; `''` or a sentinel for "none" entries like General. */
  id: string;
  label: string;
  /** Small text after the label (a role, an org). */
  hint?: string;
}

interface CreateOption {
  kind: 'create';
  id: string;
  label: string;
  text: string;
}

type Item = (PickerOption & { kind?: undefined }) | CreateOption;

export interface PickerProps {
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** For "Add “…”": the label for typed text, and what to do with it. */
  create?: {
    label: (text: string) => string;
    onCreate: (text: string) => string | null;
  };
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}

const CREATE_ID = '\u0000create';

export function Picker({
  options,
  value,
  onChange,
  placeholder,
  create,
  className,
  ...aria
}: PickerProps) {
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.id === value) ?? null;

  const items = useMemo<Item[]>(() => {
    const text = query.trim();
    const exact = options.some(
      (o) => o.label.toLowerCase() === text.toLowerCase(),
    );
    if (!create || !text || exact) {
      return options;
    }
    return [
      ...options,
      { kind: 'create', id: CREATE_ID, label: create.label(text), text },
    ];
  }, [options, query, create]);

  return (
    <Combobox<Item>
      items={items}
      value={selected}
      onValueChange={(item) => {
        if (!item) return;
        if (item.kind === 'create') {
          const id = create?.onCreate(item.text);
          if (id) onChange(id);
          return;
        }
        onChange(item.id);
      }}
      onInputValueChange={setQuery}
      itemToStringLabel={(item) => (item.kind === 'create' ? '' : item.label)}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(item, text) =>
        item.kind === 'create' ||
        item.label.toLowerCase().includes(text.trim().toLowerCase())
      }
      autoHighlight
      openOnInputClick
    >
      <ComboboxInput
        {...aria}
        placeholder={placeholder}
        showTrigger={false}
        className={cn(
          'h-11 w-full desk:h-8 *:data-[slot=input-group-control]:text-base desk:*:data-[slot=input-group-control]:text-xs',
          className,
        )}
      >
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            render={<ComboboxTrigger aria-label="Show options" />}
            className="data-pressed:bg-transparent"
          />
        </InputGroupAddon>
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem
              key={item.id}
              value={item}
              className="min-h-11 desk:min-h-8"
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.kind !== 'create' && item.hint && (
                <span className="text-muted-foreground">{item.hint}</span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
