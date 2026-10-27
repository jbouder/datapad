import { z } from 'zod';
import { version } from '../../package.json';
import {
  type CallToolResult,
  callTool,
  type McpTool,
  type McpToolContext,
  toolDescriptor,
  toolFailure,
} from './tool';

/**
 * The MCP wire protocol at `/mcp` (#152), after holotable's: JSON-RPC 2.0
 * over the Streamable HTTP transport, in its stateless form.
 *
 * Stateless on purpose. Every call arrives on its own bearer token, so
 * there is nothing a session would add: no `Mcp-Session-Id`, no
 * server-initiated stream (a GET is 405), and every POST is answered with
 * one JSON body, which the transport allows. The server half that applies
 * is `initialize`, `ping`, `tools/list` and `tools/call`, which is why it
 * is this file rather than a dependency; the official SDK's client drives
 * it in `test/mcp.test.ts`.
 *
 * The version is negotiated in `initialize` and then stated by the client
 * in `MCP-Protocol-Version`; an unsupported one is a 400, as the transport
 * requires. JSON-RPC batches were dropped in 2025-06-18 and are refused.
 */

export const PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
] as const;
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

export const SERVER_INFO = {
  name: 'datapad',
  title: 'Datapad',
  version,
} as const;

/** One tool call's arguments are well under this. */
export const MAX_BODY_BYTES = 256 * 1024;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const RequestId = z.union([z.string(), z.number()]);
type RequestId = z.infer<typeof RequestId>;
const Params = z.record(z.string(), z.unknown());

/** A request or a notification; a response from the client is ignored. */
const Message = z.object({
  jsonrpc: z.literal('2.0'),
  id: RequestId.optional(),
  method: z.string().optional(),
  params: Params.optional(),
});

const InitializeParams = z.object({
  protocolVersion: z.string(),
  clientInfo: z
    .object({ name: z.string(), version: z.string().optional() })
    .optional(),
});

const CallParams = z.object({
  name: z.string(),
  arguments: Params.optional(),
});

export interface McpServer {
  tools: readonly McpTool[];
  context: McpToolContext;
  /** Shown to the model at `initialize`: how the tools fit together. */
  instructions: string;
  /** Counts one tool call; false when the caller is over the limit. */
  admit(): Promise<boolean>;
  /** What the model is told when `admit` says no. */
  limited: string;
}

/** The headers every `/mcp` answer carries. */
export const MCP_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
} as const;

function reply(id: RequestId | null, result: unknown, status = 200): Response {
  return Response.json(
    { jsonrpc: '2.0', id, result },
    { status, headers: MCP_HEADERS },
  );
}

function refuse(
  id: RequestId | null,
  code: number,
  message: string,
  status = 200,
): Response {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status, headers: MCP_HEADERS },
  );
}

/** A notification, or a response to a request never made: taken, not answered. */
function accepted(): Response {
  return new Response(null, { status: 202, headers: MCP_HEADERS });
}

/** Anything but a POST: there is no stream to open and no session to end. */
export function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { allow: 'POST', ...MCP_HEADERS },
  });
}

/** The tools this caller's scopes allow. */
export function visibleTools(server: McpServer): McpTool[] {
  return server.tools.filter((t) => server.context.scopes.includes(t.scope));
}

async function readBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Handle one POST to `/mcp` for an already authenticated caller. */
export async function handleMcpPost(
  request: Request,
  server: McpServer,
): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) {
    return refuse(
      null,
      PARSE_ERROR,
      'The body is not a JSON-RPC message',
      body.status,
    );
  }
  if (Array.isArray(body.value)) {
    return refuse(
      null,
      INVALID_REQUEST,
      'JSON-RPC batches are not supported',
      400,
    );
  }
  const message = Message.safeParse(body.value);
  if (!message.success) {
    return refuse(
      null,
      INVALID_REQUEST,
      'The body is not a JSON-RPC message',
      400,
    );
  }
  const { id, method, params } = message.data;
  if (method === undefined || id === undefined) return accepted();

  const stated = request.headers.get('mcp-protocol-version');
  if (
    method !== 'initialize' &&
    stated !== null &&
    !(PROTOCOL_VERSIONS as readonly string[]).includes(stated)
  ) {
    return refuse(
      id,
      INVALID_REQUEST,
      `Unsupported MCP-Protocol-Version ${JSON.stringify(stated)}; this server speaks ${PROTOCOL_VERSIONS.join(', ')}`,
      400,
    );
  }

  switch (method) {
    case 'initialize': {
      const init = InitializeParams.safeParse(params ?? {});
      if (!init.success) {
        return refuse(id, INVALID_PARAMS, 'initialize needs protocolVersion');
      }
      const asked = init.data.protocolVersion;
      // A version this server speaks is answered as asked; any other with
      // the newest, and the client decides whether it can talk to that.
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(
        asked,
      )
        ? asked
        : LATEST_PROTOCOL_VERSION;
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: server.instructions,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: visibleTools(server).map(toolDescriptor) });
    case 'tools/call': {
      const call = CallParams.safeParse(params ?? {});
      if (!call.success) {
        return refuse(id, INVALID_PARAMS, 'tools/call needs a tool name');
      }
      const tool = server.tools.find((t) => t.name === call.data.name);
      if (!tool) {
        return refuse(id, INVALID_PARAMS, `Unknown tool: ${call.data.name}`);
      }
      let result: CallToolResult;
      if (!server.context.scopes.includes(tool.scope)) {
        result = toolFailure(
          `${tool.name} needs the "${tool.scope}" scope, which this connection was not granted. Reconnect and allow it on the consent page.`,
        );
      } else if (!(await server.admit())) {
        result = toolFailure(server.limited);
      } else {
        result = await callTool(tool, call.data.arguments, server.context);
      }
      return reply(id, result);
    }
    default:
      return refuse(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
