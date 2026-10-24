import { useMemo } from 'react';
import { Picker, type PickerProps } from '@/components/pickers/Picker';
import { useDatapad } from '@/hooks/useDatapad';

/** `Picker`'s value for General (no project). */
export const GENERAL_OPTION = '';

/**
 * A project, or General. Archived projects are offered only when the value
 * already is one (so editing an archived task does not lose its project).
 */
export function ProjectPicker({
  value,
  onChange,
  ...rest
}: Omit<PickerProps, 'options' | 'value' | 'onChange' | 'create'> & {
  value: string | null;
  onChange: (projectId: string | null) => void;
}) {
  const { state } = useDatapad();
  const options = useMemo(() => {
    const projects = Object.values(state?.projects ?? {})
      .filter((p) => !p.archived || p.id === value)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      { id: GENERAL_OPTION, label: 'General' },
      ...projects.map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.archived ? 'archived' : p.org || undefined,
      })),
    ];
  }, [state, value]);
  return (
    <Picker
      {...rest}
      options={options}
      value={value ?? GENERAL_OPTION}
      onChange={(id) => onChange(id === GENERAL_OPTION ? null : id)}
    />
  );
}
