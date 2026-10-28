import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_HEADER,
  createAccessVerifier,
  DEV_EMAIL_HEADER,
  DEV_SESSION_HEADER,
  teamOrigin,
} from '../worker/access';
import type { Bindings } from '../worker/env';

/**
 * worker/access.ts against tokens signed here with a throwaway RSA key, and a
 * fake certs endpoint that counts how often it is asked.
 */

const TEAM = 'rebels.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'aud-tag-1234';
const NOW = Date.UTC(2026, 9, 23, 12);

const base = env as unknown as Bindings;
const configured: Bindings = {
  ...base,
  ACCESS_AUD: AUD,
  ACCESS_TEAM_DOMAIN: TEAM,
  DEV_ACCESS_EMAIL: 'dev@example.com',
};

interface Signer {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

async function signer(kid: string): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey(
    'jwk',
    pair.publicKey,
  )) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid } };
}

function b64url(data: string | Uint8Array): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function token(
  key: Signer,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid }));
  const body = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: ISS,
      email: 'Leia@Example.com',
      iat: NOW / 1000,
      nbf: NOW / 1000,
      exp: NOW / 1000 + 3600,
      ...claims,
    }),
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

function request(jwt?: string, headers: Record<string, string> = {}) {
  return new Request('https://datapad.example.com/', {
    headers: jwt ? { [ACCESS_HEADER]: jwt, ...headers } : headers,
  });
}

/** A verifier whose certs endpoint serves `keys()` and counts the calls. */
function harness(keys: () => Signer[], start = NOW) {
  const calls: string[] = [];
  let clock = start;
  const verify = createAccessVerifier({
    now: () => clock,
    fetch: async (input) => {
      calls.push(String(input));
      return Response.json({ keys: keys().map((k) => k.jwk) });
    },
  });
  return {
    verify,
    calls,
    advance(ms: number) {
      clock += ms;
    },
  };
}

let current: Signer;
let rotated: Signer;
let stranger: Signer;

beforeAll(async () => {
  [current, rotated, stranger] = await Promise.all([
    signer('key-1'),
    signer('key-2'),
    signer('key-1'), // same kid as `current`, different key
  ]);
});

