import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTENT_TTL_MS,
  LOCATION_TTL_MS,
  PlacesCache,
  cacheKey,
  defaultCachePath,
  normalizeForKey,
  type PlaceLocation,
} from '../src/places-cache.js';
import type { GogPlace } from '../src/places-gog.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);

const PLACE: GogPlace = {
  id: 'ChIJ_armature',
  name: 'Armature Works',
  formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
  googleMapsUri: 'https://maps.google.com/?cid=1',
};
const POINT: PlaceLocation = { lat: 27.9606, lng: -82.4637, match: 'exact' };

let dir: string;
let path: string;
let clock: number;
const now = (): number => clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'places-cache-test-'));
  path = join(dir, 'state', 'places-cache.json');
  clock = T0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function cache(opts: Partial<ConstructorParameters<typeof PlacesCache>[0]> = {}): PlacesCache {
  return new PlacesCache({ path, now, log: () => {}, ...opts });
}

describe('key normalization', () => {
  it('lowercases, trims, collapses whitespace and strips punctuation but keeps letters and digits', () => {
    expect(normalizeForKey('  Raymond   James\tStadium, 4201 N. Dale Mabry Hwy! ')).toBe('raymond james stadium 4201 n dale mabry hwy');
    expect(normalizeForKey("Bern's Steak House")).toBe('berns steak house');
    expect(normalizeForKey('Café Hey — Ybor/TECO')).toBe('café hey ybor teco');
  });

  it('joins name and address with a pipe, address optional', () => {
    expect(cacheKey('Armature Works', '1910 N Ola Ave')).toBe('armature works|1910 n ola ave');
    expect(cacheKey('Armature Works')).toBe('armature works|');
    expect(cacheKey('ARMATURE  works.', undefined)).toBe(cacheKey('armature works'));
  });

  it('defaults to ~/.gogcli-mcp/places-cache.json under HOME', () => {
    expect(defaultCachePath('/home/x')).toBe(join('/home/x', '.gogcli-mcp', 'places-cache.json'));
    expect(defaultCachePath()).toMatch(/\.gogcli-mcp[/\\]places-cache\.json$/);
  });
});

describe('TTL boundaries', () => {
  it('location is good for 30 days, content for 24 h', () => {
    expect(LOCATION_TTL_MS).toBe(30 * DAY);
    expect(CONTENT_TTL_MS).toBe(DAY);
  });

  it('content is fresh just under 24 h and gone just over; the point outlives it', async () => {
    const c = cache();
    await c.putPlace(PLACE, { name: 'Armature Works', address: 'Tampa' });
    await c.putLocation(PLACE.id, POINT);
    clock = T0 + 23 * HOUR + 59 * MIN;
    expect(await c.lookupQuery('armature works', 'TAMPA')).toEqual({ placeId: PLACE.id, content: PLACE, location: POINT });
    clock = T0 + DAY + 1000;
    expect(await c.lookupQuery('Armature Works', 'Tampa')).toEqual({ placeId: PLACE.id, location: POINT });
  });

  it('keeps the point 29d23h, drops it after 30d+1s, and never expires the place id', async () => {
    const c = cache();
    await c.putPlace(PLACE, { name: 'Armature Works' });
    await c.putLocation(PLACE.id, POINT);
    clock = T0 + 29 * DAY + 23 * HOUR;
    await c.save();
    const stored29 = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored29.places[PLACE.id].location.point).toEqual(POINT);
    expect(stored29.places[PLACE.id].content).toBeUndefined();

    clock = T0 + 30 * DAY + 1000;
    await c.putPlace({ id: 'other' });
    await c.save();
    const stored30 = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored30.places[PLACE.id]).toEqual({});
    expect(stored30.queries['armature works|']).toBe(PLACE.id);

    clock = T0 + 3650 * DAY;
    expect(await cache().lookupQuery('Armature Works')).toEqual({ placeId: PLACE.id });
    expect(await cache().lookupPlace(PLACE.id)).toEqual({ placeId: PLACE.id });
  });

  it('honours a lower location TTL', async () => {
    const c = cache({ locationTtlMs: HOUR });
    await c.putPlace(PLACE);
    await c.putLocation(PLACE.id, POINT);
    clock = T0 + HOUR + 1;
    expect(await c.lookupPlace(PLACE.id)).toEqual({ placeId: PLACE.id, content: PLACE });
  });

  it('remembers that the geocoder found nothing (null), distinct from never asked (absent)', async () => {
    const c = cache();
    await c.putPlace(PLACE);
    expect(await c.lookupPlace(PLACE.id)).toEqual({ placeId: PLACE.id, content: PLACE });
    await c.putLocation(PLACE.id, null);
    expect(await c.lookupPlace(PLACE.id)).toEqual({ placeId: PLACE.id, content: PLACE, location: null });
  });

  it('a point can be stored before (or without) content', async () => {
    const c = cache();
    await c.putLocation('lonely', POINT);
    expect(await c.lookupPlace('lonely')).toEqual({ placeId: 'lonely', location: POINT });
  });

  it('refuses a location TTL above 30 days or not positive', () => {
    expect(() => cache({ locationTtlMs: 30 * DAY + 1 })).toThrow(RangeError);
    expect(() => cache({ locationTtlMs: 0 })).toThrow(RangeError);
    expect(() => cache({ locationTtlMs: 30 * DAY })).not.toThrow();
  });

  it('treats a timestamp from the future as stale (clock skew cannot pin data forever)', async () => {
    const c = cache();
    clock = T0 + DAY;
    await c.putPlace(PLACE);
    clock = T0;
    expect((await c.lookupPlace(PLACE.id))?.content).toBeUndefined();
  });
});

