#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerSlidesTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from './tools/slides-extra.js';

await runMcp({
  name: 'gogcli-slides',
  version: VERSION,
  tools: [registerAuthTools, registerSlidesTools, registerExtraSlidesTools],
});
