import { LIMITS } from '#shared/limits';
import type { AppConfig, BackupList, ImportResult } from '#shared/protocol';
import { type AccessVerifier, verifyAccess } from './access';
import type { DatapadObject } from './datapad';
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

      // One backup file: /api/backups/YYYY-MM-DD.json
      const backup = /^\/api\/backups\/(\d{4}-\d{2}-\d{2})\.json$/.exec(
        pathname,
      );
      if (backup?.[1]) {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const text = await env.DATAPAD.getByName(email).readBackup(backup[1]);
        if (text === null)
          return json({ error: 'No backup for that day' }, 404);
        return new Response(text, {
          headers: {
            ...API_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="datapad-${backup[1]}.json"`,
          },
        });
      }

      if (pathname.startsWith('/api/')) {
        const route = API_ROUTES[pathname];
        if (route) {
          if (request.method !== route.method) {
            return json({ error: 'Method not allowed' }, 405);
          }
          if (route.method === 'POST') {
            const refused = refuseCrossSite(request);
            if (refused) return refused;
          }
          // The name comes from the verified email and nowhere else.
          return route.handle(request, env.DATAPAD.getByName(email));
        }
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

type Datapad = DurableObjectStub<DatapadObject>;

interface ApiRoute {
  method: 'GET' | 'POST';
  handle: (request: Request, datapad: Datapad) => Promise<Response>;
}

/** The data routes. Each runs on the signed-in user's object over RPC. */
const API_ROUTES: Record<string, ApiRoute> = {
  '/api/export.json': {
    method: 'GET',
    handle: async (_request, datapad) => {
      const file = await datapad.export();
      const day = file.exportedAt.slice(0, 10);
      return new Response(JSON.stringify(file, null, 2), {
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="datapad-${day}.json"`,
        },
      });
    },
  },
  '/api/import': {
    method: 'POST',
    handle: async (request, datapad) => {
      const body = await readJson(request);
      if (!body.ok) {
        return json({ error: body.error }, body.status);
      }
      const outcome = await datapad.import(body.value);
      if (!outcome.ok) {
        return json({ error: outcome.error }, 400);
      }
      const result: ImportResult = { imported: outcome.imported };
      return json(result);
    },
  },
  '/api/backups': {
    method: 'GET',
    handle: async (_request, datapad) => {
      const list: BackupList = await datapad.backups();
      return json(list);
    },
  },
  '/api/backups/restore': {
    method: 'POST',
    handle: async (request, datapad) => {
      const body = await readJson(request);
      const day =
        body.ok && typeof body.value === 'object' && body.value !== null
          ? (body.value as { day?: unknown }).day
          : undefined;
      if (typeof day !== 'string') {
        return json({ error: 'Say which day to restore' }, 400);
      }
      const outcome = await datapad.restoreBackup(day);
      if (!outcome.ok) {
        return json({ error: outcome.error }, 404);
      }
      const result: ImportResult = { imported: outcome.imported };
      return json(result);
    },
  },
  '/api/erase-token': {
    method: 'GET',
    handle: async (_request, datapad) => json(await datapad.eraseToken()),
  },
  '/api/erase': {
    method: 'POST',
    handle: async (request, datapad) => {
      const body = await readJson(request);
      const token =
        body.ok && typeof body.value === 'object' && body.value !== null
          ? (body.value as { token?: unknown }).token
          : undefined;
      if (typeof token !== 'string' || !(await datapad.erase(token))) {
        return json(
          { error: 'That confirmation has expired. Ask for a new one.' },
          403,
        );
      }
      return json({ erased: true });
    },
  },
};

/**
 * Writes must come from this origin as JSON. A cross-site form can send
 * neither `application/json` nor a matching `Origin`, so the Access cookie
 * alone can never import into or erase someone's data (CSRF).
 */
function refuseCrossSite(request: Request): Response | null {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: 'Cross-site request refused' }, 403);
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Send JSON' }, 415);
  }
  return null;
}

type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string };

/** The body as JSON, refused when larger than an import may be. */
async function readJson(request: Request): Promise<JsonBody> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > LIMITS.importBytes) {
    return { ok: false, status: 413, error: 'That file is too large' };
  }
  const text = await request.text();
  if (text.length > LIMITS.importBytes) {
    return { ok: false, status: 413, error: 'That file is too large' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'That file is not JSON' };
  }
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
