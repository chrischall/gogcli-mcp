#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerContactsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraContactsTools } from './tools/contacts-extra.js';

const server = createServer({ name: 'gogcli-contacts' });
registerAuthTools(server);
registerContactsTools(server);
registerExtraContactsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
