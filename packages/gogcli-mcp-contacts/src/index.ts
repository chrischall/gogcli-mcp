#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerContactsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraContactsTools } from './tools/contacts-extra.js';

await runMcp({
  name: 'gogcli-contacts',
  version: VERSION,
  tools: [registerAuthTools, registerContactsTools, registerExtraContactsTools],
});
