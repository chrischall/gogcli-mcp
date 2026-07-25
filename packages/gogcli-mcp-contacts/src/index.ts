#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerContactsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraContactsTools } from './tools/contacts-extra.js';

await runMcp({
  name: 'gogcli-contacts',
  version: VERSION,
  tools: [authToolsFor('contacts'), registerContactsTools, registerExtraContactsTools],
});
