#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerGmailTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraGmailTools } from './tools/gmail-extra.js';
import { useRemoteGogRunner } from '../../gogcli-mcp/src/remote-runner.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-gmail',
  version: VERSION,
  tools: [authToolsFor('gmail'), registerGmailTools, registerExtraGmailTools],
});
