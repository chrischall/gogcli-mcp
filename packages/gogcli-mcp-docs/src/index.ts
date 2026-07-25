#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDocsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';

await runMcp({
  name: 'gogcli-docs',
  version: VERSION,
  tools: [authToolsFor('docs'), registerDocsTools, registerExtraDocsTools],
});
