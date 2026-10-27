import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import { ACCESS_HEADER, createAccessVerifier } from '../worker/access';
import type { Bindings } from '../worker/env';
import { createWorker } from '../worker/index';
import {
  AUTHORIZE_PATH,
  grantUserId,
  isProviderPath,
  oauthHelpers,
} from '../worker/mcp/oauth';
import { handleMcpPost, type McpServer } from '../worker/mcp/protocol';
import { defineTool, READ_ONLY } from '../worker/mcp/tool';
import { TOOLS } from '../worker/mcp/tools';

/**
 * MCP (#152) end to end in workerd: discovery, dynamic registration, the
 * consent page behind a mocked Access JWT (as test/access.test.ts signs
 * them), PKCE, refresh, and the official SDK client over `SELF`; then the
 * refusals that keep a token to its own Durable Object.
 *
 * `/oauth/authorize` goes through `createWorker` with a verifier whose
 * certs endpoint is faked and an env with Access configured, so the test
 * does not depend on .dev.vars. Everything after it goes through `SELF`,
 * the real default export, with no Access at all: the bearer is the only
 * credential there.
 */

const ORIGIN = 'https://datapad.test';
const MCP_URL = `${ORIGIN}/mcp`;
const REDIRECT = 'http://127.0.0.1:43123/callback';
const TEAM = 'rebels.cloudflareaccess.com';
const AUD = 'aud-tag-mcp';

const base = env as unknown as Bindings;
/** Access configured, no dev bypass: what production looks like. */
const accessEnv: Bindings = {
  ...base,
  ACCESS_AUD: AUD,
  ACCESS_TEAM_DOMAIN: TEAM,
  DEV_ACCESS_EMAIL: undefined,
};

function b64url(data: string | Uint8Array): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let key: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
let worker: ReturnType<typeof createWorker>;

beforeAll(async () => {
  key = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  jwk = {
    ...((await crypto.subtle.exportKey('jwk', key.publicKey)) as JsonWebKey),
    kid: 'k1',
  };
  worker = createWorker(
    createAccessVerifier({
      fetch: async () => Response.json({ keys: [jwk] }),
    }),
  );
});

