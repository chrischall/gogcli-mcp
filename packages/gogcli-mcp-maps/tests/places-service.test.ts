import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlacesCache } from '../src/places-cache.js';
import {
  matchConfidence,
  newCallCounter,
  placeName,
  queryText,
  resolveItems,
  type ServiceContext,
} from '../src/places-service.js';
import { ARMATURE, fakeMapsGog, GEO, positionals, STADIUM, type MapsFixtures } from './support/fake-maps.js';

describe('matchConfidence', () => {
  it('high for equal names or whole-word containment', () => {
    expect(matchConfidence('Armature Works', 'Armature Works')).toBe('high');
    expect(matchConfidence('Armature Works', 'Armature Works Food Hall')).toBe('high');
    expect(matchConfidence('Cigar City Brewing Tampa', 'Cigar City Brewing')).toBe('high');
  });

  it('a substring that is not a whole word is not a match ("Star" is not "Starbucks")', () => {
    expect(matchConfidence('Star', 'Starbucks')).toBe('low');
    expect(matchConfidence('Starbucks Reserve', 'Star')).toBe('low');
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

describe('placeName / queryText', () => {
  it('falls back to the address, then the id', () => {
    expect(placeName({ id: 'x', name: 'X' })).toBe('X');
    expect(placeName({ id: 'x', formattedAddress: '1 Main St' })).toBe('1 Main St');
    expect(placeName({ id: 'x' })).toBe('x');
  });

  it('appends address and the near hint to the name', () => {
    expect(queryText({ name: 'Harbor Cafe' })).toBe('Harbor Cafe');
    expect(queryText({ name: 'Harbor Cafe', near: 'Tampa FL' })).toBe('Harbor Cafe, Tampa FL');
    expect(queryText({ name: 'Harbor Cafe', address: '1 Bay St', near: 'Tampa FL' })).toBe('Harbor Cafe, 1 Bay St, Tampa FL');
  });
});

describe('resolveItems', () => {
  let dir: string;
  let cache: PlacesCache;
  let clock: number;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'places-service-test-'));
    clock = 0;
    cache = new PlacesCache({ path: join(dir, 'c.json'), now: () => clock, log: () => {} });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const FX: MapsFixtures = { search: { Armature: ARMATURE, Stadium: STADIUM }, details: { ChIJ_stadium: STADIUM }, geocode: GEO };
  const ctxFor = (gog: ReturnType<typeof fakeMapsGog>, extra: Partial<ServiceContext> = {}): ServiceContext => ({
    cache, spawner: gog.spawner, calls: newCallCounter(), ...extra,
  });

  it('search → geocode: an exact point is ok, with the query text carrying address and near', async () => {
    const gog = fakeMapsGog(FX);
    const ctx = ctxFor(gog);
    const [r] = await resolveItems([{ name: 'Armature Works', near: 'Tampa FL' }], ctx);
    expect(r).toMatchObject({
      status: 'ok',
      place: { id: 'ChIJ_armature', name: 'Armature Works' },
      location: { lat: 27.9606, lng: -82.4637, match: 'exact' },
      cached: false,
      matchConfidence: 'high',
      warnings: [],
    });
    expect(positionals(gog.calls('maps', 'places', 'search')[0]!)).toEqual(['Armature Works, Tampa FL']);
    expect(positionals(gog.calls('maps', 'geocode')[0]!)).toEqual([ARMATURE.formatted_address]);
    expect(ctx.calls).toEqual({ search: 1, details: 0, geocode: 1 });
  });

  it('a geocode that lands on a different place id is approximate, and says so', async () => {
    const gog = fakeMapsGog(FX);
    const [r] = await resolveItems([{ name: 'Raymond James Stadium' }], ctxFor(gog));
    expect(r!.status).toBe('approximate');
    expect(r!.location).toEqual({ lat: 27.9759, lng: -82.5033, match: 'approximate' });
    expect(r!.warnings).toEqual([expect.stringMatching(/^Approximate: Raymond James Stadium/)]);
  });

  it('a known place id uses details then geocode, never search, and is high confidence', async () => {
    const gog = fakeMapsGog(FX);
    const ctx = ctxFor(gog);
    const [r] = await resolveItems([{ name: 'The big stadium', placeId: 'ChIJ_stadium' }], ctx);
    expect(r).toMatchObject({ status: 'approximate', place: { id: 'ChIJ_stadium' }, matchConfidence: 'high' });
    expect(ctx.calls).toEqual({ search: 0, details: 1, geocode: 1 });
  });

  it('caller coordinates skip the geocode and make the item ok', async () => {
    const gog = fakeMapsGog(FX);
    const ctx = ctxFor(gog);
    const [r] = await resolveItems([{ name: 'Raymond James Stadium', lat: 1, lng: 2 }], ctx);
    expect(r).toMatchObject({ status: 'ok', location: { lat: 1, lng: 2, match: 'given' } });
    expect(ctx.calls.geocode).toBe(0);
  });

  it('no match is not_found; with caller coordinates the point is still kept', async () => {
    const gog = fakeMapsGog(FX);
    const [plain, pinned] = await resolveItems([{ name: 'Nowhere Diner' }, { name: 'Nowhere Diner', lat: 1, lng: 2 }], ctxFor(gog));
    expect(plain).toMatchObject({ status: 'not_found', reason: 'no match found', warnings: ['Not found: Nowhere Diner'] });
    expect(plain!.place).toBeUndefined();
    expect(pinned).toMatchObject({ status: 'not_found', location: { lat: 1, lng: 2, match: 'given' } });
    expect(pinned!.warnings[0]).toMatch(/using the given coordinates/);
  });

  it('a place the geocoder cannot place is approximate with no point, and that is remembered', async () => {
    const gog = fakeMapsGog({ search: { Riverwalk: { id: 'ChIJ_rw', name: 'Tampa Riverwalk' } } });
    const ctx = ctxFor(gog);
    const [r] = await resolveItems([{ name: 'Tampa Riverwalk' }], ctx);
    expect(r).toMatchObject({ status: 'approximate', reason: 'no coordinates for this place' });
    expect(r!.location).toBeUndefined();
    // With no formatted address, the query text is what gets geocoded.
    expect(positionals(gog.calls('maps', 'geocode')[0]!)).toEqual(['Tampa Riverwalk']);
    const [again] = await resolveItems([{ name: 'Tampa Riverwalk' }], ctx);
    expect(again!.cached).toBe(true);
    expect(gog.calls('maps', 'geocode')).toHaveLength(1);
  });

  it('flags a low-confidence top match as ambiguous, unless names are not checked', async () => {
    const gog = fakeMapsGog({ search: { Cigar: STADIUM }, geocode: GEO });
    const [r] = await resolveItems([{ name: 'Cigar City Brewing' }], ctxFor(gog));
    expect(r!.matchConfidence).toBe('low');
    expect(r!.warnings).toContain('Ambiguous: asked for "Cigar City Brewing", the top match is "Raymond James Stadium"');
    const [s] = await resolveItems([{ name: 'Cigar sandwich near the stadium' }], ctxFor(gog, { checkNames: false }));
    expect(s!.matchConfidence).toBeUndefined();
    expect(s!.warnings.some((w) => w.startsWith('Ambiguous'))).toBe(false);
  });

  it('a gog failure is an error item; a failed geocode keeps the place', async () => {
    const gog = fakeMapsGog({
      ...FX,
      fail: (argv) => (argv.includes('geocode') ? 'maps API error 403: REQUEST_DENIED' : argv.includes('Broken') ? 'boom' : undefined),
    });
    const [broken, nogeo] = await resolveItems([{ name: 'Broken' }, { name: 'Armature Works' }], ctxFor(gog));
    expect(broken).toMatchObject({ status: 'error', reason: 'boom', warnings: ['Error: Broken (boom)'] });
    expect(nogeo).toMatchObject({ status: 'error', place: { id: 'ChIJ_armature' }, reason: expect.stringMatching(/REQUEST_DENIED/) });
    expect(nogeo!.location).toBeUndefined();
  });

  it('serves a repeat from the cache with no gog call, and refresh bypasses it', async () => {
    const gog = fakeMapsGog(FX);
    await resolveItems([{ name: 'Armature Works', address: 'Tampa' }], ctxFor(gog));
    const ctx = ctxFor(gog);
    const [hit] = await resolveItems([{ name: 'armature works', address: 'TAMPA' }], ctx);
    expect(hit).toMatchObject({ status: 'ok', cached: true, location: { match: 'exact' } });
    expect(ctx.calls).toEqual({ search: 0, details: 0, geocode: 0 });
    const fresh = ctxFor(gog, { refresh: true });
    const [again] = await resolveItems([{ name: 'Armature Works', address: 'Tampa' }], fresh);
    expect(again!.cached).toBe(false);
    expect(fresh.calls).toEqual({ search: 1, details: 0, geocode: 1 });
  });

  it('stale content with a known id costs one details call, not a search; a fresh point is reused', async () => {
    const gog = fakeMapsGog(FX);
    await resolveItems([{ name: 'Raymond James Stadium' }], ctxFor(gog));
    clock = 25 * 3_600_000;
    const ctx = ctxFor(gog);
    const [r] = await resolveItems([{ name: 'Raymond James Stadium' }], ctx);
    expect(ctx.calls).toEqual({ search: 0, details: 1, geocode: 0 });
    expect(r).toMatchObject({ status: 'approximate', cached: false });
    // A known-id item is cached by id too.
    const byId = ctxFor(gog);
    await resolveItems([{ name: 'x', placeId: 'ChIJ_stadium' }], byId);
    expect(byId.calls).toEqual({ search: 0, details: 0, geocode: 0 });
  });

  it('runs at most 4 gog calls at once and keeps the input order', async () => {
    let active = 0;
    let peak = 0;
    const base = fakeMapsGog(FX);
    const spawner = ((cmd: string, argv: string[], o: unknown) => {
      active += 1;
      peak = Math.max(peak, active);
      const proc = (base.spawner as unknown as (...a: unknown[]) => NodeJS.EventEmitter)(cmd, argv, o);
      proc.on('close', () => { active -= 1; });
      return proc;
    }) as unknown as ServiceContext['spawner'];
    const names = Array.from({ length: 10 }, (_, i) => (i % 2 ? `Stadium ${i}` : `Armature ${i}`));
    const out = await resolveItems(names.map((name) => ({ name })), { cache, spawner, refresh: true });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(out.map((r) => r.input.name)).toEqual(names);
  });

  it('stops issuing gog calls once the signal aborts; the rest come back as cancelled errors', async () => {
    const controller = new AbortController();
    const gog = fakeMapsGog({ ...FX, fail: (argv) => { if (argv.includes('geocode')) controller.abort(); return undefined; } });
    const ctx = ctxFor(gog, { signal: controller.signal, concurrency: 1 });
    const out = await resolveItems([{ name: 'Armature Works' }, { name: 'Raymond James Stadium' }], ctx);
    expect(gog.argvs).toHaveLength(2); // search + geocode for the first item, nothing after the abort
    expect(out[0]!.status).toBe('ok');
    expect(out[1]).toMatchObject({ status: 'error', reason: 'cancelled' });
  });

  it('looks a repeated item up once per call; the repeat is free', async () => {
    const gog = fakeMapsGog(FX);
    const ctx = ctxFor(gog);
    const out = await resolveItems([{ name: 'Armature Works' }, { name: 'Raymond James Stadium' }, { name: 'Armature Works' }], ctx);
    expect(ctx.calls).toEqual({ search: 2, details: 0, geocode: 2 });
    expect(out[2]).toMatchObject({ status: 'ok', cached: true, input: { name: 'Armature Works' } });
    expect(out[0]!.cached).toBe(false);
  });

  it('counts nothing when no counter is passed', async () => {
    const gog = fakeMapsGog(FX);
    const [r] = await resolveItems([{ name: 'Armature Works' }], { cache, spawner: gog.spawner });
    expect(r!.status).toBe('ok');
  });
});
