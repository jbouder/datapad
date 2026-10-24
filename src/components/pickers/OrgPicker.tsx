import { useMemo } from 'react';
import { orgs } from '#shared/select';
import { Picker, type PickerProps } from '@/components/pickers/Picker';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The client or org: one already in use, or a new one ("Use “…”"). The
 * value is the org's text; empty means none.
 */
export function OrgPicker({
  value,
  onChange,
  ...rest
}: Omit<PickerProps, 'options' | 'create'>) {
  const { state } = useDatapad();
  const options = useMemo(() => {
    const known = state ? orgs(state.projects) : [];
    const all = value && !known.includes(value) ? [...known, value] : known;
    return [
      { id: '', label: 'No org' },
      ...all.map((org) => ({ id: org, label: org })),
    ];
  }, [state, value]);
  return (
    <Picker
      {...rest}
      options={options}
      value={value}
      onChange={onChange}
      create={{
        label: (text) => `Use “${text}”`,
        onCreate: (text) => text.trim() || null,
      }}
    />
  );
}
