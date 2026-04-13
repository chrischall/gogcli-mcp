#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerContactsTools } from './tools/contacts.js';
import { registerDocsTools } from './tools/docs.js';
import { registerDriveTools } from './tools/drive.js';
import { registerGmailTools } from './tools/gmail.js';
import { registerSheetsTools } from './tools/sheets.js';
import { registerTasksTools } from './tools/tasks.js';

const server = new McpServer({ name: 'gogcli', version: '1.0.3' });

registerAuthTools(server);
registerCalendarTools(server);
registerContactsTools(server);
registerDocsTools(server);
registerDriveTools(server);
registerGmailTools(server);
registerSheetsTools(server);
registerTasksTools(server);

// To add more services: import registerXxxTools and call them here.
// Example: registerGmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
