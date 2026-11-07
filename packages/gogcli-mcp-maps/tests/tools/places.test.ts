import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { PlacesCache } from '../../src/places-cache.js';
import { PLACES_API_BASE, type FetchLike, type PlacesPlace } from '../../src/places-client.js';
import { placesTools, projectPlace, type PlacesToolDeps } from '../../src/tools/places.js';

const KEY = 'odd-places-key-zz9-plural-z-alpha';
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const p = (day: number, hour: number, minute = 0) => ({ day, hour, minute });

const ARMATURE: PlacesPlace = {
  id: 'ChIJ_armature',
  displayName: { text: 'Armature Works' },
  formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
  location: { latitude: 27.9606, longitude: -82.4637 },
  googleMapsUri: 'https://maps.google.com/?cid=1',
  businessStatus: 'OPERATIONAL',
  utcOffsetMinutes: -300,
  websiteUri: 'https://armatureworks.com/',
  nationalPhoneNumber: '(813) 250-3725',
  internationalPhoneNumber: '+1 813-250-3725',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  accessibilityOptions: { wheelchairAccessibleEntrance: true, wheelchairAccessibleSeating: false },
  regularOpeningHours: {
    periods: [1, 2, 3, 4, 5, 6].map((d) => ({ open: p(d, 11), close: p(d, 22) })),
    weekdayDescriptions: ['Monday: 11:00 AM – 10:00 PM', 'Sunday: Closed'],
  },
};

const STADIUM: PlacesPlace = {
  id: 'ChIJ_stadium',
  displayName: { text: 'Raymond James Stadium' },
  formattedAddress: '4201 N Dale Mabry Hwy, Tampa, FL 33607, USA',
  location: { latitude: 27.9759, longitude: -82.5033 },
  googleMapsUri: 'https://maps.google.com/?cid=2',
  businessStatus: 'OPERATIONAL',
};

const GONE: PlacesPlace = {
  id: 'ChIJ_gone',
  displayName: { text: 'Old Diner' },
  location: { latitude: 27.9, longitude: -82.4 },
  businessStatus: 'CLOSED_PERMANENTLY',
};

interface Call {
  url: string;
  init: RequestInit;
  body?: Record<string, unknown>;
}

type Handler = (call: Call) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Routes Text Search by textQuery substring and Details by id. */
function fakeApi(opts: { search?: Record<string, PlacesPlace[]>; details?: Record<string, PlacesPlace>; override?: Handler } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    if (opts.override) return opts.override(call);
    if (url === `${PLACES_API_BASE}/places:searchText`) {
      const q = String(call.body!.textQuery);
      const hit = Object.entries(opts.search ?? {}).find(([needle]) => q.includes(needle));
      return json(200, { places: hit ? hit[1] : [] });
    }
    const id = url.slice(`${PLACES_API_BASE}/places/`.length);
    const place = opts.details?.[id];
    return place ? json(200, place) : json(404, { error: { status: 'NOT_FOUND', message: 'not found' } });
  };
  return {
    fetch,
    calls,
    searches: () => calls.filter((c) => c.url.endsWith(':searchText')),
    details: () => calls.filter((c) => !c.url.endsWith(':searchText')),
  };
}

let dir: string;
let clock: number;
let cache: PlacesCache;
let harness: TestHarness;

function newCache(): PlacesCache {
  return new PlacesCache({ path: join(dir, 'places-cache.json'), now: () => clock, log: () => {} });
}

async function start(api: ReturnType<typeof fakeApi>, deps: Partial<PlacesToolDeps> = {}): Promise<void> {
  await harness?.close();
  harness = await createTestHarness(placesTools({
    fetch: api.fetch,
    env: { GOG_PLACES_API_KEY: KEY },
    cache: () => cache,
    ...deps,
  }));
}

type Result = Awaited<ReturnType<TestHarness['callTool']>>;
const texts = (r: Result): string[] => (r.content as Array<{ type: string; text: string }>).map((c) => c.text);
const data = (r: Result): Record<string, any> => JSON.parse(texts(r).at(-1)!);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'places-tools-test-'));
  clock = T0;
  cache = newCache();
});

