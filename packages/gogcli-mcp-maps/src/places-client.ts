/**
 * The ONE module in this package that touches the network: Google Places API
 * (New), called directly over HTTPS with an API key.
 *
 * Why not `gog maps places`: it returns a single result through a fixed
 * four-field mask with no location bias. Why not OAuth: Places would need the
 * broad cloud-platform scope. So the key comes from, in order,
 * GOG_PLACES_API_KEY, GOOGLE_PLACES_API_KEY, then gog's own config
 * (`gog config get places_api_key`).
 *
 * The key must reach Node intact but never appear in a tool result, an error or
 * a log. runner.ts's `run()` redacts `AIza…` keys out of gog's output, which
 * would hand us `[REDACTED]` instead of the key, so the config read goes
 * through `runBinary` (no redaction, raw bytes) and its output never leaves
 * this module. Every error built here is scrubbed with the shared redactor AND
 * by the literal key value, since a restricted key need not have the AIza shape.
 *
 * Every request carries an explicit X-Goog-FieldMask: Google bills at the
 * highest SKU any requested field hits, and a mask is required anyway.
 */
import { readEnvVar, redactSecrets, withAmbientCancellation, type EnvSource } from '@chrischall/mcp-utils';
import { runBinary, type Spawner } from '../../gogcli-mcp/src/lib.js';
import { ApiBudget, type PlacesFieldSet } from './budget.js';

export const PLACES_API_BASE = 'https://places.googleapis.com/v1';
export const PLACES_TIMEOUT_MS = 15_000;
const ERROR_BODY_MAX = 500;
const GOG_CONFIG_TIMEOUT_MS = 10_000;

/** Pro SKU fields. */
export const BASIC_FIELDS: readonly string[] = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'businessStatus',
  'utcOffsetMinutes',
];

/** Enterprise SKU: BASIC plus contact, hours, price and accessibility. */
export const FULL_FIELDS: readonly string[] = [
  ...BASIC_FIELDS,
  'websiteUri',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'regularOpeningHours',
  'currentOpeningHours',
  'priceLevel',
  'accessibilityOptions',
];

/** The X-Goog-FieldMask value; Text Search needs every field prefixed `places.`. */
export function fieldMask(fields: PlacesFieldSet, prefix = ''): string {
  return (fields === 'full' ? FULL_FIELDS : BASIC_FIELDS).map((f) => `${prefix}${f}`).join(',');
}

const KEY_SETUP_HINT =
  'Set it with `gog config set places_api_key <key>` or the GOG_PLACES_API_KEY environment variable. ' +
  'The key must be restricted to the Places API (New) in a Google Cloud project with billing enabled.';

export class PlacesKeyMissingError extends Error {
  constructor() {
    super(`No Google Places API key found. ${KEY_SETUP_HINT}`);
    this.name = 'PlacesKeyMissingError';
  }
}

export class PlacesApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PlacesApiError';
  }
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface OpeningHoursPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface OpeningHours {
  openNow?: boolean;
  periods?: Array<{ open: OpeningHoursPoint; close?: OpeningHoursPoint }>;
  weekdayDescriptions?: string[];
}

/** A Places API (New) Place, limited to the fields our masks request. */
export interface PlacesPlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  location?: LatLng;
  googleMapsUri?: string;
  businessStatus?: string;
  utcOffsetMinutes?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: OpeningHours;
  currentOpeningHours?: OpeningHours;
  priceLevel?: string;
  accessibilityOptions?: Record<string, boolean>;
}

