#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerCalendarTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraCalendarTools } from './tools/calendar-extra.js';

await runMcp({
  name: 'gogcli-calendar',
  version: VERSION,
  tools: [authToolsFor('calendar'), registerCalendarTools, registerExtraCalendarTools],
});
