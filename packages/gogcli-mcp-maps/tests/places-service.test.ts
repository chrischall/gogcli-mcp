import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiBudget } from '../src/budget.js';
import { PlacesCache } from '../src/places-cache.js';
import { PLACES_API_BASE, PlacesClient, type FetchLike, type PlacesPlace } from '../src/places-client.js';
import { matchConfidence, placeName, resolveItems, statusWarnings } from '../src/places-service.js';

const PLACE: PlacesPlace = {
  id: 'ChIJ_teco',
  displayName: { text: 'Centennial Park Station' },
  location: { latitude: 27.96, longitude: -82.44 },
  businessStatus: 'CLOSED_TEMPORARILY',
};

describe('matchConfidence', () => {
  it('high for equal or contained names', () => {
    expect(matchConfidence('Armature Works', 'Armature Works')).toBe('high');
    expect(matchConfidence('Armature Works', 'Armature Works Food Hall')).toBe('high');
    expect(matchConfidence('Cigar City Brewing Tampa', 'Cigar City Brewing')).toBe('high');
  });

  it('medium when most meaningful words are shared', () => {
    expect(matchConfidence('Tampa Riverwalk Park', 'The Riverwalk Tampa')).toBe('medium');
  });

  it('low when the words differ, the name is missing, or nothing meaningful is left', () => {
    expect(matchConfidence('Bern\'s Steak House', 'Raymond James Stadium')).toBe('low');
    expect(matchConfidence('Armature Works', undefined)).toBe('low');
    expect(matchConfidence('!!!', 'The')).toBe('low');
    expect(matchConfidence('The', '—')).toBe('low');
  });
});

describe('placeName / statusWarnings', () => {
  it('falls back to the address, then the id', () => {
    expect(placeName({ id: 'x', formattedAddress: '1 Main St' })).toBe('1 Main St');
    expect(placeName({ id: 'x' })).toBe('x');
  });

  it('warns loudly for a temporarily closed place and not for an open one', () => {
    expect(statusWarnings(PLACE)).toEqual(['⚠️ CLOSED TEMPORARILY: Centennial Park Station']);
    expect(statusWarnings({ id: 'x', businessStatus: 'OPERATIONAL' })).toEqual([]);
  });
});

describe('resolveItems with a known place id', () => {
  let dir: string;
  let cache: PlacesCache;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'places-service-test-'));
    cache = new PlacesCache({ path: join(dir, 'c.json'), now: () => 0, log: () => {} });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fetches Details by id (no search, no name index), then serves it from the cache', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(PLACE), { status: 200 });
    };
    const ctx = () => ({ client: new PlacesClient({ fetch, apiKey: 'k', budget: new ApiBudget(5) }), cache, fields: 'full' as const });
    const item = { name: 'TECO streetcar', placeId: 'ChIJ_teco' };
    const [first] = await resolveItems([item], ctx());
    expect(urls).toEqual([`${PLACES_API_BASE}/places/ChIJ_teco`]);
    expect(first).toMatchObject({ cached: false, matchConfidence: 'high', warnings: ['⚠️ CLOSED TEMPORARILY: Centennial Park Station'] });
    expect(await cache.lookupQuery('TECO streetcar', undefined, 'full')).toBeUndefined();
    const [second] = await resolveItems([item], ctx());
    expect(urls).toHaveLength(1);
    expect(second.cached).toBe(true);
  });

  it('reports a thrown non-Error as its text', async () => {
    const failing = { details: async () => { throw 'boom'; } } as unknown as PlacesClient;
    const [r] = await resolveItems([{ name: 'x', placeId: 'ChIJ_x' }], { client: failing, cache, fields: 'basic' });
    expect(r.reason).toBe('boom');
  });
});
