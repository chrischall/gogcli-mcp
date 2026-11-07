/**
 * Local Places cache, shaped by Google's Places policies:
 *  - place IDs may be stored indefinitely  → the query index and the id never expire;
 *  - lat/lng at most 30 consecutive days   → `location`, TTL 30 d (configurable lower only);
 *  - no other Places content beyond 24 h   → `content` (name, address, hours, status,
 *    website, phone, Maps link, price, accessibility), TTL 24 h.
 * Expired data is pruned on load and on save, so it is never kept past its window.
 *
 * A hit with a known id but stale content costs one Place Details call (never a
 * Text Search); a fully fresh hit costs nothing. The file lives in the wrapper's
 * state dir (~/.gogcli-mcp), is written atomically (temp + rename) with mode
 * 0600, and a corrupt or unreadable file means "start empty" — never an error.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PlacesFieldSet } from './budget.js';
import type { LatLng, PlacesPlace } from './places-client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const LOCATION_TTL_MS = 30 * DAY_MS;
export const CONTENT_TTL_MS = DAY_MS;

/** Lowercase, drop apostrophes, turn other punctuation into spaces, collapse whitespace. */
export function normalizeForKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cacheKey(name: string, address?: string): string {
  return `${normalizeForKey(name)}|${normalizeForKey(address ?? '')}`;
}

export function defaultCachePath(home: string = homedir()): string {
  return join(home, '.gogcli-mcp', 'places-cache.json');
}

export interface CacheLookup {
  placeId: string;
  /** True when `place` can be used as-is: zero billable calls. */
  fresh: boolean;
  /** Present only when fresh. */
  place?: PlacesPlace;
}

interface StoredContent {
  fields: PlacesFieldSet;
  fetchedAt: number;
  data: Omit<PlacesPlace, 'id' | 'location'>;
}

interface StoredLocation extends LatLng {
  fetchedAt: number;
}

interface StoredPlace {
  content?: StoredContent;
  location?: StoredLocation;
}

interface CacheFile {
  version: 1;
  places: Record<string, StoredPlace>;
  queries: Record<string, string>;
}

export interface PlacesCacheOptions {
  path?: string;
  now?: () => number;
  /** Lower than 30 days if you like; never higher. */
  locationTtlMs?: number;
  log?: (line: string) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizePlace(raw: unknown): StoredPlace | undefined {
  if (!isRecord(raw)) return undefined;
  const place: StoredPlace = {};
  const { content, location } = raw;
  if (
    isRecord(content) &&
    (content.fields === 'basic' || content.fields === 'full') &&
    typeof content.fetchedAt === 'number' &&
    isRecord(content.data)
  ) {
    place.content = content as unknown as StoredContent;
  }
  if (location !== undefined) {
    if (
      isRecord(location) &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number' &&
      typeof location.fetchedAt === 'number'
    ) {
      place.location = location as unknown as StoredLocation;
    } else {
      // Content without the coordinates it came with would read as "this
      // place has no location"; drop it so the next lookup refetches both.
      delete place.content;
    }
  }
  return place;
}

function parseCacheFile(text: string): CacheFile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.places) || !isRecord(parsed.queries)) return undefined;
  const file: CacheFile = { version: 1, places: {}, queries: {} };
  for (const [id, raw] of Object.entries(parsed.places)) {
    const place = sanitizePlace(raw);
    if (place) file.places[id] = place;
  }
  for (const [key, id] of Object.entries(parsed.queries)) {
    if (typeof id === 'string') file.queries[key] = id;
  }
  return file;
}

export class PlacesCache {
  private readonly path: string;
  private readonly now: () => number;
  private readonly locationTtlMs: number;
  private readonly log: (line: string) => void;
  private file: CacheFile = { version: 1, places: {}, queries: {} };
  private loaded: Promise<void> | undefined;
  private dirty = false;

