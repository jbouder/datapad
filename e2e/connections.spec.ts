import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * Settings → Connected apps (#154): the MCP clients the owner approved,
 * listed from the OAuth provider's grants, and Revoke. Each test connects
 * its apps for real: dynamic registration, the consent page (signed in by
 * the dev Access bypass, as the test's own address), Allow, and the code
 * exchanged with its PKCE verifier. Then the app's bearer calls `/mcp`.
 */

const REDIRECT = 'http://127.0.0.1:43123/callback';

const b64url = (bytes: Buffer) => bytes.toString('base64url');

/** Connect an MCP client named `name` as this test's address. */
async function connectApp(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  write: boolean,
): Promise<string> {
  const registered = await request.post('/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(registered.status()).toBe(201);
  const { client_id: clientId } = (await registered.json()) as {
    client_id: string;
  };
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 's',
    resource: `${baseURL}/mcp`,
  });
  const consent = await request.get(`/oauth/authorize?${query}`);
  expect(consent.status()).toBe(200);
  const handle = /name="handle" value="([^"]+)"/.exec(await consent.text());
  expect(handle?.[1]).toBeTruthy();
  const approved = await request.post(`/oauth/authorize?${query}`, {
    form: {
      handle: handle?.[1] ?? '',
      decision: 'approve',
      ...(write ? { write: '1' } : {}),
    },
    headers: { origin: baseURL },
    maxRedirects: 0,
  });
  expect(approved.status()).toBe(302);
  const code =
    new URL(approved.headers().location ?? '').searchParams.get('code') ?? '';
  const token = await request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${baseURL}/mcp`,
    },
  });
  expect(token.status()).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

/** One `tools/call` on `/mcp` with the app's bearer. */
function callTool(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return request.post('/mcp', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
}

test('lists the connected apps and revokes one', async ({
  page,
  request,
  baseURL,
}) => {
  await request.post('/api/import', { data: SEED });
  const origin = baseURL ?? '';
  const claude = await connectApp(request, origin, 'Claude Code', true);
  await connectApp(request, origin, 'Claude Desktop', false);
  expect((await callTool(request, claude, 'whoami')).status()).toBe(200);

  await openLive(page, '/settings/connections');
  await expect(page).toHaveTitle('Connected apps · Settings · Datapad');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Connected apps' }),
  ).toBeVisible();
  await expect(page.getByText(`${origin}/mcp`)).toBeVisible();
  const list = page.getByRole('list', { name: 'Connected apps' });
  const code = list.getByRole('listitem').filter({ hasText: 'Claude Code' });
  const desktop = list
    .getByRole('listitem')
    .filter({ hasText: 'Claude Desktop' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(code).toContainText('Read and write');
  await expect(code).toContainText('Last used just now');
  await expect(desktop).toContainText('Read only');
  await expect(desktop).toContainText('Not used yet');
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Cancel keeps it.
  await code.getByRole('button', { name: 'Revoke Claude Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revoke Claude Code?' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  // Revoke ends it: gone from the list, and its token refused.
  await code.getByRole('button', { name: 'Revoke Claude Code' }).click();
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('Revoked Claude Code')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(code).toHaveCount(0);
  expect((await callTool(request, claude, 'whoami')).status()).toBe(401);

  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Connected apps' }).getByRole('listitem'),
  ).toHaveText([/Claude Desktop/]);
});

test('says when no app is connected', async ({ page }) => {
  await openLive(page, '/settings/connections');
  await expect(page.getByText('No apps connected.')).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('an MCP write shows up in an open tab without a reload', async ({
  page,
  request,
  baseURL,
}) => {
  await request.post('/api/import', { data: SEED });
  const token = await connectApp(request, baseURL ?? '', 'Claude Code', true);
  await openLive(page, '/tasks');
  const response = await callTool(request, token, 'add_task', {
    title: 'Recalibrate the deflector array',
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    result: { isError?: boolean };
  };
  expect(body.result.isError).toBeUndefined();
  await expect(
    page.getByText('Recalibrate the deflector array').first(),
  ).toBeVisible();
});
