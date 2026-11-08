import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Owner decision (2026-11-08): this MCP calls nothing outside gog. Every Google
// request is a `gog` subprocess through runner.ts; the package's own source
// opens no connection. URL *builders* for Maps links (https://www.google.com/maps/…)
// are text, not requests, and are allowed.
const SRC = new URL('../src/', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['http/https import', /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?https?['"]/],
  ['net/tls/http2/dgram import', /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:net|tls|http2|dgram)['"]/],
  ['undici', /undici/],
  ['googleapis.com', /googleapis\.com/],
  ['XMLHttpRequest / WebSocket', /\b(?:XMLHttpRequest|WebSocket)\b/],
  // The Places key is gog's: runner.ts hands GOG_PLACES_API_KEY to gog, and
  // this package never reads a key itself.
  ['a Places API key', /PLACES_API_KEY|places_api_key\s*[:=]/],
];

describe('no network outside gog', () => {
  const files = sources(SRC);

  it('scans the whole package source', () => {
    expect(files.map((f) => f.slice(SRC.length)).sort()).toEqual(expect.arrayContaining(['index.ts', 'places-gog.ts', 'tools/places.ts']));
  });

  it.each(FORBIDDEN)('no %s in src/', (_label, pattern) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length));
    expect(hits).toEqual([]);
  });

  it('the patterns catch what they are for', () => {
    expect(FORBIDDEN[0]![1].test('await fetch(url)')).toBe(true);
    expect(FORBIDDEN[1]![1].test("import { request } from 'node:https';")).toBe(true);
    expect(FORBIDDEN[1]![1].test("const h = require('http')")).toBe(true);
    expect(FORBIDDEN[4]![1].test("const BASE = 'https://places.googleapis.com/v1'")).toBe(true);
    // A Maps link builder is fine.
    expect(FORBIDDEN.some(([, p]) => p.test("const SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';"))).toBe(false);
  });
});
