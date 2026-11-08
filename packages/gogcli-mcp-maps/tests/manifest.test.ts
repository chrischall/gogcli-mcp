import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { authToolsFor } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from '../src/tools/places.js';
import { tripTools } from '../src/tools/trip.js';

describe('manifest.json', () => {
  it('lists exactly the tools src/index.ts registers', async () => {
    const harness = await createTestHarness((server) => {
      authToolsFor('drive')(server as never);
      placesTools()(server);
      tripTools()(server);
    });
    const names = (await harness.listTools()).map((t) => t.name);
    await harness.close();
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { tools: Array<{ name: string }> };
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(names.sort());
  });
});
