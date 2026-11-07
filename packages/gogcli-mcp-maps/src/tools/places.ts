/**
 * gog_places_search / gog_places_resolve / gog_places_details — Google Places
 * (New) over HTTPS with the user's API key, through the policy-bounded cache.
 *
 * Every call gets its own ApiBudget (`api_budget`, default 50): cache hits are
 * free, and once the budget is spent nothing else is sent. Every result
 * reports `apiCalls` (counts, SKU, a USD estimate before free allowances).
 * A closed business is shouted first, before the JSON.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  errorResult,
  minifiedResult,
  pruneUndefined,
  redactSecrets,
  resolveView,
  viewParam,
  type EnvSource,
  type View,
} from '@chrischall/mcp-utils';
import type { Spawner } from '../../../gogcli-mcp/src/lib.js';
import { API_BUDGET_DEFAULT, API_BUDGET_MAX, ApiBudget, type PlacesFieldSet } from '../budget.js';
import { evaluateOpenAt, parseLocalDateTime } from '../open-at.js';
import { PlacesCache } from '../places-cache.js';
import { PlacesClient, type FetchLike, type PlacesPlace } from '../places-client.js';
import { detailsById, resolveItems, statusWarnings, type ResolvedItem } from '../places-service.js';

export interface PlacesToolDeps {
  fetch?: FetchLike;
  env?: EnvSource;
  spawner?: Spawner;
  readGogConfig?: () => Promise<string | undefined>;
  /** The cache to use; defaults to one per process at ~/.gogcli-mcp/places-cache.json. */
  cache?: () => PlacesCache;
}

let processCache: PlacesCache | undefined;
export function defaultCache(): PlacesCache {
  return (processCache ??= new PlacesCache());
}

export const VIEWS = ['compact', 'full'] as const;

export const nearSchema = z.object({
  lat: z.number().min(-90).max(90).describe('Latitude of the bias centre'),
  lng: z.number().min(-180).max(180).describe('Longitude of the bias centre'),
  radius_m: z.number().positive().max(50_000).optional().describe('Bias radius in metres (default and max 50000)'),
});

export const fieldsParam = (dflt: PlacesFieldSet) =>
  z.enum(['basic', 'full']).optional().describe(
    'Which Places fields to request (sets the billed SKU). basic (Pro): id, name, address, location, Maps link, '
      + 'business status, UTC offset. full (Enterprise): basic + website, phones, opening hours, price level, '
      + `accessibility. Default: ${dflt}.`,
  );

export const apiBudgetParam = z.number().int().min(0).max(API_BUDGET_MAX).optional().describe(
  `Max billable Places requests this call may make (default ${API_BUDGET_DEFAULT}, max ${API_BUDGET_MAX}). `
    + 'Cache hits are free. When it runs out, remaining items come back unresolved with reason "api_budget reached".',
);

export const viewOpt = viewParam([...VIEWS], {
  note: 'compact (the default) gives name, address, lat/lng, Maps link, status, website, phone, weekday hours text, '
    + 'price level and the accessibility features present. full adds hours periods, current (special-day) hours, '
    + 'international phone, UTC offset and the raw accessibility flags.',
});

/** The caller-facing shape of a place in the requested view. */
export function projectPlace(place: PlacesPlace, view: View): Record<string, unknown> {
  const base = {
    placeId: place.id,
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    googleMapsUri: place.googleMapsUri,
    businessStatus: place.businessStatus,
    websiteUri: place.websiteUri,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber,
    priceLevel: place.priceLevel,
  };
  if (view === 'full') {
    return pruneUndefined({
      ...base,
      internationalPhoneNumber: place.internationalPhoneNumber,
      utcOffsetMinutes: place.utcOffsetMinutes,
      regularOpeningHours: place.regularOpeningHours,
      currentOpeningHours: place.currentOpeningHours,
      accessibilityOptions: place.accessibilityOptions,
    });
  }
  const accessibility = place.accessibilityOptions
    ? Object.entries(place.accessibilityOptions).filter(([, v]) => v).map(([k]) => k)
    : undefined;
  return pruneUndefined({
    ...base,
    regularOpeningHours: place.regularOpeningHours?.weekdayDescriptions,
    accessibility: accessibility?.length ? accessibility : undefined,
  });
}

/** Loud warnings (closed businesses) first, as their own text block, then the JSON. */
export function placesResult(data: Record<string, unknown>, warnings: string[]): CallToolResult {
  const result = minifiedResult(data);
  if (warnings.length === 0) return result;
  const loud = warnings.filter((w) => w.startsWith('⚠️'));
  const rest = warnings.filter((w) => !w.startsWith('⚠️'));
  return { ...result, content: [{ type: 'text', text: [...loud, ...rest].join('\n') }, ...result.content] };
}

export function failure(err: unknown): CallToolResult {
  return errorResult(redactSecrets(err instanceof Error ? err.message : String(err)));
}

export function projectResolved(item: ResolvedItem, view: View): Record<string, unknown> {
  const input = pruneUndefined({ name: item.input.name, address: item.input.address, near: item.input.near });
  if (!item.place) {
    return { input, resolved: false, reason: item.reason, warnings: item.warnings, cached: false };
  }
  return {
    input,
    ...projectPlace(item.place, view),
    warnings: item.warnings,
    cached: item.cached,
    matchConfidence: item.matchConfidence,
  };
}

