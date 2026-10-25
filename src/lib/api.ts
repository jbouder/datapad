import type {
  AppConfig,
  BackupList,
  CreatedSpace,
  EraseToken,
  ImportResult,
  SpaceList,
} from '#shared/protocol';
import { MAIN_SPACE, type SpaceInfo } from '#shared/types';

/**
 * The few HTTP calls the app makes. Every one goes to this origin, where
 * Cloudflare Access has already signed the request; a 401 means the Access
 * session ended, so the page reloads into the Access login.
 *
 * The data calls work on one space, sent as `?space=`. `main` sends none,
 * so its URLs stay exactly what they were before spaces (the Worker reads
 * a missing space as `main`).
 */

export class SignedOutError extends Error {
  constructor() {
    super('Signed out');
  }
}

/** A spaces route said no; `message` is the reason, ready for a toast. */
export class RefusedError extends Error {
  constructor(
    message: string,
    /** 403 is a wrong or expired delete token. */
    readonly status: number,
  ) {
    super(message);
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

/** A path on one space: `main` adds nothing. */
function scoped(path: string, space: string): string {
  return space === MAIN_SPACE
    ? path
    : `${path}?space=${encodeURIComponent(space)}`;
}

/**
 * The live connection to one space, on this origin (wss: when the page is
 * https:).
 */
export function socketUrl(space: string): string {
  const url = new URL(scoped('/ws', space), window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** Every space, in switcher order. */
export async function fetchSpaces(): Promise<SpaceList> {
  const response = await fetch('/api/spaces', { credentials: 'same-origin' });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error(`Spaces answered ${response.status}`);
  }
  return (await response.json()) as SpaceList;
}

/** Add an empty space, last in the list; the error carries the reason. */
export async function createSpace(name: string): Promise<SpaceInfo> {
  const { space } = await postSpaces<CreatedSpace>('/api/spaces/create', {
    name,
  });
  return space;
}

/** Rename a space; answers every space, in switcher order. */
export function renameSpace(id: string, name: string): Promise<SpaceList> {
  return postSpaces('/api/spaces/rename', { id, name });
}

/** Put the spaces in this order: every space's id, once each. */
export function reorderSpaces(ids: string[]): Promise<SpaceList> {
  return postSpaces('/api/spaces/reorder', { ids });
}

/**
 * The one-time token `deleteSpace` needs, issued for that space and good
 * for a few minutes (the same token erase uses).
 */
export async function spaceDeleteToken(space: string): Promise<EraseToken> {
  const response = await fetch(scoped('/api/erase-token', space), {
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error(`Erase token answered ${response.status}`);
  }
  return (await response.json()) as EraseToken;
}

/**
 * Delete a space and everything in it, with a token from
 * `spaceDeleteToken(id)`. Its open sockets close with
 * `SPACE_DELETED_CLOSE`.
 */
export async function deleteSpace(id: string, token: string): Promise<void> {
  await postSpaces<{ deleted: true }>('/api/spaces/delete', { id, token });
}

/**
 * Move a project, with its tasks, notes, events, decisions and log, from
 * one space to another; its people and org are copied. Both spaces'
 * sockets get a fresh snapshot. The error carries the reason.
 */
export async function moveProject(
  from: string,
  to: string,
  id: string,
): Promise<void> {
  await postSpaces<{ moved: true }>('/api/spaces/move-project', {
    from,
    to,
    id,
  });
}

async function postSpaces<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  const body = (await response.json().catch(() => ({}))) as
    | T
    | { error?: string };
  if (!response.ok) {
    throw new RefusedError(
      (body as { error?: string }).error ||
        `Spaces answered ${response.status}`,
      response.status,
    );
  }
  return body as T;
}

/** A space's `GET /api/export.json` as text, ready to save. */
export async function fetchExport(space: string): Promise<string> {
  const response = await fetch(scoped('/api/export.json', space), {
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

/**
 * Post a parsed export to a space's `/api/import`; the error carries the
 * reason.
 */
export function postImport(
  space: string,
  file: unknown,
): Promise<ImportResult> {
  return postMerge(scoped('/api/import', space), file);
}

/** Merge one of a space's nightly backups back into it, on the server. */
export function postRestore(space: string, day: string): Promise<ImportResult> {
  return postMerge(scoped('/api/backups/restore', space), { day });
}

/** A space's nightly backups, newest first, and when they run. */
export async function fetchBackups(space: string): Promise<BackupList> {
  const response = await fetch(scoped('/api/backups', space), {
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error(`Backups answered ${response.status}`);
  }
  return (await response.json()) as BackupList;
}

/** Where one of a space's backups downloads from. */
export function backupUrl(space: string, day: string): string {
  return scoped(`/api/backups/${day}.json`, space);
}

/** One of a space's backups, parsed, to count before restoring. */
export async function fetchBackup(
  space: string,
  day: string,
): Promise<unknown> {
  const response = await fetch(backupUrl(space, day), {
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    throw new SignedOutError();
  }
  if (!response.ok) {
    throw new Error('That backup is gone. Refresh the list.');
  }
  return response.json();
}

async function postMerge(
  path: string,
  payload: unknown,
): Promise<ImportResult> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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
