/**
 * Google Places and Geocoding THROUGH gog (runner.ts) — this package opens no
 * network connection of its own and never sees an API key: gog reads
 * `places_api_key` from its own config and makes the request.
 *
 * gog 0.48+ offers exactly three read commands, and this module wraps them
 * as they are (JSON mode is the runner's global `--json`):
 *  - `gog maps places search <query>`  → `{"place":{id,name,formatted_address,google_maps_uri}}`,
 *    the TOP match only (no coordinates, no location bias, no result count);
 *    no match is a gog failure whose message says "no places matched".
 *  - `gog maps places details <id>`    → the same `{"place":{…}}` shape.
 *  - `gog maps geocode <address>`      → `{"geocode":{status,results:[{place_id,geometry:{location:{lat,lng}}}]}}`;
 *    ZERO_RESULTS is a success with no results.
 */
import { pos, run, type Spawner } from '../../gogcli-mcp/src/lib.js';

/** A place as gog returns it, camel-cased. */
export interface GogPlace {
  id: string;
  name?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
}

export interface GeocodeHit {
  lat: number;
  lng: number;
  /** The geocoder's own place id for the point it found. */
  placeId?: string;
}

export interface GogMapsOps {
  spawner?: Spawner;
}

interface GogPlaceJson {
  id?: string;
  name?: string;
  formatted_address?: string;
  google_maps_uri?: string;
}

const NO_MATCH = /no places matched/i;

function placeOf(raw: GogPlaceJson | null | undefined, fallbackId?: string): GogPlace | undefined {
  if (!raw) return undefined;
  const id = raw.id || fallbackId;
  if (!id) return undefined;
  const place: GogPlace = { id };
  if (raw.name) place.name = raw.name;
  if (raw.formatted_address) place.formattedAddress = raw.formatted_address;
  if (raw.google_maps_uri) place.googleMapsUri = raw.google_maps_uri;
  return place;
}

async function gog<T>(args: Parameters<typeof run>[0], ops: GogMapsOps): Promise<T> {
  return JSON.parse(await run(args, { spawner: ops.spawner })) as T;
}

/** The top Places Text Search match for `query`, or undefined when there is none. */
export async function searchPlace(query: string, ops: GogMapsOps = {}): Promise<GogPlace | undefined> {
  try {
    const out = await gog<{ place?: GogPlaceJson | null }>(['maps', 'places', 'search', pos(query)], ops);
    return placeOf(out.place);
  } catch (err) {
    if (NO_MATCH.test((err as Error).message)) return undefined;
    throw err;
  }
}

/** Place Details for one id ("places/" prefix accepted). Throws when gog fails. */
export async function placeDetails(placeId: string, ops: GogMapsOps = {}): Promise<GogPlace> {
  const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId;
  const out = await gog<{ place?: GogPlaceJson | null }>(['maps', 'places', 'details', pos(id)], ops);
  const place = placeOf(out.place, id);
  if (!place) throw new Error(`gog maps places details returned no place for ${id}`);
  return place;
}

/** The first geocoding result for an address, or undefined when there is none. */
export async function geocodeAddress(address: string, ops: GogMapsOps = {}): Promise<GeocodeHit | undefined> {
  const out = await gog<{
    geocode?: { results?: Array<{ place_id?: string; geometry?: { location?: { lat?: unknown; lng?: unknown } } }> };
  }>(['maps', 'geocode', pos(address)], ops);
  const first = out.geocode?.results?.[0];
  const loc = first?.geometry?.location;
  if (typeof loc?.lat !== 'number' || typeof loc.lng !== 'number') return undefined;
  const hit: GeocodeHit = { lat: loc.lat, lng: loc.lng };
  if (first!.place_id) hit.placeId = first!.place_id;
  return hit;
}