export interface SearchTextRequest {
  query: string;
  /** Bias (not restrict) results to a circle; radius defaults to and caps at 50 km. */
  near?: { lat: number; lng: number; radiusM?: number };
  /** 1..20; defaults to 10. */
  maxResults?: number;
  languageCode?: string;
  regionCode?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface KeyResolverOptions {
  env?: EnvSource;
  spawner?: Spawner;
  /** Override the gog config read (tests). Returns the key or undefined. */
  readGogConfig?: () => Promise<string | undefined>;
}

/**
 * Read `places_api_key` from gog's config. Any failure — gog missing, an older
 * gog that does not know the key, unparseable output — is "not configured":
 * the caller then raises the setup error, which never quotes gog's output.
 */
export async function readGogPlacesKey(opts: { spawner?: Spawner } = {}): Promise<string | undefined> {
  try {
    const b64 = await runBinary(['config', 'get', 'places_api_key'], { spawner: opts.spawner, timeout: GOG_CONFIG_TIMEOUT_MS });
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { value?: unknown } | null;
    const value = parsed?.value;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function resolvePlacesApiKey(opts: KeyResolverOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const fromEnv = readEnvVar('GOG_PLACES_API_KEY', { env }) ?? readEnvVar('GOOGLE_PLACES_API_KEY', { env });
  if (fromEnv) return fromEnv;
  const fromGog = await (opts.readGogConfig ?? (() => readGogPlacesKey({ spawner: opts.spawner })))();
  if (fromGog) return fromGog;
  throw new PlacesKeyMissingError();
}

export interface PlacesClientOptions extends KeyResolverOptions {
  fetch?: FetchLike;
  /** A key supplied directly skips resolution entirely. */
  apiKey?: string;
  budget?: ApiBudget;
  timeoutMs?: number;
}

const PLACE_ID = /^[A-Za-z0-9_-]{1,512}$/;

export class PlacesClient {
  readonly budget: ApiBudget;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private key: string | undefined;

  constructor(private readonly opts: PlacesClientOptions = {}) {
    this.budget = opts.budget ?? new ApiBudget();
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? PLACES_TIMEOUT_MS;
    this.key = opts.apiKey;
  }

  async searchText(req: SearchTextRequest, fields: PlacesFieldSet = 'basic'): Promise<PlacesPlace[]> {
    const query = req.query.trim();
    if (!query) throw new PlacesApiError('A search query is required.');
    const pageSize = req.maxResults ?? 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
      throw new PlacesApiError('maxResults must be an integer from 1 to 20.');
    }
    const body: Record<string, unknown> = { textQuery: query, pageSize };
    if (req.near) {
      const { lat, lng, radiusM = 50_000 } = req.near;
      if (!(lat >= -90 && lat <= 90)) throw new PlacesApiError('near.lat must be a latitude from -90 to 90.');
      if (!(lng >= -180 && lng <= 180)) throw new PlacesApiError('near.lng must be a longitude from -180 to 180.');
      if (!(radiusM > 0 && radiusM <= 50_000)) throw new PlacesApiError('near.radius_m must be more than 0 and at most 50000.');
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } };
    }
    if (req.languageCode) body.languageCode = req.languageCode;
    if (req.regionCode) body.regionCode = req.regionCode;

    const result = (await this.request('textSearch', fields, `${PLACES_API_BASE}/places:searchText`, {
      method: 'POST',
      mask: fieldMask(fields, 'places.'),
      body: JSON.stringify(body),
    })) as { places?: PlacesPlace[] };
    return result.places ?? [];
  }

  async details(placeId: string, fields: PlacesFieldSet = 'full', opts: { languageCode?: string } = {}): Promise<PlacesPlace> {
    const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId;
    if (!PLACE_ID.test(id)) throw new PlacesApiError(`Not a valid place id: ${JSON.stringify(placeId.slice(0, 80))}`);
    const query = opts.languageCode ? `?languageCode=${encodeURIComponent(opts.languageCode)}` : '';
    return (await this.request('details', fields, `${PLACES_API_BASE}/places/${id}${query}`, {
      method: 'GET',
      mask: fieldMask(fields),
    })) as PlacesPlace;
  }

  private async apiKey(): Promise<string> {
    this.key ??= await resolvePlacesApiKey(this.opts);
    return this.key;
  }

  /**
   * Scrub text from elsewhere (a gog error in the same tool call) bound for the
   * caller: the shared redactor, plus this client's key once it is known.
   */
  scrub(text: string): string {
    return this.key ? this.redact(text) : redactSecrets(text);
  }

  /** Scrub the key (and any other secret shape) out of text bound for the caller. */
  private redact(text: string): string {
    // Only ever called after apiKey() resolved, so the key is known here.
    return redactSecrets(text).split(this.key!).join('[REDACTED]');
  }

  private async request(
    kind: 'textSearch' | 'details',
    fields: PlacesFieldSet,
    url: string,
    init: { method: 'GET' | 'POST'; mask: string; body?: string },
  ): Promise<unknown> {
    const key = await this.apiKey();
    this.budget.spend(kind, fields);

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = withAmbientCancellation(timeout)!;
    const headers: Record<string, string> = { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': init.mask };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: init.method, headers, body: init.body, signal });
    } catch (err) {
      if (timeout.aborted) throw new PlacesApiError(`Places API request timed out after ${this.timeoutMs / 1000} s`);
      if (signal.aborted) throw new PlacesApiError('Places API request cancelled');
      throw new PlacesApiError(this.redact(`Places API request failed: ${err instanceof Error ? err.message : String(err)}`));
    }

    const text = await response.text();
    if (!response.ok) throw this.httpError(response.status, text);
    try {
      return JSON.parse(text);
    } catch {
      throw new PlacesApiError('Places API returned a response that is not JSON.', response.status);
    }
  }

  private httpError(status: number, text: string): PlacesApiError {
    let code = '';
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { status?: string; message?: string } };
      if (parsed.error && typeof parsed.error === 'object') {
        code = parsed.error.status ?? '';
        detail = parsed.error.message ?? text;
      }
    } catch {
      // Not JSON (an HTML proxy page, say): quote the body itself.
    }
    if (detail.length > ERROR_BODY_MAX) detail = `${detail.slice(0, ERROR_BODY_MAX)}…`;
    const tag = code ? `${status} ${code}` : String(status);
    let message: string;
    if (status === 400) {
      message = `Places API rejected the request (${tag}): ${detail}`;
    } else if (status === 403) {
      message = `Places API refused the key (${tag}): ${detail}. ${KEY_SETUP_HINT}`;
    } else if (status === 429) {
      message = `Places API quota or rate limit (${tag}): ${detail}. Wait and retry, or raise the quota in the Cloud console.`;
    } else {
      message = `Places API error (HTTP ${tag}): ${detail}`;
    }
    return new PlacesApiError(this.redact(message), status);
  }
}
