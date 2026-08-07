#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDocsTools, useRemoteGogRunner } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-docs',
  version: VERSION,
  tools: [authToolsFor('docs'), registerDocsTools, registerExtraDocsTools],
});
