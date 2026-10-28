import type {
  AppConfig,
  BackupList,
  ClientError,
  ConnectionList,
  CreatedSpace,
  EraseToken,
  ImportResult,
  SpaceList,
} from '#shared/protocol';
import { MAIN_SPACE, type SpaceInfo } from '#shared/types';
import { BUILD_LABEL } from '#shared/version';
import { markSignedOut } from '@/lib/session';

/**
 * The few HTTP calls the app makes. Every one goes to this origin, where
 * Cloudflare Access has already signed the request. When the Access
 * session has ended, a call throws `SignedOutError` and the app shows
 * "Sign in again" (`src/lib/session.ts`).
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

/** The request never got an answer: offline, or the Worker is down. */
export class UnreachableError extends Error {
  constructor() {
    super('Could not reach Datapad. Check the connection and try again.');
  }
}

/**
 * `fetch` on this origin, with the session check every call shares. Access
 * answers a lapsed session with a redirect to its login on another origin,
 * which `fetch` would follow and fail on as a bare network error;
 * `redirect: 'manual'` stops that, so the redirect (or the Worker's own
 * 401, in dev) is recognised as signed out.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      redirect: 'manual',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new UnreachableError();
  }
  if (response.status === 401 || response.type === 'opaqueredirect') {
    markSignedOut();
    throw new SignedOutError();
  }
  return response;
}

/**
 * The socket could not connect: find out whether the session ended (then
 * the app says so) or the network is just down (then it keeps retrying).
 */
export async function probeSession(): Promise<void> {
  try {
    await call('/api/health');
  } catch {
    // Signed out is already marked; anything else, the socket retries.
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
  const response = await call('/api/config', {
    signal,
  });
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
  const response = await call('/api/spaces');
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
  const response = await call(scoped('/api/erase-token', space));
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
 * Move a project, with its tasks, notes, meetings, decisions and log, from
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
  const response = await call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
  const response = await call(scoped('/api/export.json', space));
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
  const response = await call(scoped('/api/backups', space));
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
  const response = await call(backupUrl(space, day));
  if (!response.ok) {
    throw new Error('That backup is gone. Refresh the list.');
  }
  return response.json();
}

async function postMerge(
  path: string,
  payload: unknown,
): Promise<ImportResult> {
  const response = await call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
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

/** The MCP apps the owner approved (#154), newest first. */
export async function fetchConnections(): Promise<ConnectionList> {
  const response = await call('/api/connections');
  if (!response.ok) {
    throw new Error(`Connections answered ${response.status}`);
  }
  return (await response.json()) as ConnectionList;
}

/**
 * Revoke one: its tokens stop working from its next call. A 404 means it
 * was already gone.
 */
export async function revokeConnection(id: string): Promise<void> {
  const response = await call(`/api/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Revoke answered ${response.status}`);
  }
}

/**
 * Tell the Worker a view crashed (#236), so it shows in the logs and not
 * only in this browser's console: the error's message and React's
 * component stack (component names), cut short, and this build's version.
 * Never state, props or anything from a document. Best effort: a report
 * that fails is dropped.
 */
export function reportCrash(
  where: 'page' | 'app',
  error: unknown,
  componentStack: string | null | undefined,
): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const report: ClientError = {
    where,
    message: message.slice(0, 500),
    componentStack: (componentStack ?? '').slice(0, 4000),
    version: BUILD_LABEL.slice(0, 64),
  };
  void fetch('/api/client-error', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  }).catch(() => {});
}
