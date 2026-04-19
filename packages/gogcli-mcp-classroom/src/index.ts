#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, registerAuthTools, registerClassroomTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraClassroomTools } from './tools/classroom-extra.js';

const server = createServer({ name: 'gogcli-classroom' });
registerAuthTools(server);
registerClassroomTools(server);
registerExtraClassroomTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
