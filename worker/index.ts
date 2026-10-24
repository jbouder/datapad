import type { AppConfig } from '#shared/protocol';
import { type AccessVerifier, verifyAccess } from './access';
import type { Bindings } from './env';

export { DatapadObject } from './datapad';

/**
 * Every request reaches this Worker first (`run_worker_first` in
 * wrangler.jsonc), static assets included. The first thing it does is check
 * Cloudflare Access; nothing, not even index.html, is served without a
 * verified email. That email, and only that email, names the user's
 * Durable Object.
 */

/**
 * On every response the Worker makes itself (static assets get theirs from
 * public/_headers). None of these is a page, so nothing may run, load or
 * frame it.
 */
export const API_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
} as const;

/** The handler, with the verifier injectable for tests. */
export function createHandler(verify: AccessVerifier) {
  return async function handle(
    request: Request,
    env: Bindings,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      const identity = await verify(request, env);
      if (!identity) {
        return unauthorized(pathname);
      }
      const { email } = identity;

      if (pathname === '/api/config') {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const config: AppConfig = { email };
        return json(config);
      }

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        return json({ error: 'Not found' }, 404);
      }

      if (pathname === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected a WebSocket upgrade', {
            status: 426,
            headers: API_HEADERS,
          });
        }
        // Upgrades travel as a fetch; RPC cannot carry a socket. The name
        // comes from the verified email and nowhere else.
        return env.DATAPAD.getByName(email).fetch(request);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          path: pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: 'Something went wrong' }, 500);
    }
  };
}

const handle = createHandler(verifyAccess);

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Bindings>;

/** JSON for the API, a short page for everything a browser navigates to. */
function unauthorized(pathname: string): Response {
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return json({ error: 'Sign in required' }, 401);
  }
  if (pathname === '/ws') {
    return new Response('Sign in required', {
      status: 401,
      headers: API_HEADERS,
    });
  }
  return new Response(SIGN_IN_PAGE, {
    status: 401,
    headers: {
      ...API_HEADERS,
      // The page has one inline style block and nothing else.
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

const SIGN_IN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in required · Datapad</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100dvh;
    display: grid; place-items: center; padding: 1.5rem; box-sizing: border-box; }
  main { max-width: 28rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
</style>
</head>
<body>
<main>
  <h1>Sign in required</h1>
  <p>Datapad is private. Open it through its Cloudflare Access sign-in, or ask
  its owner for access.</p>
</main>
</body>
</html>
`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...API_HEADERS,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
