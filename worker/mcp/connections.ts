import type { Connection } from '#shared/protocol';
import type { DatapadObject } from '../datapad';
import type { Bindings } from '../env';
import { grantUserId, oauthHelpers } from './oauth';

/**
 * Settings → Connected apps (#154): the MCP clients the owner approved,
 * as grants from the OAuth provider, and revoking one. Reached only from
 * `createHandler` after Access verified `email`; every lookup is under
 * that email's grant user id, so a grant can only ever be listed or
 * revoked by the email it belongs to. A grant id is not a credential.
 */

/** More than one person could approve; enough to stop a runaway list. */
const MAX_PAGES = 10;
const PAGE = 100;

/** Every grant of `email`, newest first, with each client's last call. */
export async function listConnections(
  request: Request,
  env: Bindings,
  email: string,
  datapad: DurableObjectStub<DatapadObject>,
): Promise<Connection[]> {
  const oauth = oauthHelpers(request, env);
  const userId = grantUserId(email);
  const grants = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await oauth.listUserGrants(userId, { limit: PAGE, cursor });
    grants.push(...result.items);
    cursor = result.cursor;
    if (!cursor) break;
  }
  const lastUsed = await datapad.mcpLastUsed();
  const names = new Map<string, string | null>();
  const out: Connection[] = [];
  for (const grant of grants) {
    if (grant.userId !== userId) continue;
    let name: string | null =
      typeof grant.metadata?.clientName === 'string'
        ? grant.metadata.clientName
        : null;
    if (name === null) {
      if (!names.has(grant.clientId)) {
        const client = await oauth.lookupClient(grant.clientId);
        names.set(grant.clientId, client?.clientName ?? null);
      }
      name = names.get(grant.clientId) ?? null;
    }
    out.push({
      id: grant.id,
      clientId: grant.clientId,
      name,
      scopes: [...grant.scope],
      createdAt: new Date(grant.createdAt * 1000).toISOString(),
      expiresAt: grant.expiresAt
        ? new Date(grant.expiresAt * 1000).toISOString()
        : null,
      lastUsedAt: lastUsed[grant.clientId] ?? null,
    });
  }
  // Newest first; the same second by name, so the order holds still.
  return out.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Revoke one of `email`'s grants, and with it every token it issued:
 * the app's next call is refused. False when `email` has no such grant.
 */
export async function revokeConnection(
  request: Request,
  env: Bindings,
  email: string,
  datapad: DurableObjectStub<DatapadObject>,
  grantId: string,
): Promise<boolean> {
  const mine = await listConnections(request, env, email, datapad);
  const grant = mine.find((c) => c.id === grantId);
  if (!grant) return false;
  await oauthHelpers(request, env).revokeGrant(grant.id, grantUserId(email));
  if (!mine.some((c) => c.id !== grant.id && c.clientId === grant.clientId)) {
    await datapad.forgetMcpClient(grant.clientId);
  }
  return true;
}