/** A Cloudflare Access JWT for `email`, signed with the test key. */
async function accessJwt(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const body = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}`,
      email,
      iat: now,
      nbf: now,
      exp: now + 600,
    }),
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

/** A request through the Access-checked worker, with Access configured. */
async function viaAccess(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, accessEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function pkce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(bytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function register(name = 'Test client'): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}

/** Register, sign in through Access, approve, and exchange the code. */
async function connect(
  email: string,
  { write = false, name = 'Test client' } = {},
): Promise<{ tokens: Tokens; clientId: string }> {
  const clientId = await register(name);
  const { verifier, challenge } = await pkce();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: MCP_URL,
  });
  const jwt = await accessJwt(email);
  const page = await viaAccess(
    new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
      headers: { [ACCESS_HEADER]: jwt },
    }),
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  expect(handle).toBeTruthy();
  const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const form = new URLSearchParams({
    handle: handle ?? '',
    decision: 'approve',
  });
  if (write) form.set('write', '1');
  const approved = await viaAccess(
    new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        [ACCESS_HEADER]: jwt,
        cookie,
        origin: ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    }),
  );
  expect(approved.status).toBe(302);
  const location = new URL(approved.headers.get('location') ?? '');
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('state-1');
  const code = location.searchParams.get('code') ?? '';
  const token = await SELF.fetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  });
  expect(token.status).toBe(200);
  return { tokens: (await token.json()) as Tokens, clientId };
}

/** The official SDK client, over `SELF`, with a bearer. */
async function sdkClient(accessToken: string): Promise<Client> {
  const client = new Client({ name: 'datapad-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (input, init) => SELF.fetch(input, init),
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

/** One raw JSON-RPC POST to `/mcp`. */
function rpc(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface Whoami {
  email: string;
  scopes: string[];
  spaces: { id: string; name: string; counts: Record<string, number> }[];
}

describe('discovery', () => {
  it('publishes the protected resource and the authorization server', async () => {
    const resource = await SELF.fetch(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: MCP_URL,
      authorization_servers: [ORIGIN],
    });

    const server = await SELF.fetch(
      `${ORIGIN}/.well-known/oauth-authorization-server`,
    );
    expect(server.status).toBe(200);
    const meta = (await server.json()) as Record<string, unknown>;
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      scopes_supported: ['read', 'write'],
      code_challenge_methods_supported: ['S256'],
    });
    expect(server.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('routes only the provider’s paths around Access', () => {
    for (const path of [
      '/mcp',
      '/oauth/token',
      '/oauth/register',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      expect(isProviderPath(path), path).toBe(true);
    }
    for (const path of [
      '/oauth/authorize',
      '/',
      '/api/config',
      '/ws',
      '/mcpx',
      '/oauth',
      '/.well-known/other',
    ]) {
      expect(isProviderPath(path), path).toBe(false);
    }
  });
});

describe('sign-in', () => {
  it('keeps /oauth/authorize behind Access', async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const url = `${ORIGIN}${AUTHORIZE_PATH}?${query}`;
    expect((await viaAccess(new Request(url))).status).toBe(401);
    expect(
      (
        await viaAccess(
          new Request(url, { headers: { [ACCESS_HEADER]: 'not.a.jwt' } }),
        )
      ).status,
    ).toBe(401);
    // Nor does a dev header get in while Access is configured.
    expect(
      (
        await viaAccess(
          new Request(url, {
            headers: { 'x-dev-access-email': 'leia@example.com' },
          }),
        )
      ).status,
    ).toBe(401);
  });

  it('shows a consent page that names the client and the redirect host, escaped, with no script', async () => {
    const clientId = await register('Evil <script>alert(1)</script>');
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const page = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
        headers: { [ACCESS_HEADER]: await accessJwt('leia@example.com') },
      }),
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain('<script');
    expect(html).toContain('Evil &#60;script&#62;');
    expect(html).toContain('127.0.0.1');
    expect(html).toContain('an app on this computer');
    expect(html).toContain('leia@example.com');
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' http://127.0.0.1:43123");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('unsafe-inline');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('set-cookie')).toMatch(/^__Host-oauth-consent-/);
  });

  it('renders an unknown client locally and never redirects to it', async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'no-such-client',
      redirect_uri: 'https://evil.example/cb',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
    });
    const page = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
        headers: { [ACCESS_HEADER]: await accessJwt('leia@example.com') },
      }),
    );
    expect(page.status).toBe(400);
    expect(page.headers.get('location')).toBeNull();
    expect(await page.text()).toContain('Cannot connect');
  });

  it('redirects with access_denied on Deny, and the handle works once', async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
    });
    const jwt = await accessJwt('leia@example.com');
    const page = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
        headers: { [ACCESS_HEADER]: jwt },
      }),
    );
    const handle =
      /name="handle" value="([^"]+)"/.exec(await page.text())?.[1] ?? '';
    const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const post = (decision: string) =>
      viaAccess(
        new Request(`${ORIGIN}${AUTHORIZE_PATH}`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            [ACCESS_HEADER]: jwt,
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ handle, decision }),
        }),
      );
    const denied = await post('deny');
    expect(denied.status).toBe(302);
    const location = new URL(denied.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('s');
    // Used up: approving now is refused on the page.
    const again = await post('approve');
    expect(again.status).toBe(400);
    expect(again.headers.get('location')).toBeNull();
  });

  it('refuses a cross-site form post', async () => {
    const response = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}`, {
        method: 'POST',
        headers: {
          [ACCESS_HEADER]: await accessJwt('leia@example.com'),
          origin: 'https://evil.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'handle=x&decision=approve',
      }),
    );
    expect(response.status).toBe(403);
  });

  it('refuses a code without its PKCE verifier', async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const jwt = await accessJwt('leia@example.com');
    const page = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}?${query}`, {
        headers: { [ACCESS_HEADER]: jwt },
      }),
    );
    const handle =
      /name="handle" value="([^"]+)"/.exec(await page.text())?.[1] ?? '';
    const approved = await viaAccess(
      new Request(`${ORIGIN}${AUTHORIZE_PATH}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          [ACCESS_HEADER]: jwt,
          cookie: (page.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ handle, decision: 'approve' }),
      }),
    );
    const code =
      new URL(approved.headers.get('location') ?? '').searchParams.get(
        'code',
      ) ?? '';
    const token = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier',
      }),
    });
    expect(token.status).toBe(400);
  });

  it('issues an hour’s access token and a refresh token that works', async () => {
    const { tokens, clientId } = await connect('leia@example.com');
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe('read');
    const refreshed = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as Tokens;
    expect(next.access_token).not.toBe(tokens.access_token);
    const client = await sdkClient(next.access_token);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect((result.structuredContent as unknown as Whoami).email).toBe(
        'leia@example.com',
      );
    } finally {
      await client.close();
    }
  });

  it('grants write only when the owner ticks it', async () => {
    const { tokens } = await connect('leia@example.com', { write: true });
    expect(tokens.scope.split(' ').sort()).toEqual(['read', 'write']);
  });
});

