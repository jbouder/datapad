import { useCallback, useState } from 'react';
import { PersonForm } from '@/components/people/PersonForm';
import { navigate } from '@/lib/router';

/**
 * New person, wherever it is offered (the rooms' `+`, All's People, ⌘K):
 * `open()` shows an empty person form, and saving lands in the new
 * person's room. Render `form` once, beside the trigger.
 */
export function useNewPerson() {
  // A new session each time, so the form starts empty.
  const [session, setSession] = useState<{
    key: number;
    open: boolean;
  } | null>(null);

  const form = session && (
    <PersonForm
      key={session.key}
      open={session.open}
      onClose={() => setSession((s) => (s ? { ...s, open: false } : s))}
      onExited={() => setSession((s) => (s?.open ? s : null))}
      onAdded={(id) => navigate({ name: 'person', id })}
    />
  );

  const open = useCallback(
    () => setSession({ key: Date.now(), open: true }),
    [],
  );
  return { open, form };
}
