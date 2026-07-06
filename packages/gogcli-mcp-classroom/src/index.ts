#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerClassroomTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraClassroomTools } from './tools/classroom-extra.js';

await runMcp({
  name: 'gogcli-classroom',
  version: VERSION,
  tools: [registerAuthTools, registerClassroomTools, registerExtraClassroomTools],
});
