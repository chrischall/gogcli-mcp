#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerDocsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from './tools/docs-extra.js';

await runMcp({
  name: 'gogcli-docs',
  version: VERSION,
  tools: [registerAuthTools, registerDocsTools, registerExtraDocsTools],
});
