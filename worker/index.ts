import type { z } from 'zod';
import { LIMITS } from '#shared/limits';
import {
  type AppConfig,
  type BackupList,
  type ConnectionList,
  type CreatedSpace,
  CreateSpaceSchema,
  DeleteSpaceSchema,
  describeIssue,
  type ImportResult,
  MoveProjectSchema,
  RenameSpaceSchema,
  ReorderSpacesSchema,
  type SpaceList,
} from '#shared/protocol';
import { MAIN_SPACE } from '#shared/types';
import { type AccessVerifier, verifyAccess } from './access';
import { type DatapadObject, isNoSuchSpace } from './datapad';
import type { Bindings } from './env';
import { authorize } from './mcp/authorize';
import { listConnections, revokeConnection } from './mcp/connections';
import {
  AUTHORIZE_PATH,
  isProviderPath,
  limitRegistration,
  providerFor,
} from './mcp/oauth';

export { DatapadObject } from './datapad';

/**
 * Every request reaches this Worker first (`run_worker_first` in
 * wrangler.jsonc), static assets included. The first thing it does is check
 * Cloudflare Access; nothing, not even index.html, is served without a
 * verified email. That email, and only that email, names the user's
 * Durable Object.
 *
 * Inside that object the user's documents are split into spaces. The data
 * routes and the socket take a `?space=` to pick one (`main` when there is
 * none). A space id is not a credential and never names the object: it
 * only chooses among the spaces of the object the email already named, so
 * the worst a forged one can do is reach another of your own spaces, or
 * get a 404.
 *
 * The one exception to "Access first" is MCP (#152, worker/mcp/): `/mcp`,
 * `/oauth/token`, `/oauth/register` and `/.well-known/oauth-*` go to the
 * OAuth provider instead (`createWorker` below), because an MCP client
 * cannot sign in with Access. They still fail closed: `/mcp` admits only a
 * bearer token the provider issued, and a token is issued only after the
 * owner approved the client at `/oauth/authorize`, which is behind Access
 * like every other path. The email in a token comes from that verified
 * identity and nowhere else.
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

      // The MCP sign-in: behind Access, like everything below.
      if (pathname === AUTHORIZE_PATH) {
        return await authorize(request, env, identity);
      }

      if (pathname === '/api/config') {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const config: AppConfig = { email };
        return json(config);
      }

      // Settings → Connected apps (#154): this email's MCP grants. The
      // grant id only picks among them; it is not a credential.
      if (pathname === '/api/connections') {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const list: ConnectionList = {
          connections: await listConnections(
            request,
            env,
            email,
            env.DATAPAD.getByName(email),
          ),
        };
        return json(list);
      }
      const connection = /^\/api\/connections\/([^/]+)$/.exec(pathname);
      if (connection?.[1]) {
        if (request.method !== 'DELETE') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const refused = refuseCrossSite(request);
        if (refused) return refused;
        const revoked = await revokeConnection(
          request,
          env,
          email,
          env.DATAPAD.getByName(email),
          connection[1],
        );
        if (!revoked) return json({ error: 'No such connection' }, 404);
        return json({ revoked: true });
      }

      // One backup file: /api/backups/YYYY-MM-DD.json
      const backup = /^\/api\/backups\/(\d{4}-\d{2}-\d{2})\.json$/.exec(
        pathname,
      );
      if (backup?.[1]) {
        if (request.method !== 'GET') {
          return json({ error: 'Method not allowed' }, 405);
        }
        const datapad = env.DATAPAD.getByName(email);
        const space = spaceOf(request);
        if (!(await datapad.hasSpace(space))) return noSuchSpace();
        const text = await datapad.readBackup(space, backup[1]);
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
          // The name comes from the verified email and nowhere else; the
          // space only picks within that object.
          const datapad = env.DATAPAD.getByName(email);
          const space = spaceOf(request);
          if (route.scoped && !(await datapad.hasSpace(space))) {
            return noSuchSpace();
          }
          // Awaited so a space deleted since the check still reaches the
          // catch below as a 404.
          return await route.handle(request, datapad, space);
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
        // A browser always sends Origin on a WebSocket handshake, and the
        // handshake is not subject to CORS, so this is the only thing that
        // stops another site (a sibling subdomain is same-site, so a Lax
        // Access cookie goes with it) from reading and writing everything.
        if (isCrossSite(request)) {
          return new Response('Cross-site request refused', {
            status: 403,
            headers: API_HEADERS,
          });
        }
        // Upgrades travel as a fetch; RPC cannot carry a socket. The name
        // comes from the verified email and nowhere else. The request goes
        // on with its query, whose `space` the object reads (falling back
        // to the first space, never to another object).
        return env.DATAPAD.getByName(email).fetch(request);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      // Every scoped call refuses a space this user does not have.
      if (isNoSuchSpace(error)) return noSuchSpace();
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
  /** Works on one space, `spaceOf(request)`, which must exist. */
  scoped: boolean;
  handle: (
    request: Request,
    datapad: Datapad,
    space: string,
  ) => Promise<Response>;
}

