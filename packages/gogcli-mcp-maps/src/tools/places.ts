/**
 * gog_places_search / gog_places_resolve / gog_places_details — Google Places
 * and Geocoding through gog (`gog maps places search|details`, `gog maps
 * geocode`), via the policy-bounded cache. This package makes no network call
 * of its own and handles no API key: gog uses the `places_api_key` in its own
 * config. Each result says which gog commands it ran (`gogCalls`; each one is
 * a billed Google request) and every item carries a status — see
 * places-service.ts for the rule.
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { errorResult, minifiedResult, pruneUndefined, redactSecrets } from '@chrischall/mcp-utils';
import type { Spawner } from '../../../gogcli-mcp/src/lib.js';
import { PlacesCache } from '../places-cache.js';
import {
  newCallCounter,
  resolveItems,
  type GogCalls,
  type ResolvedItem,
  type ResolveItem,
  type ResolveStatus,
} from '../places-service.js';

export interface PlacesToolDeps {
  spawner?: Spawner;
  /** The cache to use; defaults to one per process at ~/.gogcli-mcp/places-cache.json. */
  cache?: () => PlacesCache;
}

let processCache: PlacesCache | undefined;
export function defaultCache(): PlacesCache {
  return (processCache ??= new PlacesCache());
}

export const nearParam = z.string().trim().min(1).max(200).optional().describe(
  'Area hint appended to the search text, e.g. "Tampa, FL" (gog has no location bias, so this is plain text)',
);

export const refreshParam = z.boolean().optional().describe(
  'Ignore cached entries and look up again (each lookup is a billed Google request through gog)',
);

const STATUS_NOTE =
  'Each result has a status: ok (place found, pin exact or given), approximate (the pin is the geocoded address, '
  + 'not the place itself, or there is no pin), not_found, or error.';

/** The caller-facing shape of one resolved item. */
export function projectResolved(item: ResolvedItem, withInput = true): Record<string, unknown> {
  const { input } = item;
  return pruneUndefined({
    input: withInput
      ? pruneUndefined({
        name: input.name, address: input.address, near: input.near, place_id: input.placeId, lat: input.lat, lng: input.lng,
      })
      : undefined,
    status: item.status,
    placeId: item.place?.id,
    name: item.place?.name,
    formattedAddress: item.place?.formattedAddress,
    lat: item.location?.lat,
    lng: item.location?.lng,
    location: item.location?.match,
    googleMapsUri: item.place?.googleMapsUri,
    matchConfidence: item.matchConfidence,
    cached: item.cached,
    reason: item.reason,
  });
}

/** Warnings first, as their own text block, then the JSON. */
export function placesResult(data: Record<string, unknown>, warnings: string[]): CallToolResult {
  const result = minifiedResult(data);
  if (warnings.length === 0) return result;
  return { ...result, content: [{ type: 'text', text: warnings.join('\n') }, ...result.content] };
}

export function failure(err: unknown): CallToolResult {
  return errorResult(redactSecrets(err instanceof Error ? err.message : String(err)));
}

/** Both coordinates or neither; a TypeError-free message naming the item. */
export function checkCoordinates(items: Array<{ lat?: number; lng?: number }>, label = 'item'): void {
  items.forEach((item, i) => {
    if ((item.lat === undefined) !== (item.lng === undefined)) {
      throw new Error(`${label} ${i + 1}: give both lat and lng, or neither`);
    }
  });
}

