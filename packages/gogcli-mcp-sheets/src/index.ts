#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBaseServer } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSheetsTools } from './tools/sheets-extra.js';

const server = createBaseServer({ name: 'gogcli-sheets' });
registerExtraSheetsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
