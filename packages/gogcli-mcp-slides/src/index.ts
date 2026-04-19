#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerSlidesTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from './tools/slides-extra.js';

const server = createServer({ name: 'gogcli-slides' });
registerAuthTools(server);
registerSlidesTools(server);
registerExtraSlidesTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