export function statusCounts(items: ResolvedItem[]): Record<ResolveStatus, number> {
  const counts: Record<ResolveStatus, number> = { ok: 0, approximate: 0, not_found: 0, error: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function placesTools(deps: PlacesToolDeps = {}): (server: McpServer) => void {
  const cacheOf = deps.cache ?? defaultCache;

  /** Resolve through the cache, saving it afterwards (resolveItems never throws). */
  async function lookup(items: ResolveItem[], opts: { refresh?: boolean; checkNames?: boolean }) {
    const cache = cacheOf();
    const calls: GogCalls = newCallCounter();
    try {
      const resolved = await resolveItems(items, { cache, spawner: deps.spawner, calls, ...opts });
      return { resolved, calls };
    } finally {
      await cache.save();
    }
  }

  /** One item: an error status is a tool error; anything else is a result. */
  function single(resolved: ResolvedItem[], calls: GogCalls): CallToolResult {
    const item = resolved[0]!;
    if (item.status === 'error') return failure(item.reason);
    return placesResult({ result: projectResolved(item, false), gogCalls: calls }, item.warnings);
  }

  return (server: McpServer) => {
    server.registerTool('gog_places_search', {
      description:
        'Find ONE place on Google by free text (the single top match) and return its place id, name, '
        + 'address, Google Maps link and lat/lng. Runs `gog maps places search`, then `gog maps geocode` on the '
        + 'address for the coordinates (cached). ' + STATUS_NOTE,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500).describe('What to look for, e.g. "Armature Works" or "Cuban sandwich Ybor City"'),
        near: nearParam,
      }),
    }, async ({ query, near }) => {
      const { resolved, calls } = await lookup([pruneUndefined({ name: query, near }) as ResolveItem], { checkNames: false });
      return single(resolved, calls);
    });

    server.registerTool('gog_places_resolve', {
      description:
        'Resolve a list of named stops (1-50) to Google places: place id, address, Maps link and lat/lng, each from '
        + 'the top match for "name, address, near" (or `gog maps places details` for a known place_id), with the '
        + 'point from `gog maps geocode`. Flags a top match whose name does not match as ambiguous. Up to 4 lookups '
        + 'run at once; a cancelled call starts no more. Cached per Google policy (ids kept, coordinates 30 days, '
        + 'everything else 24 h), so re-resolving the same list is free; refresh: true bypasses the cache. '
        + STATUS_NOTE,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        items: z.array(z.object({
          name: z.string().trim().min(1).max(200).describe('Place name, e.g. "Armature Works"'),
          address: z.string().trim().min(1).max(300).optional().describe('Address or city to disambiguate, e.g. "Tampa, FL"'),
          near: nearParam,
          place_id: z.string().trim().min(1).max(512).optional().describe('A known Google place id (skips the search)'),
          lat: z.number().min(-90).max(90).optional().describe('Known latitude: used as the pin (with lng), no geocode'),
          lng: z.number().min(-180).max(180).optional().describe('Known longitude (with lat)'),
        })).min(1).max(50).describe('Stops to resolve (1-50)'),
        refresh: refreshParam,
      }),
    }, async ({ items, refresh }) => {
      try {
        checkCoordinates(items);
      } catch (err) {
        return failure(err);
      }
      const input = items.map((i): ResolveItem => pruneUndefined({
        name: i.name, address: i.address, near: i.near, placeId: i.place_id, lat: i.lat, lng: i.lng,
      }) as ResolveItem);
      const { resolved, calls } = await lookup(input, { refresh });
      const warnings = resolved.flatMap((r) => r.warnings);
      return placesResult({
        results: resolved.map((r) => projectResolved(r)),
        counts: statusCounts(resolved),
        warnings,
        gogCalls: calls,
      }, warnings);
    });

    server.registerTool('gog_places_details', {
      description:
        'Look up one Google place id: name, address, Google Maps link and lat/lng. Runs `gog maps places details` '
        + 'and `gog maps geocode`; free when cached (content 24 h, coordinates 30 days); refresh: true bypasses '
        + 'the cache. ' + STATUS_NOTE,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        placeId: z.string().trim().min(1).max(520).describe('Google place id (from search/resolve), with or without "places/"'),
        refresh: refreshParam,
      }),
    }, async ({ placeId, refresh }) => {
      const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId;
      const { resolved, calls } = await lookup([{ name: id, placeId: id }], { refresh, checkNames: false });
      return single(resolved, calls);
    });
  };
}
