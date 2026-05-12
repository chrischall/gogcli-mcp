#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerCalendarTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraCalendarTools } from './tools/calendar-extra.js';

const server = createServer({ name: 'gogcli-calendar' });
registerAuthTools(server);
registerCalendarTools(server);
registerExtraCalendarTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
