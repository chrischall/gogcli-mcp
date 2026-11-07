/**
 * Place lookups on top of the client, the cache and the budget — shared by the
 * gog_places_* tools and the trip builder.
 *
 * Order for one item: fresh cache hit (free) → known id with stale content
 * (one Place Details call, never a Text Search) → Text Search (top result).
 * Once the budget is spent, or the API refuses in a way every later request
 * would repeat (bad key, quota), no further request is sent: each remaining
 * item that the cache cannot answer for free comes back unresolved with the
 * reason, so the caller still gets everything that was resolved.
 */
import { BudgetExceededError, type PlacesFieldSet } from './budget.js';
import { normalizeForKey, type PlacesCache } from './places-cache.js';
import { PlacesApiError, type PlacesClient, type PlacesPlace } from './places-client.js';

export interface Near {
  lat: number;
  lng: number;
  radius_m?: number;
}

export interface ResolveItem {
  name: string;
  address?: string;
  near?: Near;
  /** A known place id skips the search: Details by id (or the cache). */
  placeId?: string;
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface ResolvedItem {
  input: ResolveItem;
  place?: PlacesPlace;
  cached: boolean;
  matchConfidence?: MatchConfidence;
  warnings: string[];
  /** Set when unresolved. */
  reason?: string;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'cafe', 'restaurant', 'bar']);

function tokens(text: string): Set<string> {
  return new Set(normalizeForKey(text).split(' ').filter((t) => t && !STOPWORDS.has(t)));
}

/** How well the returned name matches the asked-for one. */
export function matchConfidence(input: string, found: string | undefined): MatchConfidence {
  if (!found) return 'low';
  const a = normalizeForKey(input);
  const b = normalizeForKey(found);
  if (a === b || (a && b.includes(a)) || (b && a.includes(b))) return 'high';
  const ta = tokens(input);
  const tb = tokens(found);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && shared / union >= 0.5 ? 'medium' : 'low';
}

export function placeName(place: PlacesPlace): string {
  return place.displayName?.text ?? place.formattedAddress ?? place.id;
}

/** The loud warnings a place carries on its own (closed businesses). */
export function statusWarnings(place: PlacesPlace): string[] {
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return [`⚠️ CLOSED PERMANENTLY: ${placeName(place)}`];
  if (place.businessStatus === 'CLOSED_TEMPORARILY') return [`⚠️ CLOSED TEMPORARILY: ${placeName(place)}`];
  return [];
}

/**
 * The cache key's address half. With no address, a `near` point stands in so
 * "Starbucks" near Tampa and "Starbucks" near Orlando are not one entry.
 */
function keyAddress(item: ResolveItem): string | undefined {
  if (item.address) return item.address;
  if (item.near) return `@${item.near.lat.toFixed(2)},${item.near.lng.toFixed(2)}`;
  return undefined;
}

/** A failure every later request would repeat: stop sending. */
function isFatal(err: unknown): boolean {
  if (err instanceof BudgetExceededError) return true;
  if (err instanceof PlacesApiError) return err.status === 403 || err.status === 429;
  return true;
}

function reasonOf(err: unknown): string {
  if (err instanceof BudgetExceededError) return err.reason;
  return err instanceof Error ? err.message : String(err);
}

export interface ServiceContext {
  client: PlacesClient;
  cache: PlacesCache;
  fields: PlacesFieldSet;
  /** Ignore the cache for reads (still writes what it fetches). */
  refresh?: boolean;
}

/** One place by id: cache when fresh, else one Details call. */
export async function detailsById(placeId: string, ctx: ServiceContext): Promise<{ place: PlacesPlace; cached: boolean }> {
  if (!ctx.refresh) {
    const hit = await ctx.cache.lookupPlace(placeId, ctx.fields);
    if (hit?.fresh) return { place: hit.place!, cached: true };
  }
  const place = await ctx.client.details(placeId, ctx.fields);
  await ctx.cache.put(place, ctx.fields);
  return { place, cached: false };
}

export async function resolveItems(items: ResolveItem[], ctx: ServiceContext): Promise<ResolvedItem[]> {
  const out: ResolvedItem[] = [];
  let stopped: string | undefined;

  for (const input of items) {
    const query = { name: input.name, address: keyAddress(input) };
    const unresolved = (reason: string): ResolvedItem => ({
      input,
      cached: false,
      warnings: [`Unresolved: ${input.name} (${reason})`],
      reason,
    });
    const done = (place: PlacesPlace, cached: boolean): ResolvedItem => {
      const confidence = input.placeId ? 'high' : matchConfidence(input.name, place.displayName?.text);
      const warnings = statusWarnings(place);
      if (confidence === 'low') {
        warnings.push(`Ambiguous: asked for "${input.name}", the top match is "${placeName(place)}"`);
      }
      return { input, place, cached, matchConfidence: confidence, warnings };
    };

    try {
      // 1. Free answers first: a fresh cache entry, by id or by name+address.
      let knownId = input.placeId;
      if (!ctx.refresh) {
        const hit = knownId
          ? await ctx.cache.lookupPlace(knownId, ctx.fields)
          : await ctx.cache.lookupQuery(query.name, query.address, ctx.fields);
        if (hit?.fresh) {
          out.push(done(hit.place!, true));
          continue;
        }
        knownId ??= hit?.placeId;
      }
      if (stopped) {
        out.push(unresolved(stopped));
        continue;
      }
      // 2. A known id: one Details call. 3. Otherwise: Text Search, top hit.
      if (knownId) {
        const place = await ctx.client.details(knownId, ctx.fields);
        await ctx.cache.put(place, ctx.fields, input.placeId ? undefined : query);
        out.push(done(place, false));
        continue;
      }
      const text = input.address ? `${input.name}, ${input.address}` : input.name;
      const near = input.near ? { lat: input.near.lat, lng: input.near.lng, radiusM: input.near.radius_m } : undefined;
      const [top] = await ctx.client.searchText({ query: text, near, maxResults: 1 }, ctx.fields);
      if (!top) {
        out.push(unresolved('no match found'));
        continue;
      }
      await ctx.cache.put(top, ctx.fields, query);
      out.push(done(top, false));
    } catch (err) {
      const reason = reasonOf(err);
      if (isFatal(err)) stopped = reason;
      out.push(unresolved(reason));
    }
  }
  return out;
}