describe('lookups', () => {
  it('misses on an unknown query or id', async () => {
    const c = cache();
    expect(await c.lookupQuery('nowhere')).toBeUndefined();
    expect(await c.lookupPlace('nope')).toBeUndefined();
  });

  it('indexes by query and by place id, and a later put refreshes both', async () => {
    const c = cache();
    await c.putPlace(PLACE, { name: 'Armature Works', address: '1910 N Ola Ave' });
    expect((await c.lookupPlace(PLACE.id))?.content?.name).toBe('Armature Works');
    await c.putPlace({ ...PLACE, name: 'Armature Works (renamed)' });
    expect((await c.lookupQuery('Armature Works', '1910 N Ola Ave'))?.content?.name).toBe('Armature Works (renamed)');
  });

  it('returns copies, so a caller mutating a result cannot poison the cache', async () => {
    const c = cache();
    await c.putPlace(PLACE);
    await c.putLocation(PLACE.id, POINT);
    const first = await c.lookupPlace(PLACE.id);
    first!.content!.name = 'mutated';
    first!.location!.lat = 0;
    const again = await c.lookupPlace(PLACE.id);
    expect(again?.content?.name).toBe('Armature Works');
    expect(again?.location?.lat).toBe(27.9606);
  });

  it('a query pointing at a place with no stored entry is a bare id hit', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 2, places: {}, queries: { 'x|': 'ChIJ_orphan' } }));
    expect(await cache().lookupQuery('x')).toEqual({ placeId: 'ChIJ_orphan' });
  });
});

