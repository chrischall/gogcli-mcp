import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { withCallSignal } from '@chrischall/mcp-utils';
import type { Spawner } from '../../gogcli-mcp/src/lib.js';
import { ApiBudget, BudgetExceededError } from '../src/budget.js';
import {
  BASIC_FIELDS,
  FULL_FIELDS,
  PLACES_API_BASE,
  PLACES_TIMEOUT_MS,
  PlacesApiError,
  PlacesClient,
  PlacesKeyMissingError,
  fieldMask,
  readGogPlacesKey,
  resolvePlacesApiKey,
  type FetchLike,
} from '../src/places-client.js';

// Two key shapes: one the shared redactor knows (AIza…, 39 chars) and one it
// does not, so the literal-value scrub is what must catch it.
const GOOGLE_SHAPED_KEY = 'AIzaSyD-TESTONLY-0123456789abcdefghijk';
const ODD_KEY = 'odd-places-key-zz9-plural-z-alpha';

interface Captured {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(...responses: Array<Response | (() => Promise<Response>)>): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return typeof next === 'function' ? next() : next;
  };
  return { fetch, calls };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

function gogSpawner(reply: { code: number; stdout?: string; stderr?: string }): { spawner: Spawner; argv: string[][] } {
  const argv: string[][] = [];
  const spawner = ((_cmd: string, args: string[]) => {
    argv.push(args);
    const proc = new EventEmitter() as ReturnType<Spawner>;
    const io = proc as unknown as { stdout: EventEmitter; stderr: EventEmitter };
    io.stdout = new EventEmitter();
    io.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setTimeout(() => {
      if (reply.stdout) io.stdout.emit('data', Buffer.from(reply.stdout));
      if (reply.stderr) io.stderr.emit('data', Buffer.from(reply.stderr));
      proc.emit('close', reply.code);
    }, 0);
    return proc;
  }) as unknown as Spawner;
  return { spawner, argv };
}

describe('field masks', () => {
  it('BASIC is the Pro set and FULL adds the Enterprise fields', () => {
    expect(BASIC_FIELDS).toEqual([
      'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'businessStatus', 'utcOffsetMinutes',
    ]);
    expect(FULL_FIELDS).toEqual([
      ...BASIC_FIELDS,
      'websiteUri', 'nationalPhoneNumber', 'internationalPhoneNumber', 'regularOpeningHours',
      'currentOpeningHours', 'priceLevel', 'accessibilityOptions',
    ]);
  });

  it('prefixes every field for Text Search and leaves Details bare', () => {
    expect(fieldMask('basic')).toBe(BASIC_FIELDS.join(','));
    expect(fieldMask('basic', 'places.')).toBe(BASIC_FIELDS.map((f) => `places.${f}`).join(','));
    expect(fieldMask('full', 'places.').split(',')).toHaveLength(FULL_FIELDS.length);
    expect(fieldMask('full', 'places.')).not.toContain('*');
  });
});

