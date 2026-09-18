#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerClassroomTools, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraClassroomTools } from './tools/classroom-extra.js';


// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-classroom',
  version: VERSION,
  tools: [authToolsFor('classroom'), registerClassroomTools, registerExtraClassroomTools],
});
