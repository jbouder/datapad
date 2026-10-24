import { useEffect, useState } from 'react';
import type { AppConfig } from '#shared/protocol';
import { fetchConfig, SignedOutError } from '@/lib/api';

/** `/api/config`, once per page load. Null until it arrives. */
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      .catch((error: unknown) => {
        if (error instanceof SignedOutError) {
          // The Access session ended: reloading sends us through its login.
          window.location.reload();
        }
      });
    return () => controller.abort();
  }, []);

  return config;
}
