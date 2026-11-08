import { describe, it, expect } from 'vitest';
import { geocodeAddress, placeDetails, searchPlace } from '../src/places-gog.js';
import { ARMATURE, fakeMapsGog, GEO, positionals } from './support/fake-maps.js';

describe('searchPlace (gog maps places search)', () => {
  it('runs the query as one positional and maps gog\'s snake_case place', async () => {
    const gog = fakeMapsGog({ search: { Armature: ARMATURE } });
    const place = await searchPlace('-Armature Works, Tampa', { spawner: gog.spawner });
    expect(place).toEqual({
      id: 'ChIJ_armature',
      name: 'Armature Works',
      formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
      googleMapsUri: 'https://maps.google.com/?cid=1',
    });
    const [argv] = gog.calls('maps', 'places', 'search');
    expect(argv).toEqual(expect.arrayContaining(['--json', '--no-input']));
    // A query starting with "-" is data, never a flag.
    expect(positionals(argv!)).toEqual(['-Armature Works, Tampa']);
  });

  it('returns undefined when gog finds no match', async () => {
    const gog = fakeMapsGog();
    await expect(searchPlace('Nowhere', { spawner: gog.spawner })).resolves.toBeUndefined();
  });

  it('returns undefined for a place with no id, and rethrows any other gog failure', async () => {
    const empty = fakeMapsGog({ search: { X: { id: '' } } });
    await expect(searchPlace('X', { spawner: empty.spawner })).resolves.toBeUndefined();
    const broken = fakeMapsGog({ fail: () => 'Google Maps/Places API key required' });
    await expect(searchPlace('X', { spawner: broken.spawner })).rejects.toThrow(/API key required/);
  });

  it('treats output without a place object as no match', async () => {
    const gog = fakeMapsGog({ search: { X: null } });
    await expect(searchPlace('X', { spawner: gog.spawner })).resolves.toBeUndefined();
  });
});

describe('placeDetails (gog maps places details)', () => {
  it('fetches by id, stripping a "places/" prefix', async () => {
    const gog = fakeMapsGog({ details: { ChIJ_armature: ARMATURE } });
    const place = await placeDetails('places/ChIJ_armature', { spawner: gog.spawner });
    expect(place.name).toBe('Armature Works');
    expect(positionals(gog.calls('maps', 'places', 'details')[0]!)).toEqual(['ChIJ_armature']);
  });

  it('keeps the asked-for id when gog omits it, and propagates gog errors', async () => {
    const gog = fakeMapsGog({ details: { abc: { id: '', name: 'Somewhere' } } });
    await expect(placeDetails('abc', { spawner: gog.spawner })).resolves.toEqual({ id: 'abc', name: 'Somewhere' });
    await expect(placeDetails('missing', { spawner: gog.spawner })).rejects.toThrow(/404/);
    const bare = fakeMapsGog({ details: { b: { id: 'b' } } });
    await expect(placeDetails('b', { spawner: bare.spawner })).resolves.toEqual({ id: 'b' });
    const nul = fakeMapsGog({ details: { z: null } });
    await expect(placeDetails('z', { spawner: nul.spawner })).rejects.toThrow(/returned no place for z/);
  });
});

describe('geocodeAddress (gog maps geocode)', () => {
  it('takes the first result\'s point and place id', async () => {
    const gog = fakeMapsGog({ geocode: GEO });
    const hit = await geocodeAddress(ARMATURE.formatted_address!, { spawner: gog.spawner });
    expect(hit).toEqual({ lat: 27.9606, lng: -82.4637, placeId: 'ChIJ_armature' });
    expect(positionals(gog.calls('maps', 'geocode')[0]!)).toEqual([ARMATURE.formatted_address]);
  });

  it('returns undefined for ZERO_RESULTS or a result without numeric coordinates', async () => {
    const gog = fakeMapsGog({ geocode: { odd: [{ place_id: 'x', geometry: { location: { lat: 1 } } }] } });
    await expect(geocodeAddress('nowhere', { spawner: gog.spawner })).resolves.toBeUndefined();
    await expect(geocodeAddress('odd', { spawner: gog.spawner })).resolves.toBeUndefined();
  });

  it('omits an absent place id', async () => {
    const gog = fakeMapsGog({ geocode: { a: [{ geometry: { location: { lat: 1, lng: 2 } } }] } });
    await expect(geocodeAddress('a', { spawner: gog.spawner })).resolves.toEqual({ lat: 1, lng: 2 });
  });
});
