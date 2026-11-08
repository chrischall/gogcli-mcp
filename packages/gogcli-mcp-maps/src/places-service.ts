/**
 * Place lookups through gog (places-gog.ts) and the cache — shared by the
 * gog_places_* tools and the trip builder.
 *
 * One item, cheapest first:
 *  1. the cache (free): fresh content and/or a fresh point, by id or by name+address;
 *  2. content: a known id → `gog maps places details`; otherwise
 *     `gog maps places search "<name>, <address>, <near>"` (top match only);
 *  3. a point: the caller's lat/lng when given (no geocode), else
 *     `gog maps geocode "<formatted address>"`, first result.
 *
 * Status rule (documented in the README):
 *  - ok          — a place was found and its point is exact (the geocoder returned
 *                  that same place id) or was given by the caller;
 *  - approximate — a place was found, but the point is the geocoded address of
 *                  something else (a street address, a building), or the geocoder
 *                  found no point at all (then there is no lat/lng);
 *  - not_found   — the search matched nothing (caller coordinates, if any, are kept);
 *  - error       — gog failed, or the call was cancelled before this item ran.
 *
 * At most `concurrency` (≤ 4) items run at once. Once the call's signal aborts,
 * no further gog command is started: every item still waiting comes back as an
 * error with reason "cancelled" (a cache hit still answers, for free).
 */
import { currentCallSignal } from '@chrischall/mcp-utils';
import type { Spawner } from '../../gogcli-mcp/src/lib.js';
import { cacheKey, normalizeForKey, type PlaceLocation, type PlacesCache } from './places-cache.js';
import { geocodeAddress, placeDetails, searchPlace, type GogPlace } from './places-gog.js';

export interface ResolveItem {
  name: string;
  address?: string;
  /** Free-text area hint ("Tampa, FL"), appended to the search text. */
  near?: string;
  /** A known place id skips the search: details by id (or the cache). */
  placeId?: string;
  /** Caller-known coordinates: used as the pin, no geocode. */
  lat?: number;
  lng?: number;
}

export type ResolveStatus = 'ok' | 'approximate' | 'not_found' | 'error';
export type MatchConfidence = 'high' | 'medium' | 'low';

export interface ResolvedLocation {
  lat: number;
  lng: number;
  /** exact/approximate from the geocoder; given when the caller supplied it. */
  match: PlaceLocation['match'] | 'given';
}

export interface ResolvedItem {
  input: ResolveItem;
  status: ResolveStatus;
  place?: GogPlace;
  location?: ResolvedLocation;
  /** True when this item cost no gog call at all. */
  cached: boolean;
  matchConfidence?: MatchConfidence;
  warnings: string[];
  /** Why the item has no place or no point. */
  reason?: string;
}

/** gog commands this call ran, by kind (each one is a billed Google request). */
export interface GogCalls {
  search: number;
  details: number;
  geocode: number;
}

export function newCallCounter(): GogCalls {
  return { search: 0, details: 0, geocode: 0 };
}

export interface ServiceContext {
  cache: PlacesCache;
  spawner?: Spawner;
  /** Ignore the cache for reads (still writes what it fetches). */
  refresh?: boolean;
  /** Defaults to the tool call's own cancellation signal. */
  signal?: AbortSignal;
  /** 1..4, default 4. */
  concurrency?: number;
  /** Compare the asked-for name with the match (default true; off for free-text searches). */
  checkNames?: boolean;
  calls?: GogCalls;
}

export const MAX_CONCURRENCY = 4;

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'cafe', 'restaurant', 'bar']);

function words(text: string): string[] {
  return normalizeForKey(text).split(' ').filter(Boolean);
}

/** True when every word of `inner` appears, in order and adjacent, as whole words in `outer`. */
function containsWords(outer: string[], inner: string[]): boolean {
  if (inner.length === 0) return false;
  for (let i = 0; i + inner.length <= outer.length; i += 1) {
    if (inner.every((w, j) => outer[i + j] === w)) return true;
  }
  return false;
}

/** How well the returned name matches the asked-for one — whole words only. */
export function matchConfidence(input: string, found: string | undefined): MatchConfidence {
  if (!found) return 'low';
  const a = words(input);
  const b = words(found);
  if (containsWords(a, b) || containsWords(b, a)) return 'high';
  const ta = new Set(a.filter((t) => !STOPWORDS.has(t)));
  const tb = new Set(b.filter((t) => !STOPWORDS.has(t)));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && shared / union >= 0.5 ? 'medium' : 'low';
}

export function placeName(place: GogPlace): string {
  return place.name ?? place.formattedAddress ?? place.id;
}

/** The search text: name, then address, then the near hint. */
export function queryText(item: ResolveItem): string {
  return [item.name, item.address, item.near].filter(Boolean).join(', ');
}

