import { createContext, type ReactNode, useContext } from 'react';
import { useConfig } from '@/hooks/useConfig';
import { DatapadContext, useDatapadConnection } from '@/hooks/useDatapad';
import { useToast } from '@/providers/ToastProvider';

const EmailContext = createContext<string | null>(null);

/**
 * Opens the one connection the app has and shares it. Inside
 * `ToastProvider`: a refused change is toasted with its reason.
 */
export function DatapadProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const email = config?.email ?? null;
  const { show } = useToast();
  const datapad = useDatapadConnection(email, show);
  return (
    <EmailContext.Provider value={email}>
      <DatapadContext.Provider value={datapad}>
        {children}
      </DatapadContext.Provider>
    </EmailContext.Provider>
  );
}

/** The signed-in email, verified by Access. Null until it arrives. */
export function useEmail(): string | null {
  return useContext(EmailContext);
}
