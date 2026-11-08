/**
 * Local Places cache, shaped by Google's Places policies:
 *  - place IDs may be stored indefinitely  → the query index and the id never expire;
 *  - lat/lng at most 30 consecutive days   → `location`, TTL 30 d (configurable lower only);
 *  - no other Places content beyond 24 h   → `content` (name, address, Maps link), TTL 24 h.
 * Expired data is pruned on load and on save, so it is never kept past its window.
 *
 * Content and location are kept and expire independently, because they come
 * from different gog calls: content from `gog maps places search|details`,
 * the point from `gog maps geocode`. A stored location of `null` means "the
 * geocoder found nothing" (known, so not asked again); an absent one means
 * "not looked up yet".
 *
 * The file lives in the wrapper's state dir (~/.gogcli-mcp), is written
 * atomically (temp + rename) with mode 0600, and a corrupt or unreadable file
 * (or the v1 format the direct-HTTPS client wrote) means "start empty" —
 * never an error.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GogPlace } from './places-gog.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const LOCATION_TTL_MS = 30 * DAY_MS;
export const CONTENT_TTL_MS = DAY_MS;

/** exact: the geocoder's point is this very place; approximate: it geocoded the address to something else. */
export type LocationMatch = 'exact' | 'approximate';

export interface PlaceLocation {
  lat: number;
  lng: number;
  match: LocationMatch;
}

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
  /** Present only when fresh (≤ 24 h). */
  content?: GogPlace;
  /** undefined: unknown or stale; null: the geocoder found nothing (fresh); else a fresh point. */
  location?: PlaceLocation | null;
}

interface StoredContent {
  fetchedAt: number;
  data: Omit<GogPlace, 'id'>;
}

interface StoredLocation {
  fetchedAt: number;
  point: PlaceLocation | null;
}

interface StoredPlace {
  content?: StoredContent;
  location?: StoredLocation;
}

interface CacheFile {
  version: 2;
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

function sanitizePoint(raw: unknown): PlaceLocation | null | undefined {
  if (raw === null) return null;
  if (
    isRecord(raw) &&
    typeof raw.lat === 'number' &&
    typeof raw.lng === 'number' &&
    (raw.match === 'exact' || raw.match === 'approximate')
  ) {
    return { lat: raw.lat, lng: raw.lng, match: raw.match };
  }
  return undefined;
}

function sanitizePlace(raw: unknown): StoredPlace | undefined {
  if (!isRecord(raw)) return undefined;
  const place: StoredPlace = {};
  const { content, location } = raw;
  if (isRecord(content) && typeof content.fetchedAt === 'number' && isRecord(content.data)) {
    const data: Omit<GogPlace, 'id'> = {};
    for (const key of ['name', 'formattedAddress', 'googleMapsUri'] as const) {
      if (typeof content.data[key] === 'string') data[key] = content.data[key];
    }
    place.content = { fetchedAt: content.fetchedAt, data };
  }
  if (isRecord(location) && typeof location.fetchedAt === 'number') {
    const point = sanitizePoint(location.point);
    if (point !== undefined) place.location = { fetchedAt: location.fetchedAt, point };
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
  if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.places) || !isRecord(parsed.queries)) return undefined;
  const file: CacheFile = { version: 2, places: {}, queries: {} };
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
  private file: CacheFile = { version: 2, places: {}, queries: {} };
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

  /** What is known for a name+address query; a bare `{placeId}` when only the id is. */
  async lookupQuery(name: string, address?: string): Promise<CacheLookup | undefined> {
    await this.load();
    const placeId = this.file.queries[cacheKey(name, address)];
    return placeId === undefined ? undefined : this.lookupLoaded(placeId);
  }

  /** What is known for a place id; undefined when nothing is. */
  async lookupPlace(placeId: string): Promise<CacheLookup | undefined> {
    await this.load();
    return this.file.places[placeId] ? this.lookupLoaded(placeId) : undefined;
  }

  /** Store a place's content; with `query`, index that name+address to it. */
  async putPlace(place: GogPlace, query?: { name: string; address?: string }): Promise<void> {
    await this.load();
    const { id, ...data } = place;
    const stored = (this.file.places[id] ??= {});
    stored.content = { fetchedAt: this.now(), data: { ...data } };
    if (query) this.file.queries[cacheKey(query.name, query.address)] = id;
    this.dirty = true;
  }

  /** Store a place's geocoded point, or null for "the geocoder found nothing". */
  async putLocation(placeId: string, point: PlaceLocation | null): Promise<void> {
    await this.load();
    const stored = (this.file.places[placeId] ??= {});
    stored.location = { fetchedAt: this.now(), point: point && { ...point } };
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

  private lookupLoaded(placeId: string): CacheLookup {
    const out: CacheLookup = { placeId };
    const stored = this.file.places[placeId];
    if (!stored) return out;
    const now = this.now();
    const { content, location } = stored;
    if (content && this.within(now, content.fetchedAt, CONTENT_TTL_MS)) {
      out.content = { id: placeId, ...content.data };
    }
    if (location && this.within(now, location.fetchedAt, this.locationTtlMs)) {
      out.location = location.point && { ...location.point };
    }
    return out;
  }

  private within(now: number, fetchedAt: number, ttl: number): boolean {
    const age = now - fetchedAt;
    return age >= 0 && age <= ttl;
  }

  private prune(): void {
    const now = this.now();
    for (const stored of Object.values(this.file.places)) {
      if (stored.content && !this.within(now, stored.content.fetchedAt, CONTENT_TTL_MS)) delete stored.content;
      if (stored.location && !this.within(now, stored.location.fetchedAt, this.locationTtlMs)) delete stored.location;
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
