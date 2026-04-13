#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerSheetsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSheetsTools } from './tools/sheets-extra.js';

const server = createServer({ name: 'gogcli-sheets' });
registerAuthTools(server);
registerSheetsTools(server);
registerExtraSheetsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
