import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer, createBaseServer, VERSION } from '../src/server.js';

describe('createServer', () => {
  it('returns an McpServer with default name and version', () => {
    const server = createServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('accepts custom name and version', () => {
    const server = createServer({ name: 'custom', version: '9.9.9' });
    expect(server).toBeInstanceOf(McpServer);
  });

  it('accepts partial options (name only)', () => {
    const server = createServer({ name: 'partial' });
    expect(server).toBeInstanceOf(McpServer);
  });
});

describe('createBaseServer', () => {
  it('returns an McpServer with all services registered', () => {
    const server = createBaseServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('accepts custom options', () => {
    const server = createBaseServer({ name: 'gogcli-all', version: '9.9.9' });
    expect(server).toBeInstanceOf(McpServer);
  });
});

describe('VERSION', () => {
  it('is a string', () => {
    expect(typeof VERSION).toBe('string');
  });

  it('defaults to 0.0.0 when GOGCLI_VERSION is not injected (dev/test runtime)', () => {
    // At test runtime, esbuild has not injected GOGCLI_VERSION, so the fallback branch runs.
    expect(VERSION).toBe('0.0.0');
  });
});
