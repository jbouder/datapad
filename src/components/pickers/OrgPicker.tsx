import { useMemo } from 'react';
import { orgByName } from '#shared/orgs';
import { orgs } from '#shared/select';
import { useAddByName } from '@/components/inputs/InlineAdd';
import { Picker, type PickerProps } from '@/components/pickers/Picker';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The client or org: an Org record, one already named on a project, or a
 * new one. Typed text that matches no org offers "Add “…” as an org" first,
 * which makes the record at once; a name that exists (ignoring case) is
 * that org, never a second one. The value is the org's name; empty means
 * none. The project form links the record by name.
 */
export function OrgPicker({
  value,
  onChange,
  ...rest
}: Omit<PickerProps, 'options' | 'create'>) {
  const { state } = useDatapad();
  const add = useAddByName('org');
  const options = useMemo(() => {
    const known = state ? orgs(state.projects, state.orgs) : [];
    const all = value && !known.includes(value) ? [...known, value] : known;
    return [
      { id: '', label: 'No org' },
      ...all.map((org) => {
        const record = state ? orgByName(state.orgs, org) : undefined;
        return { id: org, label: org, hint: record ? undefined : 'text only' };
      }),
    ];
  }, [state, value]);
  return (
    <Picker
      {...rest}
      options={options}
      value={value}
      onChange={onChange}
      create={{
        label: (text) => `Add “${text.trim()}” as an org`,
        onCreate: (text) => add(text)?.name ?? null,
        first: true,
      }}
    />
  );
}
