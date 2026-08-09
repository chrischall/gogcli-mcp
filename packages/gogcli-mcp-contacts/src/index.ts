#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerContactsTools, useRemoteGogRunner } from '../../gogcli-mcp/src/lib.js';
import { registerExtraContactsTools } from './tools/contacts-extra.js';

// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-contacts',
  version: VERSION,
  tools: [authToolsFor('contacts'), registerContactsTools, registerExtraContactsTools],
});
