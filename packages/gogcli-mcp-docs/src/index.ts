#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerDocsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';

const server = createServer({ name: 'gogcli-docs' });
registerAuthTools(server);
registerDocsTools(server);
registerExtraDocsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
