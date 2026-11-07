#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from './tools/places.js';

// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-maps',
  version: VERSION,
  // Drive scope only: the trip map lands as KML/CSV files in Drive. Places is
  // called directly over HTTPS with an API key (src/places-client.ts), not OAuth.
  tools: [authToolsFor('drive'), placesTools()],
});
