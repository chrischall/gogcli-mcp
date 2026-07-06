#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerCalendarTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraCalendarTools } from './tools/calendar-extra.js';

await runMcp({
  name: 'gogcli-calendar',
  version: VERSION,
  tools: [registerAuthTools, registerCalendarTools, registerExtraCalendarTools],
});
