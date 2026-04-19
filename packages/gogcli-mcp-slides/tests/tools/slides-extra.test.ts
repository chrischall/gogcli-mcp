import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraSlidesTools } from '../../src/tools/slides-extra.js';

describe('registerExtraSlidesTools', () => {
  it('does not throw when called (no extras yet)', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => registerExtraSlidesTools(server)).not.toThrow();
  });
});