describe('persistence', () => {
  it('round-trips through disk with a private file mode and no temp files left behind', async () => {
    const c = cache();
    await c.putPlace(PLACE, { name: 'Armature Works' });
    await c.putLocation(PLACE.id, { ...POINT, match: 'approximate' });
    expect(await c.save()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'state')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(dir, 'state'))).toEqual(['places-cache.json']);
    clock = T0 + HOUR;
    expect(await cache().lookupQuery('armature works')).toEqual({
      placeId: PLACE.id, content: PLACE, location: { ...POINT, match: 'approximate' },
    });
  });

  it('does not write when nothing changed', async () => {
    const c = cache();
    expect(await c.save()).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('prunes expired content when loading, before anything can read it', async () => {
    const c = cache();
    await c.putPlace(PLACE);
    await c.putLocation(PLACE.id, POINT);
    await c.save();
    clock = T0 + DAY + 1;
    const reloaded = cache();
    await reloaded.putPlace({ id: 'unrelated' });
    await reloaded.save();
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.places[PLACE.id].content).toBeUndefined();
    expect(stored.places[PLACE.id].location).toBeDefined();
  });

  const corrupt: Array<[string, string]> = [
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['the v1 (direct-HTTPS) format', JSON.stringify({ version: 1, places: {}, queries: {} })],
    ['a non-object places map', JSON.stringify({ version: 2, places: [], queries: {} })],
    ['a missing queries map', JSON.stringify({ version: 2, places: {} })],
  ];
  for (const [label, contents] of corrupt) {
    it(`starts empty, without throwing, on ${label}`, async () => {
      mkdirSync(join(dir, 'state'), { recursive: true });
      writeFileSync(path, contents);
      const log = vi.fn();
      const c = cache({ log });
      expect(await c.lookupPlace('x')).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/places cache .*unreadable.*starting empty/));
      await c.putPlace(PLACE);
      expect(await c.save()).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2);
    });
  }

  it('drops malformed entries and fields but keeps the good ones', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 2,
      places: {
        good: {
          content: { fetchedAt: T0, data: { name: 'Good', formattedAddress: 7, extra: 'x' } },
          location: { fetchedAt: T0, point: { lat: 1, lng: 2, match: 'exact' } },
        },
        none: { location: { fetchedAt: T0, point: null } },
        badContent: { content: { fetchedAt: 'yesterday', data: {} } },
        badPoint: { location: { fetchedAt: T0, point: { lat: 'x', lng: 2, match: 'exact' } } },
        badMatch: { location: { fetchedAt: T0, point: { lat: 1, lng: 2, match: 'close' } } },
        badLocation: { location: 'here' },
        notObject: 7,
      },
      queries: { 'good|': 'good', 'bad|': 42 },
    }));
    const c = cache();
    expect(await c.lookupPlace('good')).toEqual({
      placeId: 'good', content: { id: 'good', name: 'Good' }, location: { lat: 1, lng: 2, match: 'exact' },
    });
    expect(await c.lookupPlace('none')).toEqual({ placeId: 'none', location: null });
    for (const id of ['badContent', 'badPoint', 'badMatch', 'badLocation']) {
      expect(await c.lookupPlace(id)).toEqual({ placeId: id });
    }
    expect(await c.lookupPlace('notObject')).toBeUndefined();
    expect(await c.lookupQuery('bad')).toBeUndefined();
  });

  it('a missing file is simply empty and logs nothing', async () => {
    const log = vi.fn();
    expect(await cache({ log }).lookupPlace('x')).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('an unreadable path logs and starts empty', async () => {
    mkdirSync(path, { recursive: true }); // a directory where the file should be
    const log = vi.fn();
    expect(await cache({ log }).lookupPlace('x')).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/unreadable/));
  });

  it('a failed save returns false, logs, and leaves no temp file', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    chmodSync(join(dir, 'state'), 0o500);
    const log = vi.fn();
    const c = cache({ log });
    try {
      await c.putPlace(PLACE);
      expect(await c.save()).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not save places cache/));
      expect(readdirSync(join(dir, 'state'))).toEqual([]);
    } finally {
      chmodSync(join(dir, 'state'), 0o700);
    }
  });

  it('a failed rename cleans up its temp file', async () => {
    mkdirSync(path, { recursive: true }); // rename onto a non-empty directory fails
    writeFileSync(join(path, 'occupied'), '');
    const log = vi.fn();
    const c = cache({ log });
    await c.putPlace(PLACE);
    expect(await c.save()).toBe(false);
    expect(readdirSync(join(dir, 'state'))).toEqual(['places-cache.json']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not save places cache/));
  });

  it('uses the default path, clock and stderr logger when none are injected', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('HOME', dir);
    try {
      const c = new PlacesCache();
      mkdirSync(join(dir, '.gogcli-mcp'), { recursive: true });
      writeFileSync(join(dir, '.gogcli-mcp', 'places-cache.json'), '{oops');
      await c.putPlace(PLACE);
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^\[gogcli-mcp-maps\] places cache/));
      expect(await c.save()).toBe(true);
      expect(existsSync(join(dir, '.gogcli-mcp', 'places-cache.json'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      stderr.mockRestore();
    }
  });
});
