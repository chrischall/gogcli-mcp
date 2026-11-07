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
} from '../src/places-cache.js';
import type { PlacesPlace } from '../src/places-client.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);

const PLACE: PlacesPlace = {
  id: 'ChIJ_armature',
  displayName: { text: 'Armature Works' },
  formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
  location: { latitude: 27.9606, longitude: -82.4637 },
  googleMapsUri: 'https://maps.google.com/?cid=1',
  businessStatus: 'OPERATIONAL',
  utcOffsetMinutes: -300,
  websiteUri: 'https://armatureworks.com/',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 7:00 AM – 10:00 PM'] },
};

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
  it('location is good for 30 days and no longer', () => {
    expect(LOCATION_TTL_MS).toBe(30 * DAY);
    expect(CONTENT_TTL_MS).toBe(DAY);
  });

  it('a full hit is fresh just under 24 h, and needs Details just over', async () => {
    const c = cache();
    await c.put(PLACE, 'full', { name: 'Armature Works', address: 'Tampa' });
    clock = T0 + 23 * HOUR + 59 * MIN;
    expect(await c.lookupQuery('armature works', 'TAMPA', 'full')).toEqual({ placeId: PLACE.id, fresh: true, place: PLACE });
    clock = T0 + DAY + 1000;
    expect(await c.lookupQuery('Armature Works', 'Tampa', 'full')).toEqual({ placeId: PLACE.id, fresh: false });
  });

  it('keeps the location 29d23h, drops it after 30d+1s, and never expires the place id', async () => {
    const c = cache();
    await c.put(PLACE, 'basic', { name: 'Armature Works' });
    clock = T0 + 29 * DAY + 23 * HOUR;
    await c.save();
    const stored29 = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored29.places[PLACE.id].location).toMatchObject({ latitude: 27.9606, longitude: -82.4637 });
    expect(stored29.places[PLACE.id].content).toBeUndefined();

    clock = T0 + 30 * DAY + 1000;
    await c.put({ id: 'other' }, 'basic');
    await c.save();
    const stored30 = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored30.places[PLACE.id]).toEqual({});
    expect(stored30.queries['armature works|']).toBe(PLACE.id);

    clock = T0 + 3650 * DAY;
    expect(await cache().lookupQuery('Armature Works', undefined, 'basic')).toEqual({ placeId: PLACE.id, fresh: false });
    expect(await cache().lookupPlace(PLACE.id, 'basic')).toEqual({ placeId: PLACE.id, fresh: false });
  });

  it('content fresh but location stale (a lower location TTL) still needs Details', async () => {
    const c = cache({ locationTtlMs: HOUR });
    await c.put(PLACE, 'full');
    clock = T0 + HOUR + 1;
    expect(await c.lookupPlace(PLACE.id, 'full')).toEqual({ placeId: PLACE.id, fresh: false });
  });

  it('dropping expired coordinates drops the content with them, so a hit never loses its location', async () => {
    const c = cache({ locationTtlMs: HOUR });
    await c.put(PLACE, 'full');
    clock = T0 + HOUR + 1;
    await c.save();
    expect(JSON.parse(readFileSync(path, 'utf8')).places[PLACE.id]).toEqual({});
    expect(await c.lookupPlace(PLACE.id, 'full')).toEqual({ placeId: PLACE.id, fresh: false });
  });

  it('a place with no location is fresh on content alone', async () => {
    const c = cache();
    const { location: _drop, ...noLocation } = PLACE;
    await c.put(noLocation, 'full');
    expect(await c.lookupPlace(PLACE.id, 'full')).toEqual({ placeId: PLACE.id, fresh: true, place: noLocation });
  });

  it('a basic entry does not satisfy a full lookup, but a full one satisfies basic', async () => {
    const c = cache();
    await c.put({ id: 'b', displayName: { text: 'B' } }, 'basic');
    await c.put({ id: 'f', displayName: { text: 'F' } }, 'full');
    expect((await c.lookupPlace('b', 'full'))?.fresh).toBe(false);
    expect((await c.lookupPlace('b', 'basic'))?.fresh).toBe(true);
    expect((await c.lookupPlace('f', 'basic'))?.fresh).toBe(true);
  });

  it('refuses a location TTL above 30 days or not positive', () => {
    expect(() => cache({ locationTtlMs: 30 * DAY + 1 })).toThrow(RangeError);
    expect(() => cache({ locationTtlMs: 0 })).toThrow(RangeError);
    expect(() => cache({ locationTtlMs: 30 * DAY })).not.toThrow();
  });

  it('treats a timestamp from the future as stale (clock skew cannot pin data forever)', async () => {
    const c = cache();
    clock = T0 + DAY;
    await c.put(PLACE, 'full');
    clock = T0;
    expect((await c.lookupPlace(PLACE.id, 'full'))?.fresh).toBe(false);
  });
});

