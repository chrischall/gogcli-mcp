#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerGmailTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraGmailTools } from './tools/gmail-extra.js';

const server = createServer({ name: 'gogcli-gmail' });
registerAuthTools(server);
registerGmailTools(server);
registerExtraGmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