describe('resolvePlacesApiKey', () => {
  it('prefers GOG_PLACES_API_KEY over GOOGLE_PLACES_API_KEY and never asks gog', async () => {
    const readGogConfig = vi.fn(async () => 'from-gog');
    await expect(
      resolvePlacesApiKey({ env: { GOG_PLACES_API_KEY: 'gog-env', GOOGLE_PLACES_API_KEY: 'google-env' }, readGogConfig }),
    ).resolves.toBe('gog-env');
    expect(readGogConfig).not.toHaveBeenCalled();
  });

  it('falls back to GOOGLE_PLACES_API_KEY, treating blank and placeholder values as unset', async () => {
    const readGogConfig = vi.fn(async () => 'from-gog');
    await expect(
      resolvePlacesApiKey({ env: { GOG_PLACES_API_KEY: '${user_config.places_api_key}', GOOGLE_PLACES_API_KEY: 'google-env' }, readGogConfig }),
    ).resolves.toBe('google-env');
    await expect(resolvePlacesApiKey({ env: { GOG_PLACES_API_KEY: '  ', GOOGLE_PLACES_API_KEY: '' }, readGogConfig })).resolves.toBe('from-gog');
    expect(readGogConfig).toHaveBeenCalledTimes(1);
  });

  it('throws a setup error naming both ways to configure the key when none is found', async () => {
    const err = await resolvePlacesApiKey({ env: {}, readGogConfig: async () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesKeyMissingError);
    const message = (err as Error).message;
    expect(message).toContain('gog config set places_api_key <key>');
    expect(message).toContain('GOG_PLACES_API_KEY');
    expect(message).toMatch(/Places API \(New\)/);
    expect(message).toMatch(/billing/);
  });

  it('defaults to process.env', async () => {
    vi.stubEnv('GOG_PLACES_API_KEY', 'process-env-key');
    try {
      await expect(resolvePlacesApiKey({ readGogConfig: async () => undefined })).resolves.toBe('process-env-key');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('readGogPlacesKey (gog config through runner.ts)', () => {
  it('reads the value intact — the runner redactor never sees it', async () => {
    const { spawner, argv } = gogSpawner({ code: 0, stdout: JSON.stringify({ key: 'places_api_key', value: GOOGLE_SHAPED_KEY }) });
    await expect(readGogPlacesKey({ spawner })).resolves.toBe(GOOGLE_SHAPED_KEY);
    expect(argv[0]).toEqual(expect.arrayContaining(['config', 'get', 'places_api_key']));
  });

  it('returns undefined for an unset value, a non-string value, non-JSON output, or a failing gog', async () => {
    await expect(readGogPlacesKey({ spawner: gogSpawner({ code: 0, stdout: '{"key":"places_api_key","value":""}' }).spawner })).resolves.toBeUndefined();
    await expect(readGogPlacesKey({ spawner: gogSpawner({ code: 0, stdout: '{"key":"places_api_key","value":7}' }).spawner })).resolves.toBeUndefined();
    await expect(readGogPlacesKey({ spawner: gogSpawner({ code: 0, stdout: 'not json' }).spawner })).resolves.toBeUndefined();
    await expect(readGogPlacesKey({ spawner: gogSpawner({ code: 0, stdout: 'null' }).spawner })).resolves.toBeUndefined();
    await expect(
      readGogPlacesKey({ spawner: gogSpawner({ code: 1, stderr: `unknown key ${GOOGLE_SHAPED_KEY}` }).spawner }),
    ).resolves.toBeUndefined();
  });

  it('is the default third source of resolvePlacesApiKey', async () => {
    const { spawner } = gogSpawner({ code: 0, stdout: JSON.stringify({ key: 'places_api_key', value: ` ${ODD_KEY} ` }) });
    await expect(resolvePlacesApiKey({ env: {}, spawner })).resolves.toBe(ODD_KEY);
  });
});

describe('PlacesClient.searchText', () => {
  it('posts the query with the prefixed BASIC mask and the key in a header, never the URL', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { places: [{ id: 'abc' }] }));
    const client = new PlacesClient({ fetch, apiKey: GOOGLE_SHAPED_KEY });
    await expect(client.searchText({ query: 'Armature Works Tampa' })).resolves.toEqual([{ id: 'abc' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PLACES_API_BASE}/places:searchText`);
    expect(calls[0].url).not.toContain(GOOGLE_SHAPED_KEY);
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0].init, 'X-Goog-Api-Key')).toBe(GOOGLE_SHAPED_KEY);
    expect(header(calls[0].init, 'X-Goog-FieldMask')).toBe(fieldMask('basic', 'places.'));
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ textQuery: 'Armature Works Tampa', pageSize: 10 });
    expect(client.budget.report()).toMatchObject({ textSearch: 1, sku: 'Pro' });
  });

  it('sends a circle location bias, page size, language and region, with the FULL mask', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, {}));
    const client = new PlacesClient({ fetch, apiKey: 'k' });
    await expect(
      client.searchText(
        { query: 'brewery', near: { lat: 27.96, lng: -82.46, radiusM: 5000 }, maxResults: 3, languageCode: 'en', regionCode: 'US' },
        'full',
      ),
    ).resolves.toEqual([]);
    expect(header(calls[0].init, 'X-Goog-FieldMask')).toBe(fieldMask('full', 'places.'));
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      textQuery: 'brewery',
      pageSize: 3,
      locationBias: { circle: { center: { latitude: 27.96, longitude: -82.46 }, radius: 5000 } },
      languageCode: 'en',
      regionCode: 'US',
    });
    expect(client.budget.report().sku).toBe('Enterprise');
  });

  it('defaults the bias radius to 50 km', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { places: [] }));
    await new PlacesClient({ fetch, apiKey: 'k' }).searchText({ query: 'x', near: { lat: 0, lng: 0 } });
    expect(JSON.parse(calls[0].init.body as string).locationBias.circle.radius).toBe(50_000);
  });

  it('refuses invalid input before spending budget or calling Google', async () => {
    const { fetch, calls } = fakeFetch();
    const client = new PlacesClient({ fetch, apiKey: 'k' });
    await expect(client.searchText({ query: '   ' })).rejects.toThrow(/query/);
    await expect(client.searchText({ query: 'x', maxResults: 21 })).rejects.toThrow(/1 to 20/);
    await expect(client.searchText({ query: 'x', maxResults: 0 })).rejects.toThrow(/1 to 20/);
    await expect(client.searchText({ query: 'x', near: { lat: 0, lng: 0, radiusM: 50_001 } })).rejects.toThrow(/50000/);
    await expect(client.searchText({ query: 'x', near: { lat: 0, lng: 0, radiusM: 0 } })).rejects.toThrow(/50000/);
    await expect(client.searchText({ query: 'x', near: { lat: 91, lng: 0 } })).rejects.toThrow(/latitude/);
    await expect(client.searchText({ query: 'x', near: { lat: 0, lng: -181 } })).rejects.toThrow(/longitude/);
    expect(calls).toHaveLength(0);
    expect(client.budget.report().textSearch).toBe(0);
  });
});

describe('PlacesClient.details', () => {
  it('GETs the place by id with the bare FULL mask by default', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { id: 'ChIJ_abc-123', businessStatus: 'OPERATIONAL' }));
    const client = new PlacesClient({ fetch, apiKey: 'k' });
    await expect(client.details('ChIJ_abc-123')).resolves.toEqual({ id: 'ChIJ_abc-123', businessStatus: 'OPERATIONAL' });
    expect(calls[0].url).toBe(`${PLACES_API_BASE}/places/ChIJ_abc-123`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(header(calls[0].init, 'X-Goog-FieldMask')).toBe(fieldMask('full'));
    expect(client.budget.report()).toMatchObject({ details: 1, sku: 'Enterprise' });
  });

  it('accepts a places/ resource name, a BASIC mask and a language code', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { id: 'abc' }));
    await new PlacesClient({ fetch, apiKey: 'k' }).details('places/abc', 'basic', { languageCode: 'es' });
    expect(calls[0].url).toBe(`${PLACES_API_BASE}/places/abc?languageCode=es`);
    expect(header(calls[0].init, 'X-Goog-FieldMask')).toBe(fieldMask('basic'));
  });

  it('refuses an id that could escape the path', async () => {
    const { fetch, calls } = fakeFetch();
    const client = new PlacesClient({ fetch, apiKey: 'k' });
    await expect(client.details('../places:searchText')).rejects.toThrow(PlacesApiError);
    await expect(client.details('')).rejects.toThrow(/place id/);
    expect(calls).toHaveLength(0);
  });
});

describe('PlacesClient budget', () => {
  it('stops issuing requests once the budget is spent', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { id: 'a' }), jsonResponse(200, { places: [] }));
    const client = new PlacesClient({ fetch, apiKey: 'k', budget: new ApiBudget(2) });
    await client.details('a');
    await client.searchText({ query: 'b' });
    await expect(client.details('c')).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(client.searchText({ query: 'd' })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(2);
  });

  it('a missing key fails before any budget is spent', async () => {
    const { fetch, calls } = fakeFetch();
    const client = new PlacesClient({ fetch, env: {}, readGogConfig: async () => undefined });
    await expect(client.searchText({ query: 'x' })).rejects.toBeInstanceOf(PlacesKeyMissingError);
    expect(client.budget.report().textSearch).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('PlacesClient key resolution', () => {
  it('resolves the key once and reuses it', async () => {
    const readGogConfig = vi.fn(async () => ODD_KEY);
    const { fetch, calls } = fakeFetch(jsonResponse(200, { id: 'a' }), jsonResponse(200, { id: 'b' }));
    const client = new PlacesClient({ fetch, env: {}, readGogConfig });
    await client.details('a');
    await client.details('b');
    expect(readGogConfig).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => header(c.init, 'X-Goog-Api-Key'))).toEqual([ODD_KEY, ODD_KEY]);
  });

  it('retries resolution after a miss, so setting the key later works without a restart', async () => {
    const readGogConfig = vi.fn<() => Promise<string | undefined>>().mockResolvedValueOnce(undefined).mockResolvedValueOnce('late-key');
    const { fetch } = fakeFetch(jsonResponse(200, { id: 'a' }));
    const client = new PlacesClient({ fetch, env: {}, readGogConfig });
    await expect(client.details('a')).rejects.toBeInstanceOf(PlacesKeyMissingError);
    await expect(client.details('a')).resolves.toEqual({ id: 'a' });
  });

  it('uses the global fetch and process env when nothing is injected', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { id: 'g' }));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('GOG_PLACES_API_KEY', 'env-key');
    try {
      await expect(new PlacesClient().details('g')).resolves.toEqual({ id: 'g' });
      expect(header(calls[0].init, 'X-Goog-Api-Key')).toBe('env-key');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe('PlacesClient errors never carry the key', () => {
  const cases: Array<[number, string, RegExp]> = [
    [400, 'INVALID_ARGUMENT', /rejected the request \(400 INVALID_ARGUMENT\)/],
    [403, 'PERMISSION_DENIED', /refused the key \(403 PERMISSION_DENIED\).*gog config set places_api_key.*Places API \(New\)/s],
    [429, 'RESOURCE_EXHAUSTED', /quota or rate limit \(429 RESOURCE_EXHAUSTED\)/],
    [500, 'INTERNAL', /Places API error \(HTTP 500 INTERNAL\)/],
  ];

  for (const key of [GOOGLE_SHAPED_KEY, ODD_KEY]) {
    for (const [status, code, pattern] of cases) {
      it(`maps HTTP ${status} to friendly text and redacts a ${key === ODD_KEY ? 'non-standard' : 'Google-shaped'} key`, async () => {
        const { fetch } = fakeFetch(
          jsonResponse(status, { error: { code: status, status: code, message: `API key ${key} is bad (echoed: key=${key})` } }),
        );
        const err = await new PlacesClient({ fetch, apiKey: key }).details('abc').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(PlacesApiError);
        expect((err as PlacesApiError).status).toBe(status);
        expect((err as Error).message).toMatch(pattern);
        expect((err as Error).message).not.toContain(key);
        expect((err as Error).message).toContain('[REDACTED]');
      });
    }
  }

  it('handles an error body with no JSON, and one with no status name', async () => {
    const { fetch } = fakeFetch(
      new Response(`<html>${ODD_KEY}</html>`, { status: 502 }),
      jsonResponse(404, { error: { message: 'Not found' } }),
      jsonResponse(503, { error: 'flat string' }),
      jsonResponse(400, { error: { status: 'FAILED_PRECONDITION' } }),
    );
    const client = new PlacesClient({ fetch, apiKey: ODD_KEY });
    const e502 = (await client.details('a').catch((e: unknown) => e)) as Error;
    expect(e502.message).toMatch(/HTTP 502\): <html>\[REDACTED\]<\/html>/);
    const e404 = (await client.details('a').catch((e: unknown) => e)) as Error;
    expect(e404.message).toBe('Places API error (HTTP 404): Not found');
    const e503 = (await client.details('a').catch((e: unknown) => e)) as Error;
    expect(e503.message).toMatch(/HTTP 503\): \{"error":"flat string"\}/);
    const e400 = (await client.details('a').catch((e: unknown) => e)) as Error;
    expect(e400.message).toMatch(/^Places API rejected the request \(400 FAILED_PRECONDITION\): \{"error"/);
  });

  it('truncates a huge error body', async () => {
    const { fetch } = fakeFetch(new Response('x'.repeat(5000), { status: 500 }));
    const err = (await new PlacesClient({ fetch, apiKey: 'k1' }).details('a').catch((e: unknown) => e)) as Error;
    expect(err.message.length).toBeLessThan(700);
    expect(err.message).toContain('…');
  });

  it('reports a non-JSON success body', async () => {
    const { fetch } = fakeFetch(new Response('<html>ok</html>', { status: 200 }));
    await expect(new PlacesClient({ fetch, apiKey: 'k' }).details('a')).rejects.toThrow(/not JSON/);
  });

  it('wraps a network failure and redacts the key from it', async () => {
    const { fetch } = fakeFetch(async () => {
      throw new Error(`connect ECONNREFUSED with ${ODD_KEY}`);
    }, async () => {
      throw 'a bare string';
    });
    const client = new PlacesClient({ fetch, apiKey: ODD_KEY });
    const err = (await client.details('a').catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(PlacesApiError);
    expect(err.message).toBe('Places API request failed: connect ECONNREFUSED with [REDACTED]');
    await expect(client.details('a')).rejects.toThrow('Places API request failed: a bare string');
  });

  it('times out after the configured limit (15 s by default)', async () => {
    expect(PLACES_TIMEOUT_MS).toBe(15_000);
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      });
    const client = new PlacesClient({ fetch, apiKey: 'k', timeoutMs: 20 });
    await expect(client.details('a')).rejects.toThrow('Places API request timed out after 0.02 s');
  });

  it('honours the caller cancelling the tool call', async () => {
    const controller = new AbortController();
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        controller.abort();
      });
    const client = new PlacesClient({ fetch, apiKey: 'k' });
    await expect(withCallSignal(controller.signal, () => client.details('a'))).rejects.toThrow('Places API request cancelled');
  });
});
