import type { McpTool } from '../tool';
import { listSpaces, whoami } from './spaces';

/**
 * Every tool `/mcp` offers, in the order `tools/list` shows them. A new
 * tool is a `defineTool` in a file here, added to this list: reads (#153)
 * with `scope: 'read'`, writes (#154) with `scope: 'write'`. A token sees
 * and may call only the tools its scopes allow.
 */
export const TOOLS: readonly McpTool[] = [whoami, listSpaces];