afterEach(async () => {
  await harness?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('gog_places_search', () => {
  it('searches with the BASIC mask by default, biased to near, and reports the cost', async () => {
    const api = fakeApi({ search: { taco: [ARMATURE, STADIUM] } });
    await start(api);
    const r = await harness.callTool('gog_places_search', {
      query: 'taco', near: { lat: 27.95, lng: -82.46, radius_m: 2000 }, max: 5,
    });
    expect(r.isError).toBeFalsy();
    const [call] = api.calls;
    expect(call.body).toEqual({
      textQuery: 'taco',
      pageSize: 5,
      locationBias: { circle: { center: { latitude: 27.95, longitude: -82.46 }, radius: 2000 } },
    });
    expect((call.init.headers as Record<string, string>)['X-Goog-FieldMask']).not.toContain('websiteUri');
    const out = data(r);
    expect(out.places.map((x: { placeId: string }) => x.placeId)).toEqual(['ChIJ_armature', 'ChIJ_stadium']);
    expect(out.places[1]).toEqual({
      placeId: 'ChIJ_stadium',
      displayName: 'Raymond James Stadium',
      formattedAddress: '4201 N Dale Mabry Hwy, Tampa, FL 33607, USA',
      lat: 27.9759,
      lng: -82.5033,
      googleMapsUri: 'https://maps.google.com/?cid=2',
      businessStatus: 'OPERATIONAL',
      warnings: [],
    });
    expect(out.apiCalls).toMatchObject({ textSearch: 1, details: 0, sku: 'Pro', estimatedUsd: 0.032 });
    expect(texts(r)).toHaveLength(1);
  });

  it('caches what it finds by id, so a details read after it is free', async () => {
    const api = fakeApi({ search: { stadium: [STADIUM] } });
    await start(api);
    await harness.callTool('gog_places_search', { query: 'stadium' });
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_stadium', fields: 'basic' });
    expect(api.calls).toHaveLength(1);
    expect(data(r)).toMatchObject({ cached: true, apiCalls: { textSearch: 0, details: 0, sku: 'none' } });
    // Persisted to disk at the end of each call.
    expect(JSON.parse(readFileSync(join(dir, 'places-cache.json'), 'utf8')).places).toHaveProperty('ChIJ_stadium');
  });

  it('full fields use the Enterprise mask and the full view returns raw hours', async () => {
    const api = fakeApi({ search: { arm: [ARMATURE] } });
    await start(api);
    const r = await harness.callTool('gog_places_search', { query: 'arm', fields: 'full', view: 'full' });
    expect((api.calls[0].init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.websiteUri');
    const [place] = data(r).places;
    expect(place.regularOpeningHours.periods).toHaveLength(6);
    expect(place.utcOffsetMinutes).toBe(-300);
    expect(place.accessibilityOptions).toEqual(ARMATURE.accessibilityOptions);
    expect(data(r).apiCalls.sku).toBe('Enterprise');
  });

  it('shouts a closed business first, before the JSON', async () => {
    await start(fakeApi({ search: { diner: [STADIUM, GONE] } }));
    const r = await harness.callTool('gog_places_search', { query: 'diner' });
    expect(texts(r)[0]).toBe('⚠️ CLOSED PERMANENTLY: Old Diner');
    expect(data(r).places[1].warnings).toEqual(['⚠️ CLOSED PERMANENTLY: Old Diner']);
  });

  it('api_budget 0 sends nothing and says so', async () => {
    const api = fakeApi({ search: { x: [STADIUM] } });
    await start(api);
    const r = await harness.callTool('gog_places_search', { query: 'x', api_budget: 0 });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/api_budget reached/);
    expect(api.calls).toHaveLength(0);
  });

  it('a missing key is a setup error, not a crash', async () => {
    const api = fakeApi();
    await start(api, { env: {}, readGogConfig: async () => undefined });
    const r = await harness.callTool('gog_places_search', { query: 'x' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/gog config set places_api_key/);
    expect(texts(r)[0]).toMatch(/GOG_PLACES_API_KEY/);
    expect(api.calls).toHaveLength(0);
  });

  it('never returns the key, even when Google echoes it back', async () => {
    const api = fakeApi({ override: () => json(403, { error: { status: 'PERMISSION_DENIED', message: `API key ${KEY} is not authorized` } }) });
    await start(api);
    const r = await harness.callTool('gog_places_search', { query: 'x' });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(texts(r)[0]).toContain('[REDACTED]');
  });

  it('refuses max over 20 at the schema', async () => {
    await start(fakeApi());
    const r = await harness.callTool('gog_places_search', { query: 'x', max: 21 });
    expect(r.isError).toBe(true);
  });
});

describe('gog_places_resolve', () => {
  const ITEMS = [
    { name: 'Armature Works', address: 'Tampa, FL' },
    { name: 'Raymond James Stadium', near: { lat: 27.97, lng: -82.5 } },
  ];

  it('refuses a batch over 50 at the schema', async () => {
    const api = fakeApi();
    await start(api);
    const items = Array.from({ length: 51 }, (_, i) => ({ name: `Stop ${i}` }));
    const r = await harness.callTool('gog_places_resolve', { items });
    expect(r.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it('takes the top Text Search hit per item with the FULL mask by default', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE, STADIUM], Raymond: [STADIUM] } });
    await start(api);
    const r = await harness.callTool('gog_places_resolve', { items: ITEMS });
    expect(r.isError).toBeFalsy();
    const [first, second] = api.searches();
    expect(first.body).toEqual({ textQuery: 'Armature Works, Tampa, FL', pageSize: 1 });
    expect((first.init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.regularOpeningHours');
    expect(second.body).toMatchObject({
      textQuery: 'Raymond James Stadium',
      locationBias: { circle: { center: { latitude: 27.97, longitude: -82.5 }, radius: 50000 } },
    });
    const out = data(r);
    expect(out).toMatchObject({ resolved: 2, unresolved: 0, warnings: [] });
    expect(out.results[0]).toEqual({
      input: { name: 'Armature Works', address: 'Tampa, FL' },
      placeId: 'ChIJ_armature',
      displayName: 'Armature Works',
      formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
      lat: 27.9606,
      lng: -82.4637,
      googleMapsUri: 'https://maps.google.com/?cid=1',
      businessStatus: 'OPERATIONAL',
      websiteUri: 'https://armatureworks.com/',
      phone: '(813) 250-3725',
      priceLevel: 'PRICE_LEVEL_MODERATE',
      regularOpeningHours: ['Monday: 11:00 AM – 10:00 PM', 'Sunday: Closed'],
      accessibility: ['wheelchairAccessibleEntrance'],
      warnings: [],
      cached: false,
      matchConfidence: 'high',
    });
    expect(out.apiCalls).toMatchObject({ textSearch: 2, sku: 'Enterprise', estimatedUsd: 0.07 });
  });

  it('a fully fresh cache hit costs zero calls', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE], Raymond: [STADIUM] } });
    await start(api);
    await harness.callTool('gog_places_resolve', { items: ITEMS });
    // A new process reading the same file: the hit comes from disk.
    cache = newCache();
    clock = T0 + 23 * HOUR;
    const r = await harness.callTool('gog_places_resolve', { items: ITEMS });
    expect(api.calls).toHaveLength(2);
    const out = data(r);
    expect(out.results.map((x: { cached: boolean }) => x.cached)).toEqual([true, true]);
    expect(out.apiCalls).toMatchObject({ textSearch: 0, details: 0, sku: 'none', estimatedUsd: 0 });
  });

  it('a stale-hours hit with a known place id costs one Details call, no Text Search', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE] }, details: { ChIJ_armature: ARMATURE } });
    await start(api);
    await harness.callTool('gog_places_resolve', { items: [ITEMS[0]] });
    clock = T0 + 25 * HOUR;
    const r = await harness.callTool('gog_places_resolve', { items: [ITEMS[0]] });
    expect(api.searches()).toHaveLength(1);
    expect(api.details()).toHaveLength(1);
    expect(api.details()[0].url).toBe(`${PLACES_API_BASE}/places/ChIJ_armature`);
    expect(data(r).results[0]).toMatchObject({ placeId: 'ChIJ_armature', cached: false });
    expect(data(r).apiCalls).toMatchObject({ textSearch: 0, details: 1 });
  });

  it('refresh ignores the cache', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE] } });
    await start(api);
    await harness.callTool('gog_places_resolve', { items: [ITEMS[0]] });
    await harness.callTool('gog_places_resolve', { items: [ITEMS[0]], refresh: true });
    expect(api.searches()).toHaveLength(2);
  });

  it('keys an address-less item by its near point, so the same name elsewhere is not a hit', async () => {
    const api = fakeApi({ search: { Starbucks: [STADIUM] } });
    await start(api);
    await harness.callTool('gog_places_resolve', { items: [{ name: 'Starbucks', near: { lat: 27.95, lng: -82.46 } }] });
    await harness.callTool('gog_places_resolve', { items: [{ name: 'Starbucks', near: { lat: 28.54, lng: -81.38 } }] });
    await harness.callTool('gog_places_resolve', { items: [{ name: 'Starbucks', near: { lat: 27.951, lng: -82.459 } }] });
    expect(api.searches()).toHaveLength(2);
  });

  it('stops at the budget mid-batch and returns the rest unresolved', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE], Raymond: [STADIUM], Riverwalk: [STADIUM] } });
    await start(api);
    const r = await harness.callTool('gog_places_resolve', {
      items: [ITEMS[0], ITEMS[1], { name: 'Tampa Riverwalk' }],
      api_budget: 1,
    });
    expect(api.calls).toHaveLength(1);
    const out = data(r);
    expect(out).toMatchObject({ resolved: 1, unresolved: 2 });
    expect(out.results[1]).toEqual({
      input: ITEMS[1],
      resolved: false,
      reason: 'api_budget reached',
      warnings: ['Unresolved: Raymond James Stadium (api_budget reached)'],
      cached: false,
    });
    expect(out.results[2].reason).toBe('api_budget reached');
    expect(out.apiCalls).toMatchObject({ textSearch: 1, budget: 1, remaining: 0 });
    expect(texts(r)[0]).toContain('Unresolved: Raymond James Stadium (api_budget reached)');
  });

  it('still answers free cache hits after the budget is spent', async () => {
    const api = fakeApi({ search: { Armature: [ARMATURE], Raymond: [STADIUM] } });
    await start(api);
    await harness.callTool('gog_places_resolve', { items: [ITEMS[1]] });
    const r = await harness.callTool('gog_places_resolve', {
      items: [{ name: 'Nowhere' }, { name: 'Elsewhere' }, ITEMS[1]],
      api_budget: 1,
    });
    const out = data(r);
    expect(out.results.map((x: { resolved?: boolean; cached: boolean }) => x.resolved ?? x.cached)).toEqual([false, false, true]);
    expect(out.results[0].reason).toBe('no match found');
    expect(out.results[1].reason).toBe('api_budget reached');
  });

  it('flags an ambiguous top match and puts closed businesses first', async () => {
    await start(fakeApi({ search: { Bernie: [STADIUM], Diner: [GONE] } }));
    const r = await harness.callTool('gog_places_resolve', { items: [{ name: "Bernie's Tacos" }, { name: 'Old Diner' }] });
    const out = data(r);
    expect(out.results[0]).toMatchObject({ matchConfidence: 'low' });
    expect(out.results[0].warnings).toEqual(['Ambiguous: asked for "Bernie\'s Tacos", the top match is "Raymond James Stadium"']);
    expect(out.results[1].warnings).toEqual(['⚠️ CLOSED PERMANENTLY: Old Diner']);
    expect(texts(r)[0].split('\n')).toEqual([
      '⚠️ CLOSED PERMANENTLY: Old Diner',
      'Ambiguous: asked for "Bernie\'s Tacos", the top match is "Raymond James Stadium"',
    ]);
  });

  it('the full view returns hours periods instead of weekday text', async () => {
    await start(fakeApi({ search: { Armature: [ARMATURE] } }));
    const r = await harness.callTool('gog_places_resolve', { items: [ITEMS[0]], view: 'full' });
    expect(data(r).results[0].regularOpeningHours.periods).toHaveLength(6);
  });

  it('a refused key (403) stops further requests; a bad single request (400) does not', async () => {
    let n = 0;
    const api = fakeApi({
      override: () => (++n === 1
        ? json(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad query' } })
        : json(403, { error: { status: 'PERMISSION_DENIED', message: 'key refused' } })),
    });
    await start(api);
    const r = await harness.callTool('gog_places_resolve', { items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    expect(api.calls).toHaveLength(2);
    const reasons = data(r).results.map((x: { reason: string }) => x.reason);
    expect(reasons[0]).toMatch(/400 INVALID_ARGUMENT/);
    expect(reasons[1]).toMatch(/403 PERMISSION_DENIED/);
    expect(reasons[2]).toBe(reasons[1]);
  });

  it('a missing key leaves every item unresolved with the setup hint, sending nothing', async () => {
    const api = fakeApi();
    await start(api, { env: {}, readGogConfig: async () => undefined });
    const r = await harness.callTool('gog_places_resolve', { items: [{ name: 'A' }, { name: 'B' }] });
    expect(api.calls).toHaveLength(0);
    expect(data(r).results.every((x: { reason: string }) => /places_api_key/.test(x.reason))).toBe(true);
  });

  it('reports a cache that cannot be read as a tool error rather than throwing', async () => {
    const broken = { lookupQuery: async () => { throw new Error('disk on fire'); }, save: async () => true } as unknown as PlacesCache;
    await start(fakeApi(), { cache: () => broken });
    const r = await harness.callTool('gog_places_resolve', { items: [{ name: 'A' }] });
    // A non-API failure is fatal for the batch but still reported per item.
    expect(data(r).results[0].reason).toBe('disk on fire');
  });
});

describe('gog_places_details', () => {
  it('evaluates open-at, always with the FULL mask', async () => {
    const api = fakeApi({ details: { ChIJ_armature: ARMATURE } });
    await start(api);
    const r = await harness.callTool('gog_places_details', {
      placeId: 'places/ChIJ_armature', at: '2026-11-21T19:30', fields: 'basic',
    });
    expect(api.calls[0].url).toBe(`${PLACES_API_BASE}/places/ChIJ_armature`);
    expect((api.calls[0].init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('regularOpeningHours');
    const out = data(r);
    expect(out.openAt).toEqual({ at: '2026-11-21T19:30', open: true, closesAt: '2026-11-21T22:00', reason: 'open until 22:00' });
    expect(out.place).toMatchObject({ websiteUri: 'https://armatureworks.com/', priceLevel: 'PRICE_LEVEL_MODERATE' });
    expect(out).toMatchObject({ cached: false, warnings: [], apiCalls: { details: 1, sku: 'Enterprise' } });
  });

  it('warns when the place is not open at the planned time', async () => {
    await start(fakeApi({ details: { ChIJ_armature: ARMATURE } }));
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature', at: { date: '2026-11-22', time: '12:00' } });
    expect(texts(r)[0]).toBe('Not open at 2026-11-22T12:00: closed; opens Mon 2026-11-23 11:00');
    expect(data(r).openAt).toMatchObject({ open: false, opensAt: '2026-11-23T11:00' });
  });

  it('a closed business gets the loud warning only', async () => {
    await start(fakeApi({ details: { ChIJ_gone: GONE } }));
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_gone', at: '2026-11-21T19:30' });
    expect(data(r).warnings).toEqual(['⚠️ CLOSED PERMANENTLY: Old Diner']);
    expect(data(r).openAt).toMatchObject({ open: false, reason: 'closed permanently' });
  });

  it('refuses a bad `at` before spending anything', async () => {
    const api = fakeApi({ details: { ChIJ_armature: ARMATURE } });
    await start(api);
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature', at: '2026-11-21T19:30Z' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/no Z or offset/);
    expect(api.calls).toHaveLength(0);
  });

  it('serves a fresh cache entry for free, and refresh fetches again', async () => {
    const api = fakeApi({ details: { ChIJ_armature: ARMATURE } });
    await start(api);
    await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature' });
    const hit = await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature' });
    expect(data(hit)).toMatchObject({ cached: true, apiCalls: { details: 0 } });
    expect(data(hit).openAt).toBeUndefined();
    await harness.callTool('gog_places_details', { placeId: 'ChIJ_armature', refresh: true });
    expect(api.calls).toHaveLength(2);
  });

  it('surfaces an API error as a tool error', async () => {
    await start(fakeApi());
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_missing' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/404 NOT_FOUND/);
  });

  it('a thrown non-Error is reported as text', async () => {
    const broken = { lookupPlace: async () => { throw 'plain string'; }, save: async () => true } as unknown as PlacesCache;
    await start(fakeApi(), { cache: () => broken });
    const r = await harness.callTool('gog_places_details', { placeId: 'ChIJ_x' });
    expect(texts(r)[0]).toBe('plain string');
  });
});

describe('projectPlace', () => {
  it('compact drops empty accessibility and falls back to the international phone', () => {
    expect(projectPlace({
      id: 'x',
      internationalPhoneNumber: '+1 555',
      accessibilityOptions: { wheelchairAccessibleEntrance: false },
    }, 'compact')).toEqual({ placeId: 'x', phone: '+1 555' });
    expect(projectPlace({ id: 'y' }, 'compact')).toEqual({ placeId: 'y' });
  });
});

describe('default cache', () => {
  it('uses ~/.gogcli-mcp/places-cache.json under HOME', async () => {
    const saved = process.env.HOME;
    process.env.HOME = dir;
    try {
      await harness?.close();
      harness = await createTestHarness(placesTools({
        fetch: fakeApi({ search: { x: [STADIUM] } }).fetch,
        env: { GOG_PLACES_API_KEY: KEY },
      }));
      await harness.callTool('gog_places_search', { query: 'x' });
      expect(JSON.parse(readFileSync(join(dir, '.gogcli-mcp', 'places-cache.json'), 'utf8')).places).toHaveProperty('ChIJ_stadium');
    } finally {
      process.env.HOME = saved;
    }
  });
});
