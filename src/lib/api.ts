import type { AppConfig, ImportResult } from '#shared/protocol';

/**
 * The few HTTP calls the app makes. Every one goes to this origin, where
 * Cloudflare Access has already signed the request; a 401 means the Access
 * session ended, so the page reloads into the Access login.
 */

export class SignedOutError extends Error {
  constructor() {
    super('Signed out');
  }
}

export async function fetchConfig(signal?: AbortSignal): Promise<AppConfig> {
  const response = await fetch('/api/config', {
    signal,
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error(`Config answered ${response.status}`);
  }
  return (await response.json()) as AppConfig;
}

/** Where Access ends the session (handled at the edge, before the Worker). */
export const SIGN_OUT_URL = '/cdn-cgi/access/logout';

/** The live connection, on this origin (wss: when the page is https:). */
export function socketUrl(): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** `GET /api/export.json` as text, ready to save. */
export async function fetchExport(): Promise<string> {
  const response = await fetch('/api/export.json', {
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error(`Export answered ${response.status}`);
  }
  return response.text();
}

/** Post a parsed export to `/api/import`; the error carries the reason. */
export async function postImport(file: unknown): Promise<ImportResult> {
  const response = await fetch('/api/import', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(file),
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  const body = (await response.json().catch(() => ({}))) as
    | ImportResult
    | { error?: string };
  if (!response.ok || !('imported' in body)) {
    throw new Error(
      ('error' in body && body.error) || `Import answered ${response.status}`,
    );
  }
  return body;
}
