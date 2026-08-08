#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerCalendarTools, useRemoteGogRunner } from '../../gogcli-mcp/src/lib.js';
import { registerExtraCalendarTools } from './tools/calendar-extra.js';

// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-calendar',
  version: VERSION,
  tools: [authToolsFor('calendar'), registerCalendarTools, registerExtraCalendarTools],
});