describe('the /mcp endpoint', () => {
  it('initializes, lists the tools and calls whoami and list_spaces through the SDK client', async () => {
    const { tokens } = await connect('Leia@Example.com');
    const client = await sdkClient(tokens.access_token);
    try {
      expect(client.getServerVersion()?.name).toBe('datapad');
      expect(client.getServerCapabilities()).toEqual({
        tools: { listChanged: false },
      });
      const instructions = client.getInstructions() ?? '';
      expect(instructions).toContain('list_spaces');
      expect(instructions).toContain('YYYY-MM-DD');

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['whoami', 'list_spaces']);
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }

      const who = await client.callTool({ name: 'whoami', arguments: {} });
      expect(who.isError).toBeUndefined();
      expect(who.structuredContent).toMatchObject({
        email: 'leia@example.com',
        scopes: ['read'],
        spaces: [
          {
            id: 'main',
            name: 'Main',
            counts: { projects: 0, tasks: 0, notes: 0, meetings: 0 },
          },
        ],
      });
      expect(who.content).toEqual([
        { type: 'text', text: JSON.stringify(who.structuredContent) },
      ]);

      const spaces = await client.callTool({
        name: 'list_spaces',
        arguments: {},
      });
      expect(spaces.structuredContent).toMatchObject({
        spaces: [{ id: 'main', name: 'Main' }],
      });

      expect(await client.ping()).toEqual({});
    } finally {
      await client.close();
    }
  });

  it('answers 401 without a bearer, naming the resource metadata', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('refuses an Access cookie or JWT with no bearer: no cookie fallback', async () => {
    const jwt = await accessJwt('leia@example.com');
    const headers = {
      cookie: `CF_Authorization=${jwt}`,
      [ACCESS_HEADER]: jwt,
    };
    expect(
      (await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, headers)).status,
    ).toBe(401);
    // Even through the Access-checked worker, with that JWT valid.
    const response = await viaAccess(
      new Request(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('refuses a token it did not issue', async () => {
    const response = await rpc(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { authorization: 'Bearer a:b:c' },
    );
    expect(response.status).toBe(401);
  });

  it('answers GET with 405: there is no stream', async () => {
    const { tokens } = await connect('leia@example.com');
    const response = await SELF.fetch(MCP_URL, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'text/event-stream',
      },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('never reaches another email’s object', async () => {
    const leia = await connect('leia@example.com');
    const han = await connect('han@example.com');
    // Han has a second space; Leia does not.
    const created =
      await base.DATAPAD.getByName('han@example.com').createSpace('Falcon');
    expect(created.ok).toBe(true);

    const whoami = async (token: string, args: Record<string, unknown>) => {
      const client = await sdkClient(token);
      try {
        const result = await client.callTool({
          name: 'whoami',
          arguments: args,
        });
        return result.structuredContent as unknown as Whoami;
      } finally {
        await client.close();
      }
    };
    // An argument naming someone else is not how the object is chosen.
    const asLeia = await whoami(leia.tokens.access_token, {
      email: 'han@example.com',
    });
    expect(asLeia.email).toBe('leia@example.com');
    expect(asLeia.spaces.map((s) => s.name)).toEqual(['Main']);

    const asHan = await whoami(han.tokens.access_token, {});
    expect(asHan.email).toBe('han@example.com');
    expect(asHan.spaces.map((s) => s.name)).toEqual(['Main', 'Falcon']);
  });

  it('refuses a revoked grant from the next call', async () => {
    const { tokens } = await connect('leia@example.com');
    const call = () =>
      rpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'whoami' },
        },
        { authorization: `Bearer ${tokens.access_token}` },
      );
    expect((await call()).status).toBe(200);

    const oauth = oauthHelpers(new Request(MCP_URL), base);
    const userId = grantUserId('leia@example.com');
    const { items } = await oauth.listUserGrants(userId);
    expect(items.length).toBeGreaterThan(0);
    for (const grant of items) await oauth.revokeGrant(grant.id, userId);

    expect((await call()).status).toBe(401);
  });

  it('rate-limits tool calls per token, as a result the model can read', async () => {
    const { tokens } = await connect('leia@example.com');
    const call = async () => {
      const response = await rpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_spaces' },
        },
        { authorization: `Bearer ${tokens.access_token}` },
      );
      expect(response.status).toBe(200);
      return (
        (await response.json()) as {
          result: { isError?: boolean; content: { text: string }[] };
        }
      ).result;
    };
    for (let i = 0; i < LIMITS.mcpCallsPerMinute; i++) {
      expect((await call()).isError).toBeUndefined();
    }
    const limited = await call();
    expect(limited.isError).toBe(true);
    expect(limited.content[0]?.text).toContain('Rate limited');
    // Another token of the same user has its own minute.
    const other = await connect('leia@example.com', { name: 'Other client' });
    const response = await rpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_spaces' },
      },
      { authorization: `Bearer ${other.tokens.access_token}` },
    );
    const body = (await response.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBeUndefined();
  });

  it('speaks JSON-RPC strictly', async () => {
    const { tokens } = await connect('leia@example.com');
    const auth = { authorization: `Bearer ${tokens.access_token}` };
    const json = async (r: Response) =>
      (await r.json()) as { error?: { code: number }; result?: unknown };

    const garbage = await rpc('{not json', auth);
    expect(garbage.status).toBe(400);
    expect((await json(garbage)).error?.code).toBe(-32700);

    const batch = await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }], auth);
    expect(batch.status).toBe(400);

    const notification = await rpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      auth,
    );
    expect(notification.status).toBe(202);

    const unknown = await rpc({ jsonrpc: '2.0', id: 2, method: 'nope' }, auth);
    expect((await json(unknown)).error?.code).toBe(-32601);

    const noTool = await rpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } },
      auth,
    );
    expect((await json(noTool)).error?.code).toBe(-32602);

    const version = await rpc(
      { jsonrpc: '2.0', id: 4, method: 'ping' },
      { ...auth, 'mcp-protocol-version': '1999-01-01' },
    );
    expect(version.status).toBe(400);

    const init = await rpc(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'initialize',
        params: { protocolVersion: '2099-01-01', capabilities: {} },
      },
      auth,
    );
    expect(
      ((await json(init)).result as { protocolVersion: string })
        .protocolVersion,
    ).toBe('2025-11-25');
  });
});

