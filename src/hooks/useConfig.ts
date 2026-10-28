import { useEffect, useState } from 'react';
import type { AppConfig } from '#shared/protocol';
import { fetchConfig } from '@/lib/api';

/** `/api/config`, once per page load. Null until it arrives. */
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      // Signed out: the app shows "Sign in again". Anything else (offline),
      // the cached email and data carry on.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return config;
}