export function placesTools(deps: PlacesToolDeps = {}): (server: McpServer) => void {
  const cacheOf = deps.cache ?? defaultCache;
  const clientFor = (budget: ApiBudget) =>
    new PlacesClient({ fetch: deps.fetch, env: deps.env, spawner: deps.spawner, readGogConfig: deps.readGogConfig, budget });

  return (server: McpServer) => {
    server.registerTool('gog_places_search', {
      description:
        'Search Google Places (New) by free text, optionally biased to a circle (near). Returns up to `max` places '
        + 'with name, address, lat/lng and a Google Maps link. Calls Places directly with your API key '
        + '(GOG_PLACES_API_KEY or `gog config set places_api_key`); one billable request per call.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        query: z.string().trim().min(1).describe('What to search for, e.g. "Cuban sandwich Ybor City"'),
        near: nearSchema.optional().describe('Bias (not restrict) results to this circle'),
        max: z.number().int().min(1).max(20).optional().describe('Max results, 1-20 (default 10)'),
        fields: fieldsParam('basic'),
        view: viewOpt,
        api_budget: apiBudgetParam,
      }),
    }, async ({ query, near, max, fields = 'basic', view, api_budget }) => {
      const cache = cacheOf();
      const budget = new ApiBudget(api_budget ?? API_BUDGET_DEFAULT);
      try {
        const places = await clientFor(budget).searchText(
          { query, near: near && { lat: near.lat, lng: near.lng, radiusM: near.radius_m }, maxResults: max },
          fields,
        );
        for (const place of places) await cache.put(place, fields);
        const rung = resolveView(view, [...VIEWS]);
        const warnings = places.flatMap(statusWarnings);
        return placesResult({
          places: places.map((p) => ({ ...projectPlace(p, rung), warnings: statusWarnings(p) })),
          warnings,
          apiCalls: budget.report(),
        }, warnings);
      } catch (err) {
        return failure(err);
      } finally {
        await cache.save();
      }
    });

    server.registerTool('gog_places_resolve', {
      description:
        'Resolve a list of named stops (1-50) to Google places: place id, address, lat/lng, Maps link, website, '
        + 'phone, opening hours and business status. Takes the top Text Search match per item and flags it '
        + 'ambiguous when the name does not match. Cached per Google policy (ids kept, coordinates 30 days, '
        + 'everything else 24 h), so re-resolving the same list is free. Closed businesses are warned first.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        items: z.array(z.object({
          name: z.string().trim().min(1).describe('Place name, e.g. "Armature Works"'),
          address: z.string().trim().min(1).optional().describe('Address or city to disambiguate, e.g. "Tampa, FL"'),
          near: nearSchema.optional().describe('Bias this item\'s search to a circle'),
        })).min(1).max(50).describe('Stops to resolve (1-50)'),
        fields: fieldsParam('full'),
        view: viewOpt,
        api_budget: apiBudgetParam,
        refresh: z.boolean().optional().describe('Ignore cached entries and look every item up again (costs requests)'),
      }),
    }, async ({ items, fields = 'full', view, api_budget, refresh }) => {
      const cache = cacheOf();
      const budget = new ApiBudget(api_budget ?? API_BUDGET_DEFAULT);
      try {
        const resolved = await resolveItems(items, { client: clientFor(budget), cache, fields, refresh });
        const rung = resolveView(view, [...VIEWS]);
        const warnings = resolved.flatMap((r) => r.warnings);
        return placesResult({
          results: resolved.map((r) => projectResolved(r, rung)),
          resolved: resolved.filter((r) => r.place).length,
          unresolved: resolved.filter((r) => !r.place).length,
          warnings,
          apiCalls: budget.report(),
        }, warnings);
      } finally {
        // resolveItems never throws: every failure lands on its item.
        await cache.save();
      }
    });

    server.registerTool('gog_places_details', {
      description:
        'Details for one Google place id: address, lat/lng, website, phone, opening hours, price level, '
        + 'accessibility and business status. With `at` (local time at the place, e.g. 2026-11-21T19:30), also '
        + 'says whether it is open then, and when it opens or closes. Free when cached (24 h).',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        placeId: z.string().trim().min(1).describe('Google place id (from search/resolve), with or without "places/"'),
        at: z.union([
          z.string().describe('Local date-time at the place, e.g. 2026-11-21T19:30 (no Z/offset)'),
          z.object({
            date: z.string().describe('YYYY-MM-DD'),
            time: z.string().describe('HH:MM, 24-hour'),
          }),
        ]).optional().describe('Check whether the place is open at this local date and time. Requests full fields.'),
        fields: fieldsParam('full'),
        view: viewOpt,
        refresh: z.boolean().optional().describe('Ignore a cached entry and fetch again (one request)'),
      }),
    }, async ({ placeId, at, fields = 'full', view, refresh }) => {
      const cache = cacheOf();
      const budget = new ApiBudget(1);
      try {
        // Validate before spending anything; an open-at check needs the hours (full).
        if (at !== undefined) parseLocalDateTime(at);
        const mask: PlacesFieldSet = at !== undefined ? 'full' : fields;
        const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId;
        const { place, cached } = await detailsById(id, { client: clientFor(budget), cache, fields: mask, refresh });
        const warnings = statusWarnings(place);
        const openAt = at !== undefined ? evaluateOpenAt(place, at) : undefined;
        if (openAt && openAt.open === false && warnings.length === 0) {
          warnings.push(`Not open at ${openAt.at}: ${openAt.reason}`);
        }
        return placesResult(pruneUndefined({
          place: projectPlace(place, resolveView(view, [...VIEWS])),
          openAt,
          cached,
          warnings,
          apiCalls: budget.report(),
        }), warnings);
      } catch (err) {
        return failure(err);
      } finally {
        await cache.save();
      }
    });
  };
}
