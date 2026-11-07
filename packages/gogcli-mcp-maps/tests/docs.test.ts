import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { authToolsFor } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from '../src/tools/places.js';
import { tripTools } from '../src/tools/trip.js';
import { API_BUDGET_DEFAULT, API_BUDGET_MAX, PRICE_PER_1000_USD } from '../src/budget.js';

// Hand-maintained docs drift (see gogcli-mcp's server.test.ts): derive the
// truth from the registrars and the budget constants and fail on a mismatch.
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

  it('README states the published prices, budget defaults and free caps the code uses', () => {
    const text = read('../README.md');
    for (const n of [PRICE_PER_1000_USD.textSearch.basic, PRICE_PER_1000_USD.textSearch.full,
      PRICE_PER_1000_USD.details.basic, PRICE_PER_1000_USD.details.full]) {
      expect(text).toContain(`$${n}`);
    }
    expect(text).toContain(`default ${API_BUDGET_DEFAULT}`);
    expect(text).toContain(`max ${API_BUDGET_MAX}`);
    expect(text).toMatch(/5,000/);
    expect(text).toMatch(/1,000/);
  });

  it('README explains why it is pins (not routes) and that My Maps and Lists have no API', () => {
    const text = read('../README.md');
    expect(text).not.toContain('/maps/dir/');
    expect(text).toMatch(/not a route/i);
    expect(text).toMatch(/My Maps[^\n]*no[^\n]*API/i);
    expect(text).toMatch(/Lists[^\n]*no[^\n]*API/i);
    expect(text).toContain('2,048');
    expect(text).toContain('gog config set places_api_key');
    expect(text).toContain('GOG_PLACES_API_KEY');
    expect(text).toContain('Places API (New)');
    // The sharing rail: never public, explicit emails only, confirmed.
    expect(text).toMatch(/never[^\n]*(public|anyone)/i);
    expect(text).toContain('confirm_share');
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