describe('verifyAccess with Access configured', () => {
  it('accepts a valid token and lowercases the email', async () => {
    const { verify, calls } = harness(() => [current]);
    expect(await verify(request(await token(current)), configured)).toEqual({
      email: 'leia@example.com',
      // The token's exp, plus the leeway the check allows (#228).
      expiresAt: NOW + 3600_000 + 60_000,
    });
    expect(calls).toEqual([`${ISS}/cdn-cgi/access/certs`]);
  });

  it('accepts a bare-string aud', async () => {
    const { verify } = harness(() => [current]);
    const jwt = await token(current, { aud: AUD });
    expect(await verify(request(jwt), configured)).not.toBeNull();
  });

  it('caches the keys between requests', async () => {
    const { verify, calls } = harness(() => [current]);
    await verify(request(await token(current)), configured);
    await verify(request(await token(current)), configured);
    expect(calls).toHaveLength(1);
  });

  it('refuses a missing header', async () => {
    const { verify, calls } = harness(() => [current]);
    expect(await verify(request(), configured)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refuses the wrong audience', async () => {
    const { verify } = harness(() => [current]);
    const jwt = await token(current, { aud: ['someone-else'] });
    expect(await verify(request(jwt), configured)).toBeNull();
  });

  it('refuses the wrong issuer', async () => {
    const { verify } = harness(() => [current]);
    const jwt = await token(current, { iss: 'https://empire.example.com' });
    expect(await verify(request(jwt), configured)).toBeNull();
  });

  it('refuses an expired token and one not yet valid', async () => {
    const { verify } = harness(() => [current]);
    const expired = await token(current, { exp: NOW / 1000 - 3600 });
    expect(await verify(request(expired), configured)).toBeNull();
    const early = await token(current, { nbf: NOW / 1000 + 3600 });
    expect(await verify(request(early), configured)).toBeNull();
  });

  it('refuses a token without an email', async () => {
    const { verify } = harness(() => [current]);
    const jwt = await token(current, { email: undefined });
    expect(await verify(request(jwt), configured)).toBeNull();
  });

  it('refuses a forged signature', async () => {
    const { verify } = harness(() => [current]);
    expect(await verify(request(await token(stranger)), configured)).toBeNull();
  });

  it('refuses tampered claims', async () => {
    const { verify } = harness(() => [current]);
    const [h, , s] = (await token(current)).split('.');
    const forged = b64url(
      JSON.stringify({
        aud: [AUD],
        iss: ISS,
        email: 'vader@example.com',
        exp: NOW / 1000 + 60,
      }),
    );
    expect(await verify(request(`${h}.${forged}.${s}`), configured)).toBeNull();
  });

  it('refuses another algorithm and garbage', async () => {
    const { verify } = harness(() => [current]);
    const [, body, sig] = (await token(current)).split('.');
    const none = b64url(JSON.stringify({ alg: 'none', kid: 'key-1' }));
    expect(
      await verify(request(`${none}.${body}.${sig}`), configured),
    ).toBeNull();
    expect(await verify(request('not.a.jwt'), configured)).toBeNull();
    expect(await verify(request('nope'), configured)).toBeNull();
  });

  it('refetches once for an unknown kid (key rotation)', async () => {
    let published = [current];
    const h = harness(() => published);
    await h.verify(request(await token(current)), configured);
    expect(h.calls).toHaveLength(1);

    published = [current, rotated];
    h.advance(31_000);
    expect(
      (await h.verify(request(await token(rotated)), configured))?.email,
    ).toBe('leia@example.com');
    expect(h.calls).toHaveLength(2);
  });

  it('does not refetch on every unknown kid', async () => {
    const h = harness(() => [current]);
    const unknown = await signer('key-9');
    await h.verify(request(await token(current)), configured);
    expect(
      await h.verify(request(await token(unknown)), configured),
    ).toBeNull();
    expect(
      await h.verify(request(await token(unknown)), configured),
    ).toBeNull();
    // The first fetch is fresh, so neither unknown kid may refetch yet.
    expect(h.calls).toHaveLength(1);
    h.advance(31_000);
    expect(
      await h.verify(request(await token(unknown)), configured),
    ).toBeNull();
    expect(h.calls).toHaveLength(2);
  });

  it('ignores the dev bypass completely', async () => {
    const { verify } = harness(() => [current]);
    expect(
      await verify(
        request(undefined, { [DEV_EMAIL_HEADER]: 'han@example.com' }),
        configured,
      ),
    ).toBeNull();
  });

  it('fails closed without a team domain', async () => {
    const { verify } = harness(() => [current]);
    const env = { ...configured, ACCESS_TEAM_DOMAIN: '' };
    expect(await verify(request(await token(current)), env)).toBeNull();
  });

  it('fails closed when the certs endpoint is down', async () => {
    const verify = createAccessVerifier({
      now: () => NOW,
      fetch: async () => new Response('nope', { status: 503 }),
    });
    expect(await verify(request(await token(current)), configured)).toBeNull();
  });
});

describe('the dev bypass (ACCESS_AUD empty)', () => {
  const dev: Bindings = {
    ...base,
    ACCESS_AUD: '',
    ACCESS_TEAM_DOMAIN: '',
    DEV_ACCESS_EMAIL: 'Dev@Example.com',
  };

  it('signs in as DEV_ACCESS_EMAIL', async () => {
    const { verify, calls } = harness(() => []);
    expect(await verify(request(), dev)).toEqual({ email: 'dev@example.com' });
    expect(calls).toHaveLength(0);
  });

  it('lets the e2e header pick a per-test address', async () => {
    const { verify } = harness(() => []);
    const r = request(undefined, { [DEV_EMAIL_HEADER]: 'Test-7@E2E.test' });
    expect(await verify(r, dev)).toEqual({ email: 'test-7@e2e.test' });
  });

  it('has no session end unless the e2e header asks for one', async () => {
    const { verify } = harness(() => []);
    const r = request(undefined, { [DEV_SESSION_HEADER]: '2' });
    expect(await verify(r, dev)).toEqual({
      email: 'dev@example.com',
      expiresAt: NOW + 2000,
    });
    const bad = request(undefined, { [DEV_SESSION_HEADER]: 'soon' });
    expect(await verify(bad, dev)).toEqual({ email: 'dev@example.com' });
  });

  it('ignores the session header once Access is configured', async () => {
    const { verify } = harness(() => [current]);
    const r = request(await token(current), { [DEV_SESSION_HEADER]: '2' });
    expect((await verify(r, configured))?.expiresAt).toBe(
      NOW + 3600_000 + 60_000,
    );
  });

  it('refuses a header that is not an email', async () => {
    const { verify } = harness(() => []);
    const r = request(undefined, { [DEV_EMAIL_HEADER]: 'not an email' });
    expect(await verify(r, dev)).toBeNull();
  });

  it('refuses everything when DEV_ACCESS_EMAIL is not set either', async () => {
    const { verify } = harness(() => []);
    const bare = { ...dev, DEV_ACCESS_EMAIL: undefined };
    expect(await verify(request(), bare)).toBeNull();
    const r = request(undefined, { [DEV_EMAIL_HEADER]: 'han@example.com' });
    expect(await verify(r, bare)).toBeNull();
  });
});

describe('teamOrigin', () => {
  it('accepts the host with or without a scheme', () => {
    expect(teamOrigin(TEAM)).toBe(ISS);
    expect(teamOrigin(`https://${TEAM}/`)).toBe(ISS);
    expect(teamOrigin('  ')).toBe('');
  });
});
