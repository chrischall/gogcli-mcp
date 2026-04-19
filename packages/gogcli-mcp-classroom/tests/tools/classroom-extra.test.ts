import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraClassroomTools } from '../../src/tools/classroom-extra.js';

describe('registerExtraClassroomTools', () => {
  it('registers no tools (no extras yet)', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const spy = vi.spyOn(server, 'registerTool');
    registerExtraClassroomTools(server);
    expect(spy).not.toHaveBeenCalled();
  });
});
