#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerGmailTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraGmailTools } from './tools/gmail-extra.js';

await runMcp({
  name: 'gogcli-gmail',
  version: VERSION,
  tools: [registerAuthTools, registerGmailTools, registerExtraGmailTools],
});
