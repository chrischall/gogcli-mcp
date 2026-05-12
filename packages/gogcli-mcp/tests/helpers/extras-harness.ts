// Shared test harness for `*-extra.ts` registrars across sub-packages.
//
// Each sub-package's extras test file follows the same shape: mock the
// `runOrDiagnose` export from `gogcli-mcp/lib`, register the extras tools onto
// a stub `McpServer`, capture each tool's handler into a Map, and exercise the
// handlers with sample inputs. The `vi.mock(...)` call must stay in the
// caller's test file (vitest hoists it at the module scope), but the
// boilerplate around it can live here.
import { vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function toText(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function setupExtrasHandlers(
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
