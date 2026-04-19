#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerDriveTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from './tools/drive-extra.js';

const server = createServer({ name: 'gogcli-drive' });
registerAuthTools(server);
registerDriveTools(server);
registerExtraDriveTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
