#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { BASE_TOOL_REGISTRARS, VERSION } from './server.js';

await runMcp({
  name: 'gogcli',
  version: VERSION,
  tools: BASE_TOOL_REGISTRARS,
});
