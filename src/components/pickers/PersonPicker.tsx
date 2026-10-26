import { useMemo } from 'react';
import { Picker, type PickerProps } from '@/components/pickers/Picker';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * A person, or Unassigned (`''`). With `allowCreate`, a name that matches
 * nobody can be added to People on the spot. With `onAddPerson`, an
 * "Add a person…" option is always listed and calls it (to open a name
 * field).
 */
export function PersonPicker({
  value,
  onChange,
  allowCreate = false,
  noneLabel = 'Unassigned',
  onAddPerson,
  ...rest
}: Omit<PickerProps, 'options' | 'create' | 'action'> & {
  allowCreate?: boolean;
  noneLabel?: string;
  onAddPerson?: () => void;
}) {
  const { state, actions } = useDatapad();
  const options = useMemo(
    () => [
      { id: '', label: noneLabel },
      ...Object.values(state?.people ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          id: p.id,
          label: p.name,
          hint: p.me ? 'you' : p.role || undefined,
        })),
    ],
    [state, noneLabel],
  );
  return (
    <Picker
      {...rest}
      options={options}
      value={value}
      onChange={onChange}
      create={
        allowCreate
          ? {
              label: (text) => `Add “${text}” to People`,
              onCreate: (name) => actions.addPerson({ name }),
            }
          : undefined
      }
      action={
        onAddPerson
          ? { label: 'Add a person…', onSelect: onAddPerson }
          : undefined
      }
    />
  );
}
