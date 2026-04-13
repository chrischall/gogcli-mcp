#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSheetsTools } from './tools/sheets.js';

const server = new McpServer({ name: 'gogcli', version: '1.0.0' });

registerSheetsTools(server);

// To add more services: import registerXxxTools and call them here.
// Example: registerGmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
