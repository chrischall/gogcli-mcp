import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { PlacesCache } from '../../src/places-cache.js';
import { placesTools, type PlacesToolDeps } from '../../src/tools/places.js';
import { ARMATURE, fakeMapsGog, GEO, positionals, STADIUM, type MapsFixtures } from '../support/fake-maps.js';

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const FX: MapsFixtures = {
  search: { Armature: ARMATURE, Stadium: STADIUM, Cigar: STADIUM },
  details: { ChIJ_armature: ARMATURE, ChIJ_stadium: STADIUM },
  geocode: GEO,
};

let dir: string;
let cache: PlacesCache;
let harness: TestHarness;
const ORIGINAL_ENV = { ...process.env };

async function start(gog: ReturnType<typeof fakeMapsGog>, deps: Partial<PlacesToolDeps> = {}): Promise<void> {
  await harness?.close();
  harness = await createTestHarness(placesTools({ spawner: gog.spawner, cache: () => cache, ...deps }));
}

type Result = Awaited<ReturnType<TestHarness['callTool']>>;
const texts = (r: Result): string[] => (r.content as Array<{ type: string; text: string }>).map((c) => c.text);
const data = (r: Result): Record<string, any> => JSON.parse(texts(r).at(-1)!);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'places-tools-test-'));
  process.env = { ...ORIGINAL_ENV };
  cache = new PlacesCache({ path: join(dir, 'places-cache.json'), now: () => T0, log: () => {} });
});

afterEach(async () => {
  await harness?.close();
  process.env = ORIGINAL_ENV;
  await rm(dir, { recursive: true, force: true });
});

describe('gog_places_search', () => {
  it('returns the single top match with coordinates, through gog only', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    const r = await harness.callTool('gog_places_search', { query: 'Armature food hall', near: 'Tampa, FL' });
    expect(r.isError).toBeFalsy();
    expect(texts(r)).toHaveLength(1);
    expect(data(r)).toEqual({
      result: {
        status: 'ok',
        placeId: 'ChIJ_armature',
        name: 'Armature Works',
        formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
        lat: 27.9606,
        lng: -82.4637,
        location: 'exact',
        googleMapsUri: 'https://maps.google.com/?cid=1',
        cached: false,
      },
      gogCalls: { search: 1, details: 0, geocode: 1 },
    });
    expect(positionals(gog.calls('maps', 'places', 'search')[0]!)).toEqual(['Armature food hall, Tampa, FL']);
    // Every subprocess is gog; nothing else ran.
    expect(gog.argvs.every((a) => a.includes('maps'))).toBe(true);
  });

  it('says not_found (not an error) when nothing matches', async () => {
    await start(fakeMapsGog(FX));
    const r = await harness.callTool('gog_places_search', { query: 'nothing like this' });
    expect(r.isError).toBeFalsy();
    expect(texts(r)[0]).toBe('Not found: nothing like this');
    expect(data(r).result).toMatchObject({ status: 'not_found', reason: 'no match found' });
  });

  it('a gog failure is a tool error', async () => {
    await start(fakeMapsGog({ fail: () => 'Google Maps/Places API key required' }));
    const r = await harness.callTool('gog_places_search', { query: 'x' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/API key required/);
  });

  it('caches what it finds, so a details read after it is free; the cache is saved', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    await harness.callTool('gog_places_search', { query: 'Stadium' });
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_stadium' });
    expect(gog.argvs).toHaveLength(2);
    expect(data(r)).toMatchObject({ result: { cached: true, status: 'approximate' }, gogCalls: { search: 0, details: 0, geocode: 0 } });
    expect(JSON.parse(readFileSync(join(dir, 'places-cache.json'), 'utf8')).places).toHaveProperty('ChIJ_stadium');
  });
});

