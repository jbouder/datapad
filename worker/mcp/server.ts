import type { OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { LIMITS } from '#shared/limits';
import { type Bindings, ownerTimeZone } from '../env';
import type { McpProps, Scope } from './oauth';
import { SCOPES } from './oauth';
import { handleMcpPost, MCP_HEADERS, methodNotAllowed } from './protocol';
import { TOOLS } from './tools';

/**
 * `/mcp` once the provider has admitted the bearer (#152). The provider
 * calls this only with a token it issued, unexpired and unrevoked, for
 * this origin's `/mcp`; a request with no bearer (an Access cookie, say)
 * never gets here. The Durable Object is named by `props.email`, which
 * only `completeAuthorization()` behind Access ever wrote.
 */

/** Handed to the model at `initialize`. */
export const INSTRUCTIONS = [
  'Datapad is one person’s project tracker: projects, tasks, notes, meetings with topics, milestones, people and orgs.',
  'The data is split into spaces, each a complete, separate Datapad. Call list_spaces first; "main" is the default, and every tool that reads or changes data takes a `space` (its id or name).',
  'Then get_overview for the space at a glance, or get_focus for what needs doing today. Then the specific reads: get_project for one project in full; list_tasks, list_notes, list_meetings, list_projects, list_people, list_orgs to filter; get_digest for a week; search to find anything by its words.',
  'Ids are opaque strings; never invent one, read it from a tool result. Dates are YYYY-MM-DD in the owner’s day; timestamps are ISO 8601. Text shows mentions as @Name.',
  'Projects, people, orgs and meetings can be named instead of given by id where a tool says so: a name matches ignoring case, or by a unique part of it. A name that matches several returns the candidates; pick an id from them rather than guessing.',
  'Lists carry at most 200 items, with `count` (how many there were) and `truncated`; narrow the filters when a list is cut.',
  'Read before you write: look up what is there, then change it.',
  'With the write scope: add_task, complete_task, reopen_task, edit_task, set_blocked, add_note, add_meeting, add_topic, cover_topic, create_project, set_project_status, set_project_health, add_milestone. Each makes one change, shows up live in the app, and returns the document as it now is and the activity line it wrote. Dates may be words relative to today ("tomorrow", "fri", "+3d"); mentions are written as @Name.',
  'Nothing can be deleted, archived, erased, imported, restored or moved between spaces from here, and neither spaces nor settings can be changed: those stay in the app.',
].join('\n');

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The counter key for a token: a hash of it, never the token itself. */
async function tokenKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export const mcpApiHandler = {
  async fetch(
    request: Request,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { props, auth } = ctx as OAuthResourceContext<McpProps>;
    const email =
      typeof props?.email === 'string' ? props.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) {
      // Not a grant this Worker wrote. Fail closed.
      return new Response('Unauthorized', {
        status: 401,
        headers: MCP_HEADERS,
      });
    }
    if (request.method !== 'POST') return methodNotAllowed();

    const scopes = SCOPES.filter((s) => auth.scope.includes(s)) as Scope[];
    // The name comes from the verified email in the grant and nowhere else.
    const datapad = env.DATAPAD.getByName(email);
    const key = await tokenKey(auth.token);
    try {
      return await handleMcpPost(request, {
        tools: TOOLS,
        context: {
          email,
          scopes,
          datapad,
          timeZone: ownerTimeZone(env),
        },
        instructions: INSTRUCTIONS,
        admit: () => datapad.admitMcpCall(key, Date.now(), auth.clientId),
        limited: `Rate limited: at most ${LIMITS.mcpCallsPerMinute} tool calls a minute per connection. Wait a minute and try again.`,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          path: '/mcp',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Something went wrong' },
        },
        { status: 500, headers: MCP_HEADERS },
      );
    }
  },
};