  constructor(opts: PlacesCacheOptions = {}) {
    const ttl = opts.locationTtlMs ?? LOCATION_TTL_MS;
    if (!(ttl > 0 && ttl <= LOCATION_TTL_MS)) {
      throw new RangeError('locationTtlMs must be more than 0 and at most 30 days (Google Places policy)');
    }
    this.locationTtlMs = ttl;
    this.path = opts.path ?? defaultCachePath();
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((line) => process.stderr.write(`[gogcli-mcp-maps] ${line}\n`));
  }

  async lookupQuery(name: string, address: string | undefined, fields: PlacesFieldSet): Promise<CacheLookup | undefined> {
    await this.load();
    const placeId = this.file.queries[cacheKey(name, address)];
    return placeId === undefined ? undefined : this.lookupLoaded(placeId, fields, true);
  }

  async lookupPlace(placeId: string, fields: PlacesFieldSet): Promise<CacheLookup | undefined> {
    await this.load();
    return this.lookupLoaded(placeId, fields, false);
  }

  /** Store a place fetched with `fields`; with `query`, index that name+address to it. */
  async put(place: PlacesPlace, fields: PlacesFieldSet, query?: { name: string; address?: string }): Promise<void> {
    await this.load();
    const fetchedAt = this.now();
    const { id, location, ...data } = place;
    const stored: StoredPlace = { content: { fields, fetchedAt, data: structuredClone(data) } };
    if (location) stored.location = { latitude: location.latitude, longitude: location.longitude, fetchedAt };
    this.file.places[id] = stored;
    if (query) this.file.queries[cacheKey(query.name, query.address)] = id;
    this.dirty = true;
  }

  /** Persist if anything changed. Best-effort: a failure is logged and returns false. */
  async save(): Promise<boolean> {
    await this.load();
    if (!this.dirty) return true;
    this.prune();
    const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(tmp, JSON.stringify(this.file), { mode: 0o600 });
      await rename(tmp, this.path);
      this.dirty = false;
      return true;
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      this.log(`could not save places cache: ${(err as Error).message}`);
      return false;
    }
  }

  private lookupLoaded(placeId: string, fields: PlacesFieldSet, fromQuery: boolean): CacheLookup | undefined {
    const stored = this.file.places[placeId];
    if (!stored) return fromQuery ? { placeId, fresh: false } : undefined;
    const now = this.now();
    const { content, location } = stored;
    const contentFresh =
      content !== undefined && this.within(now, content.fetchedAt, CONTENT_TTL_MS) && (fields === 'basic' || content.fields === 'full');
    // No stored location means the place genuinely had none: prune() and
    // sanitizePlace() drop the content whenever they drop its coordinates.
    const locationOk = location === undefined || this.within(now, location.fetchedAt, this.locationTtlMs);
    if (!contentFresh || !locationOk) return { placeId, fresh: false };
    const place: PlacesPlace = { id: placeId, ...structuredClone(content.data) };
    if (location) place.location = { latitude: location.latitude, longitude: location.longitude };
    return { placeId, fresh: true, place };
  }

  private within(now: number, fetchedAt: number, ttl: number): boolean {
    const age = now - fetchedAt;
    return age >= 0 && age <= ttl;
  }

  private prune(): void {
    const now = this.now();
    for (const stored of Object.values(this.file.places)) {
      if (stored.content && !this.within(now, stored.content.fetchedAt, CONTENT_TTL_MS)) delete stored.content;
      if (stored.location && !this.within(now, stored.location.fetchedAt, this.locationTtlMs)) {
        delete stored.location;
        delete stored.content;
      }
    }
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      let text: string;
      try {
        text = await readFile(this.path, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.log(`places cache at ${this.path} is unreadable (${(err as Error).message}); starting empty`);
        }
        return;
      }
      const file = parseCacheFile(text);
      if (!file) {
        this.log(`places cache at ${this.path} is unreadable (corrupt or unknown format); starting empty`);
        return;
      }
      this.file = file;
      this.prune();
    })();
    return this.loaded;
  }
}
