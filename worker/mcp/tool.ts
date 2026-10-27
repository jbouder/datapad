import { z } from 'zod';
import { MAIN_SPACE } from '#shared/types';
import { type DatapadObject, isNoSuchSpace } from '../datapad';
import type { Scope } from './oauth';

/**
 * What an MCP tool is (#152), after holotable's: a thin, typed façade over
 * an RPC the Durable Object already has. It carries no authority of its
 * own: `ctx.datapad` is the object the token's verified email named, and
 * no argument can name another.
 *
 * The input schema is the one contract: it validates what the client sent
 * and, as JSON Schema, is what `tools/list` shows, so the two cannot
 * drift. A tool's failure (an argument the schema refuses, an unknown
 * space, a `ToolError`, the rate limit) comes back as a result with
 * `isError`, which the model can read and act on, never as a protocol
 * error. Anything unexpected is logged and answered with an opaque line.
 *
 * Adding a tool: write it with `defineTool` in a file under `tools/` and
 * add it to `TOOLS` in `tools/index.ts`. `tools/list` and `tools/call`
 * pick it up; `test/mcp.test.ts` checks the list.
 */

export interface McpToolContext {
  /** The verified email the token was issued to. */
  email: string;
  /** What the owner granted on the consent page. */
  scopes: readonly Scope[];
  /** That email's Durable Object, and only that. */
  datapad: DurableObjectStub<DatapadObject>;
}

/** The protocol's tool annotations: hints, never authority. */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export interface McpTool<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodType = z.ZodType,
> {
  name: string;
  title: string;
  description: string;
  /** The scope a token needs to see and call this tool. */
  scope: Scope;
  /** Validates the arguments and, as JSON Schema, documents them. */
  input: I;
  /**
   * Declared only when every result matches it exactly: a client may
   * validate `structuredContent` against it and refuse the call otherwise.
   */
  output?: O;
  annotations: McpToolAnnotations;
  run(args: z.output<I>, ctx: McpToolContext): Promise<z.output<O>>;
}

/** Infers the argument and result types from the schemas. */
export function defineTool<I extends z.ZodObject, O extends z.ZodType>(
  tool: McpTool<I, O>,
): McpTool {
  return tool as unknown as McpTool;
}

/**
 * A failure that is the caller's to fix (an unknown space, a name that
 * matches nothing). Its message goes to the model as it is, so it names
 * the cause and never carries anything the caller could not already see.
 */
export class ToolError extends Error {}

/** The space a tool works on: `main` when the caller names none. */
export const SpaceArg = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe('A space id from list_spaces. Defaults to "main".');

/**
 * The space id `asked` for, checked against the caller's own spaces; a
 * `ToolError` naming `list_spaces` when it is not one of them.
 */
export async function requireSpace(
  ctx: McpToolContext,
  asked: string | undefined,
): Promise<string> {
  const space = asked ?? MAIN_SPACE;
  if (!(await ctx.datapad.hasSpace(space))) {
    throw new ToolError(
      `There is no space "${space}". Call list_spaces for the ids.`,
    );
  }
  return space;
}

/** A zod schema as the JSON Schema a client is shown. */
export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  });
  return rest;
}

/** One entry of a `tools/list` result. */
export function toolDescriptor(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toolJsonSchema(tool.input),
    ...(tool.output ? { outputSchema: toolJsonSchema(tool.output) } : {}),
    annotations: tool.annotations,
  };
}

export interface CallToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const MAX_ISSUES = 10;

/** A result the model reads as a failure. */
export function toolFailure(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Validate the arguments, run the tool, and report either way. */
export async function callTool(
  tool: McpTool,
  args: unknown,
  ctx: McpToolContext,
): Promise<CallToolResult> {
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, MAX_ISSUES)
      .map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
      );
    return toolFailure(`Invalid arguments: ${issues.join('; ')}`);
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof ToolError) return toolFailure(error.message);
    if (isNoSuchSpace(error)) {
      // The object's backstop for a space deleted mid-call.
      return toolFailure('That space no longer exists. Call list_spaces.');
    }
    console.error(
      JSON.stringify({
        level: 'error',
        path: '/mcp',
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return toolFailure('The tool failed; the server log has the details.');
  }
}