describe('the tool registry', () => {
  it('lists every tool with a unique name, a scope and an object schema', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(['read', 'write']).toContain(tool.scope);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('shows and runs only the tools the token’s scopes allow', async () => {
    const tools = [
      defineTool({
        name: 'peek',
        title: 'Peek',
        description: 'Reads.',
        scope: 'read',
        input: z.object({ n: z.number().optional() }),
        annotations: READ_ONLY,
        run: async () => ({ ok: true }),
      }),
      defineTool({
        name: 'poke',
        title: 'Poke',
        description: 'Writes.',
        scope: 'write',
        input: z.object({}),
        annotations: { ...READ_ONLY, readOnlyHint: false },
        run: async () => ({ ok: true }),
      }),
    ];
    const server = (scopes: ('read' | 'write')[]): McpServer => ({
      tools,
      context: {
        email: 'leia@example.com',
        scopes,
        datapad: base.DATAPAD.getByName('leia@example.com'),
      },
      instructions: 'Testing.',
      admit: async () => true,
      limited: 'Limited.',
    });
    const post = async (s: McpServer, body: unknown) =>
      (await (
        await handleMcpPost(
          new Request(MCP_URL, { method: 'POST', body: JSON.stringify(body) }),
          s,
        )
      ).json()) as {
        result: { tools?: { name: string }[]; isError?: boolean };
      };

    const readOnly = server(['read']);
    const list = await post(readOnly, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(list.result.tools?.map((t) => t.name)).toEqual(['peek']);
    const bad = await post(readOnly, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'peek', arguments: { n: 'three' } },
    });
    expect(bad.result.isError).toBe(true);
    const poke = await post(readOnly, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'poke' },
    });
    expect(poke.result.isError).toBe(true);

    const both = await post(server(['read', 'write']), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'poke' },
    });
    expect(both.result.isError).toBeUndefined();
  });
});
