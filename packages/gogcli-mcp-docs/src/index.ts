#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDocsTools, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';


// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-docs',
  version: VERSION,
  tools: [authToolsFor('docs'), registerDocsTools, registerExtraDocsTools],
});
