#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerSlidesTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from './tools/slides-extra.js';

await runMcp({
  name: 'gogcli-slides',
  version: VERSION,
  tools: [authToolsFor('slides'), registerSlidesTools, registerExtraSlidesTools],
});
