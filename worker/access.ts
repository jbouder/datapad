import type { Bindings } from './env';

/**
 * Cloudflare Access, checked again in the Worker.
 *
 * Access at the edge handles login and sessions and adds a signed JWT to
 * every request it lets through (`Cf-Access-Jwt-Assertion`). This module
 * verifies that JWT on every request (RS256 against the team's published
 * keys, plus `aud`, `iss`, `exp` and `nbf`), so a hostname Access does not
 * cover fails closed instead of serving someone's data.
 *
 * The verified `email`, lowercased, is the only thing that names a Durable
 * Object (see worker/index.ts).
 *
 * Local development: with ACCESS_AUD empty *and* DEV_ACCESS_EMAIL set (only
 * ever in .dev.vars) the check is bypassed and that email is used, or the
 * `x-dev-access-email` header when present (the e2e suite gives each test
 * its own Durable Object that way, and `x-dev-session-seconds` a session
 * that ends soon, to test a socket outliving it). With ACCESS_AUD set there
 * is no bypass; with neither set, everything is refused.
 *
 * A verified identity carries when it stops being accepted (`expiresAt`);
 * a socket opened with it is closed after that (#228, docs/security.md).
 */

export interface AccessIdentity {
  email: string;
  /**
   * When this identity stops being accepted, ms since the epoch: the
   * token's `exp` plus the leeway below. A socket opened with it is closed
   * after that (#228). Absent in the dev bypass, where the socket gets the
   * Worker's maximum age instead.
   */
  expiresAt?: number;
}

/**
 * How long a socket may live when the identity carries no expiry (the dev
 * bypass, or a test's verifier): a day, Access's default session.
 */
export const SOCKET_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
export const DEV_EMAIL_HEADER = 'x-dev-access-email';
/**
 * Dev bypass only: end this "session" after so many seconds, so the e2e
 * suite can watch a socket outlive its session without a fake clock.
 */
export const DEV_SESSION_HEADER = 'x-dev-session-seconds';

/** Keys are refetched after this long even when every kid is known. */
const JWKS_TTL_MS = 10 * 60 * 1000;
/** An unknown kid refetches at most this often (a bad token cannot hammer). */
const REFETCH_MIN_MS = 30 * 1000;
/** Clock skew tolerated on `exp` and `nbf`. */
const LEEWAY_S = 60;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

interface Header {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface Claims {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
}

export interface VerifierOptions {
  /** Defaults to the global fetch. Tests count calls through this. */
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

export type AccessVerifier = (
  request: Request,
  env: Bindings,
) => Promise<AccessIdentity | null>;

/** `https://<team>.cloudflareaccess.com`, from either spelling of the var. */
export function teamOrigin(domain: string): string {
  const host = domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return host ? `https://${host}` : '';
}

/**
 * A verifier with its own key cache. The Worker uses one per isolate
 * (`verifyAccess` below); tests make their own with a fake fetch and clock.
 */
export function createAccessVerifier(
  options: VerifierOptions = {},
): AccessVerifier {
  const doFetch = options.fetch ?? ((...args) => fetch(...args));
  const now = options.now ?? Date.now;
  const cache = new Map<string, KeySet>();
  let warned = false;

  async function loadKeys(origin: string): Promise<KeySet> {
    const response = await doFetch(`${origin}/cdn-cgi/access/certs`);
    if (!response.ok) {
      throw new Error(`Access certs answered ${response.status}`);
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(jwk.kid, key);
    }
    const set = { keys, fetchedAt: now() };
    cache.set(origin, set);
    return set;
  }

  async function keyFor(origin: string, kid: string): Promise<CryptoKey> {
    let set = cache.get(origin);
    if (!set || now() - set.fetchedAt > JWKS_TTL_MS) {
      set = await loadKeys(origin);
    }
    let key = set.keys.get(kid);
    if (!key && now() - set.fetchedAt >= REFETCH_MIN_MS) {
      // Keys rotate; a kid we have not seen may be the new one.
      set = await loadKeys(origin);
      key = set.keys.get(kid);
    }
    if (!key) {
      throw new Error('Unknown signing key');
    }
    return key;
  }

  function devBypass(request: Request, env: Bindings): AccessIdentity | null {
    const fallback = env.DEV_ACCESS_EMAIL?.trim().toLowerCase() ?? '';
    if (!fallback) {
      return null;
    }
    if (!warned) {
      warned = true;
      console.warn(
        JSON.stringify({
          level: 'warn',
          message:
            'ACCESS DISABLED: ACCESS_AUD is empty and DEV_ACCESS_EMAIL is set. ' +
            'Every request is treated as signed in. Local development only.',
        }),
      );
    }
    const asked =
      request.headers.get(DEV_EMAIL_HEADER)?.trim().toLowerCase() ?? '';
    const email = asked || fallback;
    if (!EMAIL.test(email)) return null;
    const seconds = Number(request.headers.get(DEV_SESSION_HEADER) ?? '');
    return seconds > 0
      ? { email, expiresAt: now() + seconds * 1000 }
      : { email };
  }

  return async (request, env) => {
    const aud = env.ACCESS_AUD?.trim() ?? '';
    if (!aud) {
      return devBypass(request, env);
    }
    const origin = teamOrigin(env.ACCESS_TEAM_DOMAIN ?? '');
    const token = request.headers.get(ACCESS_HEADER);
    if (!origin || !token) {
      return null;
    }
    try {
      const claims = await verifyJwt(token, (kid) => keyFor(origin, kid));
      const seconds = now() / 1000;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(aud)) return null;
      if (claims.iss !== origin) return null;
      if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < seconds) {
        return null;
      }
      if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_S > seconds) {
        return null;
      }
      const email = claims.email?.trim().toLowerCase() ?? '';
      if (!EMAIL.test(email)) return null;
      return { email, expiresAt: (claims.exp + LEEWAY_S) * 1000 };
    } catch {
      return null;
    }
  };
}

/** The signature check. Throws on anything malformed. */
async function verifyJwt(
  token: string,
  keyFor: (kid: string) => Promise<CryptoKey>,
): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [rawHeader, rawClaims, rawSignature] = parts;
  const header = JSON.parse(text(rawHeader)) as Header;
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported token');
  }
  const key = await keyFor(header.kid);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    bytes(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawClaims}`),
  );
  if (!valid) {
    throw new Error('Bad signature');
  }
  return JSON.parse(text(rawClaims)) as Claims;
}

function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function text(base64url: string): string {
  return new TextDecoder().decode(bytes(base64url));
}

/** The Worker's verifier: one key cache per isolate. */
export const verifyAccess: AccessVerifier = createAccessVerifier();
