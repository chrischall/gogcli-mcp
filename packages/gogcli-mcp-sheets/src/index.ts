#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerSheetsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSheetsTools } from './tools/sheets-extra.js';

await runMcp({
  name: 'gogcli-sheets',
  version: VERSION,
  tools: [registerAuthTools, registerSheetsTools, registerExtraSheetsTools],
});
