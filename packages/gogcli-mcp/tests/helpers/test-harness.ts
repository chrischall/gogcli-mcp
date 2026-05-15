// Shared test harness for tool registrars across base + sub-packages.
//
// `vi.mock(...)` must stay in the caller's test file because vitest hoists
// it at module scope, but the boilerplate around it lives here.
import { vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function toText(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function setupHandlers(
  register: (server: McpServer) => void,
): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  register(server);
  return handlers;
}