/** The cache key's address half: address and near together. */
function keyAddress(item: ResolveItem): string | undefined {
  return [item.address, item.near].filter(Boolean).join(', ') || undefined;
}

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

async function resolveOne(input: ResolveItem, ctx: ServiceContext, signal: AbortSignal | undefined): Promise<ResolvedItem> {
  const calls = ctx.calls ?? newCallCounter();
  const ops = { spawner: ctx.spawner };
  const query = { name: input.name, address: keyAddress(input) };
  const given = typeof input.lat === 'number' && typeof input.lng === 'number'
    ? { lat: input.lat, lng: input.lng, match: 'given' as const }
    : undefined;
  let cached = true;
  const spend = (kind: keyof GogCalls): void => {
    if (signal?.aborted) throw new Cancelled();
    calls[kind] += 1;
    cached = false;
  };

  let place: GogPlace | undefined;
  try {
    let point: PlaceLocation | null | undefined;
    let knownId = input.placeId;
    if (!ctx.refresh) {
      const hit = knownId ? await ctx.cache.lookupPlace(knownId) : await ctx.cache.lookupQuery(query.name, query.address);
      place = hit?.content;
      point = hit?.location;
      knownId ??= hit?.placeId;
    }

    if (!place) {
      if (knownId) {
        spend('details');
        place = await placeDetails(knownId, ops);
        await ctx.cache.putPlace(place, input.placeId ? undefined : query);
      } else {
        spend('search');
        place = await searchPlace(queryText(input), ops);
        if (!place) {
          const result: ResolvedItem = {
            input, status: 'not_found', cached, reason: 'no match found', warnings: [`Not found: ${input.name}`],
          };
          if (given) {
            result.location = given;
            result.warnings = [`Not found on Google: ${input.name} (using the given coordinates)`];
          }
          return result;
        }
        await ctx.cache.putPlace(place, query);
      }
    }

    const warnings: string[] = [];
    let confidence: MatchConfidence | undefined;
    if (ctx.checkNames !== false) confidence = input.placeId ? 'high' : matchConfidence(input.name, place.name);
    if (confidence === 'low') {
      warnings.push(`Ambiguous: asked for "${input.name}", the top match is "${placeName(place)}"`);
    }
    const found = (status: ResolveStatus, extra: Partial<ResolvedItem> = {}): ResolvedItem => ({
      input, status, place, cached, ...(confidence ? { matchConfidence: confidence } : {}), warnings, ...extra,
    });

    if (given) return found('ok', { location: given });

    if (point === undefined) {
      spend('geocode');
      const hit = await geocodeAddress(place.formattedAddress ?? queryText(input), ops);
      point = hit ? { lat: hit.lat, lng: hit.lng, match: hit.placeId === place.id ? 'exact' : 'approximate' } : null;
      await ctx.cache.putLocation(place.id, point);
    }
    if (point === null) {
      warnings.push(`No coordinates: ${input.name} (the geocoder found nothing for its address)`);
      return found('approximate', { reason: 'no coordinates for this place' });
    }
    if (point.match === 'approximate') {
      warnings.push(`Approximate: ${input.name} — the pin is its geocoded address, not the place itself`);
    }
    return found(point.match === 'exact' ? 'ok' : 'approximate', { location: point });
  } catch (err) {
    const reason = (err as Error).message;
    const result: ResolvedItem = { input, status: 'error', cached, reason, warnings: [`Error: ${input.name} (${reason})`] };
    if (place) result.place = place;
    return result;
  }
}

/** Two items with the same key are the same lookup. */
function itemKey(item: ResolveItem): string {
  return JSON.stringify([item.placeId ?? null, cacheKey(item.name, keyAddress(item)), item.lat ?? null, item.lng ?? null]);
}

export async function resolveItems(items: ResolveItem[], ctx: ServiceContext): Promise<ResolvedItem[]> {
  const signal = ctx.signal ?? currentCallSignal();
  const limit = Math.max(1, Math.min(MAX_CONCURRENCY, ctx.concurrency ?? MAX_CONCURRENCY));
  const out: ResolvedItem[] = new Array(items.length);
  const first = new Map<string, number>();
  const repeats: number[] = [];
  const unique: number[] = [];
  items.forEach((item, i) => {
    const key = itemKey(item);
    if (first.has(key)) repeats.push(i);
    else {
      first.set(key, i);
      unique.push(i);
    }
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < unique.length) {
      const i = unique[next++]!;
      out[i] = await resolveOne(items[i]!, ctx, signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, unique.length) }, worker));
  for (const i of repeats) {
    out[i] = { ...out[first.get(itemKey(items[i]!))!]!, input: items[i]!, cached: true };
  }
  return out;
}
