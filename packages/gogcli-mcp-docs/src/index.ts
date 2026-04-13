#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBaseServer } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';

const server = createBaseServer({ name: 'gogcli-docs' });
registerExtraDocsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