describe('lookups', () => {
  it('misses on an unknown query or id', async () => {
    const c = cache();
    expect(await c.lookupQuery('nowhere', undefined, 'basic')).toBeUndefined();
    expect(await c.lookupPlace('nope', 'basic')).toBeUndefined();
  });

  it('indexes by query and by place id, and a later put refreshes both', async () => {
    const c = cache();
    await c.put(PLACE, 'basic', { name: 'Armature Works', address: '1910 N Ola Ave' });
    expect((await c.lookupPlace(PLACE.id, 'basic'))?.place?.displayName?.text).toBe('Armature Works');
    await c.put({ ...PLACE, displayName: { text: 'Armature Works (renamed)' } }, 'full');
    expect((await c.lookupQuery('Armature Works', '1910 N Ola Ave', 'full'))?.place?.displayName?.text).toBe('Armature Works (renamed)');
  });

  it('returns copies, so a caller mutating a result cannot poison the cache', async () => {
    const c = cache();
    await c.put(PLACE, 'full');
    const first = await c.lookupPlace(PLACE.id, 'full');
    first!.place!.displayName!.text = 'mutated';
    expect((await c.lookupPlace(PLACE.id, 'full'))?.place?.displayName?.text).toBe('Armature Works');
  });

  it('a query pointing at a place with no stored entry is a bare id hit', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, places: {}, queries: { 'x|': 'ChIJ_orphan' } }));
    expect(await cache().lookupQuery('x', undefined, 'basic')).toEqual({ placeId: 'ChIJ_orphan', fresh: false });
  });
});

describe('persistence', () => {
  it('round-trips through disk with a private file mode and no temp files left behind', async () => {
    const c = cache();
    await c.put(PLACE, 'full', { name: 'Armature Works' });
    expect(await c.save()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'state')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(dir, 'state'))).toEqual(['places-cache.json']);
    clock = T0 + HOUR;
    expect(await cache().lookupQuery('armature works', undefined, 'full')).toEqual({ placeId: PLACE.id, fresh: true, place: PLACE });
  });

  it('does not write when nothing changed', async () => {
    const c = cache();
    expect(await c.save()).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('prunes expired content when loading, before anything can read it', async () => {
    const c = cache();
    await c.put(PLACE, 'full');
    await c.save();
    clock = T0 + DAY + 1;
    const reloaded = cache();
    await reloaded.put({ id: 'unrelated' }, 'basic');
    await reloaded.save();
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.places[PLACE.id].content).toBeUndefined();
    expect(stored.places[PLACE.id].location).toBeDefined();
  });

  const corrupt: Array<[string, string]> = [
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['a wrong version', JSON.stringify({ version: 2, places: {}, queries: {} })],
    ['a non-object places map', JSON.stringify({ version: 1, places: [], queries: {} })],
    ['a missing queries map', JSON.stringify({ version: 1, places: {} })],
  ];
  for (const [label, contents] of corrupt) {
    it(`starts empty, without throwing, on ${label}`, async () => {
      mkdirSync(join(dir, 'state'), { recursive: true });
      writeFileSync(path, contents);
      const log = vi.fn();
      const c = cache({ log });
      expect(await c.lookupPlace('x', 'basic')).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/places cache .*unreadable.*starting empty/));
      await c.put(PLACE, 'basic');
      expect(await c.save()).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
    });
  }

  it('drops malformed entries but keeps the good ones', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      places: {
        good: { content: { fields: 'full', fetchedAt: T0, data: { id: 'good' } }, location: { latitude: 1, longitude: 2, fetchedAt: T0 } },
        badContent: { content: { fields: 'weird', fetchedAt: T0, data: {} } },
        badLocation: { content: { fields: 'full', fetchedAt: T0, data: {} }, location: { latitude: 'x', longitude: 2, fetchedAt: T0 } },
        notObject: 7,
      },
      queries: { 'good|': 'good', 'bad|': 42 },
    }));
    const c = cache();
    expect(await c.lookupPlace('good', 'full')).toEqual({ placeId: 'good', fresh: true, place: { id: 'good', location: { latitude: 1, longitude: 2 } } });
    expect(await c.lookupPlace('badContent', 'basic')).toEqual({ placeId: 'badContent', fresh: false });
    expect(await c.lookupPlace('badLocation', 'basic')).toEqual({ placeId: 'badLocation', fresh: false });
    expect(await c.lookupPlace('notObject', 'basic')).toBeUndefined();
    expect(await c.lookupQuery('bad', undefined, 'basic')).toBeUndefined();
  });

  it('a missing file is simply empty and logs nothing', async () => {
    const log = vi.fn();
    expect(await cache({ log }).lookupPlace('x', 'basic')).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('an unreadable path logs and starts empty', async () => {
    mkdirSync(path, { recursive: true }); // a directory where the file should be
    const log = vi.fn();
    expect(await cache({ log }).lookupPlace('x', 'basic')).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/unreadable/));
  });

  it('a failed save returns false, logs, and leaves no temp file', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    chmodSync(join(dir, 'state'), 0o500);
    const log = vi.fn();
    const c = cache({ log });
    try {
      await c.put(PLACE, 'basic');
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
    await c.put(PLACE, 'basic');
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
      await c.put(PLACE, 'basic');
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^\[gogcli-mcp-maps\] places cache/));
      expect(await c.save()).toBe(true);
      expect(existsSync(join(dir, '.gogcli-mcp', 'places-cache.json'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      stderr.mockRestore();
    }
  });
});
