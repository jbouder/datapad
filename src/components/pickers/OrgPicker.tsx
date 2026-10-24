import { useMemo } from 'react';
import { guessKind, orgByName } from '#shared/orgs';
import { orgs } from '#shared/select';
import { Picker, type PickerProps } from '@/components/pickers/Picker';
import { useDatapad } from '@/hooks/useDatapad';

/**
 * The client or org: an Org record, one already named on a project, or a
 * new one ("Add “…”", which makes the record). The value is the org's
 * name; empty means none. The project form links the record by name.
 */
export function OrgPicker({
  value,
  onChange,
  ...rest
}: Omit<PickerProps, 'options' | 'create'>) {
  const { state, actions } = useDatapad();
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
        label: (text) => `Add “${text}”`,
        onCreate: (text) => {
          const name = text.trim();
          if (!name) return null;
          if (state && orgByName(state.orgs, name)) return name;
          return actions.addOrg({ name, kind: guessKind(name) }) ? name : null;
        },
      }}
    />
  );
}