describe('gog_places_resolve', () => {
  it('resolves a batch in input order with a status per item, warnings first', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    const r = await harness.callTool('gog_places_resolve', {
      items: [
        { name: 'Armature Works', address: 'Tampa, FL' },
        { name: 'Cigar City Brewing' },
        { name: 'Nowhere' },
        { name: 'Home base', place_id: 'ChIJ_stadium', lat: 27.1, lng: -82.1 },
      ],
    });
    const out = data(r);
    expect(out.results.map((x: { status: string }) => x.status)).toEqual(['ok', 'approximate', 'not_found', 'ok']);
    expect(out.counts).toEqual({ ok: 2, approximate: 1, not_found: 1, error: 0 });
    expect(out.results[0].input).toEqual({ name: 'Armature Works', address: 'Tampa, FL' });
    expect(out.results[1].matchConfidence).toBe('low');
    expect(out.results[3]).toMatchObject({ lat: 27.1, lng: -82.1, location: 'given', input: { place_id: 'ChIJ_stadium' } });
    const loud = texts(r)[0]!.split('\n');
    expect(loud).toContain('Ambiguous: asked for "Cigar City Brewing", the top match is "Raymond James Stadium"');
    expect(loud).toContain('Not found: Nowhere');
    expect(out.warnings).toEqual(loud);
    expect(out.gogCalls).toEqual({ search: 3, details: 1, geocode: 2 });
  });

  it('refresh: true looks everything up again', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    const items = [{ name: 'Armature Works' }];
    await harness.callTool('gog_places_resolve', { items });
    expect(data(await harness.callTool('gog_places_resolve', { items })).gogCalls).toEqual({ search: 0, details: 0, geocode: 0 });
    expect(data(await harness.callTool('gog_places_resolve', { items, refresh: true })).gogCalls).toEqual({ search: 1, details: 0, geocode: 1 });
  });

  it('refuses half a coordinate pair before any gog call', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    const r = await harness.callTool('gog_places_resolve', { items: [{ name: 'A', lat: 1 }] });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/item 1: give both lat and lng, or neither/);
    expect(gog.argvs).toEqual([]);
  });

  it('caps the batch at 50 items', async () => {
    await start(fakeMapsGog(FX));
    const r = await harness.callTool('gog_places_resolve', { items: Array.from({ length: 51 }, () => ({ name: 'x' })) });
    expect(r.isError).toBe(true);
  });

  it('reports a gog failure on its item and carries on', async () => {
    await start(fakeMapsGog({ ...FX, fail: (argv) => (argv.some((a) => a.includes('Broken')) ? 'boom' : undefined) }));
    const out = data(await harness.callTool('gog_places_resolve', { items: [{ name: 'Broken' }, { name: 'Armature Works' }] }));
    expect(out.counts).toEqual({ ok: 1, approximate: 0, not_found: 0, error: 1 });
    expect(out.results[0]).toMatchObject({ status: 'error', reason: 'boom' });
  });
});

describe('gog_places_details', () => {
  it('reads one place id ("places/" accepted) and geocodes it', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    const r = await harness.callTool('gog_places_details', { placeId: 'places/ChIJ_armature' });
    expect(data(r)).toEqual({
      result: {
        status: 'ok',
        placeId: 'ChIJ_armature',
        name: 'Armature Works',
        formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
        lat: 27.9606,
        lng: -82.4637,
        location: 'exact',
        googleMapsUri: 'https://maps.google.com/?cid=1',
        cached: false,
      },
      gogCalls: { search: 0, details: 1, geocode: 1 },
    });
    expect(positionals(gog.calls('maps', 'places', 'details')[0]!)).toEqual(['ChIJ_armature']);
  });

  it('refresh: true fetches again; an unknown id is a tool error', async () => {
    const gog = fakeMapsGog(FX);
    await start(gog);
    await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature' });
    const again = data(await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature', refresh: true }));
    expect(again.gogCalls).toEqual({ search: 0, details: 1, geocode: 1 });
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_missing' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/404/);
  });

  it('uses the default per-process cache when none is injected', async () => {
    process.env.HOME = dir;
    await start(fakeMapsGog(FX), { cache: undefined });
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature' });
    expect(r.isError).toBeFalsy();
  });
});

describe('descriptions', () => {
  it('promise nothing gog cannot deliver', async () => {
    await start(fakeMapsGog());
    const tools = await harness.listTools();
    const text = JSON.stringify(tools);
    for (const word of ['hours', 'closed', 'rating', 'api_budget', 'alternates', 'API key (GOG_PLACES']) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});
