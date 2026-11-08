import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { authToolsFor } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from '../src/tools/places.js';
import { tripTools } from '../src/tools/trip.js';

// Hand-maintained docs drift (see gogcli-mcp's server.test.ts): derive the
// truth from the registrars and fail on a mismatch.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

async function liveToolNames(): Promise<string[]> {
  const harness = await createTestHarness((server) => {
    authToolsFor('drive')(server as never);
    placesTools()(server);
    tripTools()(server);
  });
  const names = (await harness.listTools()).map((t) => t.name);
  await harness.close();
  return names;
}

describe('package docs', () => {
  it.each(['../README.md', '../SKILL.md'])('%s states the real tool total and lists every maps tool', async (file) => {
    const names = await liveToolNames();
    const text = read(file);
    const heading = /^## Tools \((\d+)\)$/m.exec(text);
    expect(heading, `${file} has no "## Tools (N)" heading`).not.toBeNull();
    expect(Number(heading![1])).toBe(names.length);
    for (const name of names.filter((n) => !n.startsWith('gog_auth_'))) {
      expect(text, `${file} does not document ${name}`).toContain(`\`${name}\``);
    }
    expect(text).not.toMatch(/Work in progress|follow\.?$/m);
  });

  it('README explains why it is pins (not routes) and that My Maps and Lists have no API', () => {
    const text = read('../README.md');
    expect(text).not.toContain('/maps/dir/');
    expect(text).toMatch(/not a route/i);
    expect(text).toMatch(/My Maps[^\n]*no[^\n]*API/i);
    expect(text).toMatch(/Lists[^\n]*no[^\n]*API/i);
    expect(text).toContain('2,048');
    expect(text).toContain('gog config set places_api_key');
    expect(text).toContain('Places API (New)');
    // The sharing rail: never public, explicit emails only, confirmed.
    expect(text).toMatch(/never[^\n]*(public|anyone)/i);
    expect(text).toContain('confirm_share');
  });

  const PACKAGE_TEXTS = ['../README.md', '../SKILL.md', '../manifest.json', '../package.json', '../server.json', '../mint.yaml'];

  it.each(PACKAGE_TEXTS)('%s promises nothing gog 0.48 cannot give and no key handling in the MCP', (file) => {
    const text = read(file);
    for (const gone of [
      /api_budget/, /open[_-]at/i, /closures?\b/i, /CLOSED/, /fields: (basic|full)/, /field mask/i,
      /opening hours/i, /\bhours\b/i, /\bphone/i, /\bwebsite/i,
      /over HTTPS/i, /directly from Node/i, /Enterprise/, /estimatedUsd/,
    ]) {
      expect(text, `${file} still mentions ${gone}`).not.toMatch(gone);
    }
  });

  // The key is gog's: the runner passes GOG_PLACES_API_KEY through to gog and
  // this package's code never reads it.
  it('documents GOG_PLACES_API_KEY as read by gog (no-network.test.ts keeps it out of src)', () => {
    expect(read('../README.md')).toMatch(/GOG_PLACES_API_KEY[^\n]*passes through|passes through[^\n]*GOG_PLACES_API_KEY|`GOG_PLACES_API_KEY` is the one it passes through/);
    expect(read('../mint.yaml')).toMatch(/GOG_PLACES_API_KEY[\s\S]*read by gog itself/);
  });

  it('README says gog does every Google call, with the key in gog\'s own config', () => {
    const text = read('../README.md');
    expect(text).toMatch(/calls nothing outside gog|never calls Google itself/i);
    expect(text).toContain('Geocoding API');
    expect(text).toContain('gog maps places search');
    expect(text).toContain('gog maps geocode');
    // Costs: per-call SKUs, with the pricing page cited, and no budget parameter.
    expect(text).toMatch(/Text Search Pro/);
    expect(text).toMatch(/Place Details Pro/);
    expect(text).toMatch(/Geocoding[^\n]*\$5/);
    expect(text).toContain('https://developers.google.com/maps/billing-and-pricing/pricing');
    expect(text).toContain('gogCalls');
  });

  it('README names exactly the tools that take refresh', () => {
    const text = read('../README.md');
    const line = text.split('\n').find((l) => l.includes('`refresh: true`'));
    expect(line).toBeDefined();
    expect(line).toContain('`gog_places_resolve`');
    expect(line).toContain('`gog_places_details`');
    expect(line).not.toContain('`gog_places_search`');
    expect(line).not.toContain('`gog_trip_map`');
  });

  it('README documents the shortlist links: what they do, the 20-place limit, unverified save behaviour', () => {
    const text = read('../README.md');
    expect(text).toMatch(/^## .*[Ss]hortlist/m);
    expect(text).toContain('map_action=shortlist');
    expect(text).toContain('shortlist_urls');
    expect(text).toMatch(/20 places/);
    expect(text).toMatch(/not (been )?verified/i);
    expect(text).toMatch(/My Maps/);
  });

  it('SKILL mentions the shortlist links', () => {
    expect(read('../SKILL.md')).toMatch(/shortlist/i);
  });

  it('mint.yaml pins gog v0.48.0, the release whose `gog maps` the tools use', () => {
    expect(read('../mint.yaml')).toMatch(/^\s+tag: v0\.48\.0$/m);
  });

  it('root README counts the package tools and lists gog_trip_map among the confirmed tools', async () => {
    const total = (await liveToolNames()).length;
    const text = read('../../../README.md');
    const row = /^\| \[gogcli-mcp-maps\]\(packages\/gogcli-mcp-maps\) \| (\d+) \|/m.exec(text);
    expect(row).not.toBeNull();
    expect(Number(row![1])).toBe(total);
    expect(text).toMatch(/^\| Maps \| `gog_trip_map` \|/m);
  });
});
