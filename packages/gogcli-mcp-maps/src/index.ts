#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from './tools/places.js';
import { tripTools } from './tools/trip.js';

// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-maps',
  version: VERSION,
  // Drive scope only: the trip map lands as KML/CSV files in Drive. Places and
  // Geocoding go through `gog maps` too, which uses the API key in gog's own
  // config (not OAuth); this process makes no network call of its own.
  tools: [authToolsFor('drive'), placesTools(), tripTools()],
});
