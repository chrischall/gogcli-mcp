/**
 * A fake `gog` for the maps commands (fixtures only: no test here may run the
 * real binary, which would bill the owner's Places/Geocoding key).
 *
 * `gog maps places search` matches the first fixture whose needle the query
 * contains; no match is gog's own failure ("no places matched"). `details`
 * routes by id, `geocode` by the exact address. Anything else falls through to
 * `fallback` (the trip tests' in-memory Drive) or fails as unexpected.
 */
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type { Spawner } from '../../../gogcli-mcp/src/lib.js';

/** The `place` object gog prints (snake_case, four fields). */
export interface GogPlaceJson {
  id: string;
  name?: string;
  formatted_address?: string;
  google_maps_uri?: string;
}

export interface GeocodeJson {
  formatted_address?: string;
  place_id?: string;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
}

export interface MapsFixtures {
  search?: Record<string, GogPlaceJson | null>;
  details?: Record<string, GogPlaceJson | null>;
  geocode?: Record<string, GeocodeJson[]>;
  /** Return stderr to fail this argv with exit 1. */
  fail?: (argv: string[]) => string | undefined;
}

export interface Reply {
  code: number;
  stdout?: string;
  stderr?: string;
}

export const positionals = (argv: string[]): string[] => (argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : []);
export const command = (argv: string[]): string[] => argv.slice(0, argv.includes('--') ? argv.indexOf('--') : argv.length)
  .filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--account');

export function mapsAnswer(argv: string[], fx: MapsFixtures): Reply | undefined {
  const cmd = command(argv).join(' ');
  const arg = positionals(argv).join(' ');
  if (cmd === 'maps places search') {
    const hit = Object.entries(fx.search ?? {}).find(([needle]) => arg.includes(needle));
    if (!hit) return { code: 1, stderr: `no places matched: "${arg}"` };
    return { code: 0, stdout: JSON.stringify({ place: hit[1] }) };
  }
  if (cmd === 'maps places details') {
    const place = fx.details?.[arg];
    if (place === undefined) return { code: 1, stderr: 'places API error: 404 NOT_FOUND' };
    return { code: 0, stdout: JSON.stringify({ place }) };
  }
  if (cmd === 'maps geocode') {
    const results = fx.geocode?.[arg];
    return {
      code: 0,
      stdout: JSON.stringify({ geocode: results?.length ? { status: 'OK', results } : { status: 'ZERO_RESULTS' } }),
    };
  }
  return undefined;
}

/** A Spawner that answers maps commands from fixtures, records every argv, and defers anything else. */
export function fakeMapsGog(fx: MapsFixtures = {}, fallback?: (argv: string[]) => Reply) {
  const argvs: string[][] = [];
  const spawner = ((_cmd: string, argv: string[]) => {
    argvs.push(argv);
    const proc = new EventEmitter() as ReturnType<Spawner>;
    const io = proc as unknown as { stdout: EventEmitter; stderr: EventEmitter };
    io.stdout = new EventEmitter();
    io.stderr = new EventEmitter();
    proc.kill = vi.fn();
    const failure = fx.fail?.(argv);
    const reply: Reply = failure
      ? { code: 1, stderr: failure }
      : mapsAnswer(argv, fx) ?? fallback?.(argv) ?? { code: 1, stderr: `unexpected gog call: ${argv.join(' ')}` };
    setTimeout(() => {
      if (reply.stdout) io.stdout.emit('data', Buffer.from(reply.stdout));
      if (reply.stderr) io.stderr.emit('data', Buffer.from(reply.stderr));
      proc.emit('close', reply.code);
    }, 0);
    return proc;
  }) as unknown as Spawner;
  const calls = (...words: string[]) => argvs.filter((a) => words.every((w, i) => command(a)[i] === w));
  return { spawner, argvs, calls };
}

export const ARMATURE: GogPlaceJson = {
  id: 'ChIJ_armature',
  name: 'Armature Works',
  formatted_address: '1910 N Ola Ave, Tampa, FL 33602, USA',
  google_maps_uri: 'https://maps.google.com/?cid=1',
};

export const STADIUM: GogPlaceJson = {
  id: 'ChIJ_stadium',
  name: 'Raymond James Stadium',
  formatted_address: '4201 N Dale Mabry Hwy, Tampa, FL 33607, USA',
  google_maps_uri: 'https://maps.google.com/?cid=2',
};

/** Geocode results: the place's own id (an exact match) or a different one (approximate). */
export const GEO: Record<string, GeocodeJson[]> = {
  [ARMATURE.formatted_address!]: [{
    formatted_address: ARMATURE.formatted_address,
    place_id: 'ChIJ_armature',
    geometry: { location: { lat: 27.9606, lng: -82.4637 }, location_type: 'ROOFTOP' },
  }],
  [STADIUM.formatted_address!]: [{
    formatted_address: STADIUM.formatted_address,
    place_id: 'ChIJ_street_address',
    geometry: { location: { lat: 27.9759, lng: -82.5033 }, location_type: 'RANGE_INTERPOLATED' },
  }],
};