/**
 * The space a data route works on: its `space` query parameter, else
 * `main`, so a client that predates spaces keeps working unchanged. Not a
 * credential (see the top of this file).
 */
export function spaceOf(request: Request): string {
  return new URL(request.url).searchParams.get('space') || MAIN_SPACE;
}

/**
 * The data routes. Each runs on the signed-in user's object over RPC, and
 * all but the `/api/spaces` ones on one of its spaces; an unknown space is
 * a 404.
 */
const API_ROUTES: Record<string, ApiRoute> = {
  // Is this user's object reachable? Behind Access like everything else,
  // so a signed-out client gets 401 (or Access's redirect) here too, which
  // is how the app tells a lapsed session from a dropped socket. It says
  // nothing about the data.
  '/api/health': {
    method: 'GET',
    scoped: false,
    handle: async (_request, datapad) => {
      try {
        await datapad.ping();
        return json({ ok: true });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            what: 'health',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return json({ ok: false, error: 'Datapad is not reachable' }, 503);
      }
    },
  },
  '/api/spaces': {
    method: 'GET',
    scoped: false,
    handle: async (_request, datapad) => {
      const list: SpaceList = await datapad.listSpaces();
      return json(list);
    },
  },
  // The space routes below are not scoped: the space they change is in
  // the body, checked like `?space=` is (the object also throws for an
  // unknown one, which the catch above answers with the same 404).
  '/api/spaces/create': {
    method: 'POST',
    scoped: false,
    handle: async (request, datapad) => {
      const body = await readBody(request, CreateSpaceSchema);
      if (!body.ok) return body.response;
      const outcome = await datapad.createSpace(body.value.name);
      if (!outcome.ok) return json({ error: outcome.error }, 400);
      const created: CreatedSpace = { space: outcome.value };
      return json(created);
    },
  },
  '/api/spaces/rename': {
    method: 'POST',
    scoped: false,
    handle: async (request, datapad) => {
      const body = await readBody(request, RenameSpaceSchema);
      if (!body.ok) return body.response;
      if (!(await datapad.hasSpace(body.value.id))) return noSuchSpace();
      const outcome = await datapad.renameSpace(body.value.id, body.value.name);
      if (!outcome.ok) return json({ error: outcome.error }, 400);
      const list: SpaceList = outcome.value;
      return json(list);
    },
  },
  '/api/spaces/reorder': {
    method: 'POST',
    scoped: false,
    handle: async (request, datapad) => {
      const body = await readBody(request, ReorderSpacesSchema);
      if (!body.ok) return body.response;
      const outcome = await datapad.reorderSpaces(body.value.ids);
      if (!outcome.ok) return json({ error: outcome.error }, 400);
      const list: SpaceList = outcome.value;
      return json(list);
    },
  },
  /**
   * Delete a space and everything in it. The token comes from
   * `GET /api/erase-token?space=<id>`, issued for that space, and is used
   * up either way: 403 when it is wrong, expired or for another space,
   * 400 for the last space, which cannot go.
   */
  '/api/spaces/delete': {
    method: 'POST',
    scoped: false,
    handle: async (request, datapad) => {
      const body = await readBody(request, DeleteSpaceSchema);
      if (!body.ok) return body.response;
      if (!(await datapad.hasSpace(body.value.id))) return noSuchSpace();
      const outcome = await datapad.deleteSpace(
        body.value.id,
        body.value.token,
      );
      if (!outcome.ok) {
        return json(
          { error: outcome.error },
          outcome.why === 'token' ? 403 : 400,
        );
      }
      return json({ deleted: true });
    },
  },
  /**
   * Move a project, with everything that hangs off it, from one of your
   * spaces to another: 404 when either space is unknown, 400 with the
   * reason for the same space twice or a project that is gone.
   */
  '/api/spaces/move-project': {
    method: 'POST',
    scoped: false,
    handle: async (request, datapad) => {
      const body = await readBody(request, MoveProjectSchema);
      if (!body.ok) return body.response;
      const { from, to, id } = body.value;
      if (!(await datapad.hasSpace(from)) || !(await datapad.hasSpace(to))) {
        return noSuchSpace();
      }
      const outcome = await datapad.moveProject(from, to, id);
      if (!outcome.ok) return json({ error: outcome.error }, 400);
      return json({ moved: true });
    },
  },
  '/api/export.json': {
    method: 'GET',
    scoped: true,
    handle: async (_request, datapad, space) => {
      const file = await datapad.export(space);
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
    scoped: true,
    handle: async (request, datapad, space) => {
      const body = await readJson(request);
      if (!body.ok) {
        return json({ error: body.error }, body.status);
      }
      const outcome = await datapad.import(space, body.value);
      if (!outcome.ok) {
        return json({ error: outcome.error }, 400);
      }
      const result: ImportResult = { imported: outcome.imported };
      return json(result);
    },
  },
  '/api/backups': {
    method: 'GET',
    scoped: true,
    handle: async (_request, datapad, space) => {
      const list: BackupList = await datapad.backups(space);
      return json(list);
    },
  },
  '/api/backups/restore': {
    method: 'POST',
    scoped: true,
    handle: async (request, datapad, space) => {
      const body = await readJson(request);
      const day =
        body.ok && typeof body.value === 'object' && body.value !== null
          ? (body.value as { day?: unknown }).day
          : undefined;
      if (typeof day !== 'string') {
        return json({ error: 'Say which day to restore' }, 400);
      }
      const outcome = await datapad.restoreBackup(space, day);
      if (!outcome.ok) {
        return json({ error: outcome.error }, 404);
      }
      const result: ImportResult = { imported: outcome.imported };
      return json(result);
    },
  },
  '/api/erase-token': {
    method: 'GET',
    scoped: true,
    handle: async (_request, datapad, space) =>
      json(await datapad.eraseToken(space)),
  },
  '/api/erase': {
    method: 'POST',
    scoped: true,
    handle: async (request, datapad, space) => {
      const body = await readJson(request);
      const token =
        body.ok && typeof body.value === 'object' && body.value !== null
          ? (body.value as { token?: unknown }).token
          : undefined;
      if (typeof token !== 'string' || !(await datapad.erase(space, token))) {
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
  if (isCrossSite(request)) {
    return json({ error: 'Cross-site request refused' }, 403);
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Send JSON' }, 415);
  }
  return null;
}

/**
 * An `Origin` other than this one (`null` included). A request without one
 * is not from a page on another site: browsers send it on every
 * cross-origin request, every `POST` and every WebSocket handshake.
 */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== new URL(request.url).origin;
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

type Body<T> = { ok: true; value: T } | { ok: false; response: Response };

/** A small JSON body checked against a schema; 400 with the first problem. */
async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<Body<T>> {
  const body = await readJson(request);
  if (!body.ok) {
    return { ok: false, response: json({ error: body.error }, body.status) };
  }
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      response: json(
        { error: issue ? describeIssue(issue) : 'That request is not valid' },
        400,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * The Worker, with the verifier injectable for tests: the OAuth provider's
 * own paths first (and only those, `isProviderPath`), everything else
 * through `createHandler`, Access first.
 */
export function createWorker(verify: AccessVerifier) {
  const handle = createHandler(verify);
  return {
    async fetch(
      request: Request,
      env: Bindings,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (isProviderPath(pathname)) {
        try {
          const limited = await limitRegistration(request, env);
          if (limited) return withApiHeaders(limited);
          return withApiHeaders(
            await providerFor(request).fetch(request, env, ctx),
          );
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
      }
      return handle(request, env);
    },
  } satisfies ExportedHandler<Bindings>;
}

/** The provider's answers, with whichever of `API_HEADERS` they lack. */
function withApiHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(API_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}

export default createWorker(verifyAccess);

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

function noSuchSpace(): Response {
  return json({ error: 'No such space' }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...API_HEADERS,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
