import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  buildKml,
  buildShortlists,
  CATEGORY_COLORS,
  dayLabel,
  MAPS_URL_MAX,
  normalizeStops,
  pinUrl,
  SHORTLIST_MAX_IDS,
  TripInputError,
  type Trip,
  type TripMapStop,
} from '../src/trip.js';

/**
 * A minimal XML well-formedness checker: balanced, properly nested tags; legal
 * entity references only; CDATA sections closed; attribute values quoted; no
 * raw `<` or `&` in text. Enough to prove the KML would parse.
 */
function checkWellFormed(xml: string): void {
  let i = 0;
  const stack: string[] = [];
  if (xml.startsWith('<?xml')) i = xml.indexOf('?>') + 2;
  const text = (s: string) => {
    const bad = s.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
    if (bad) throw new Error(`bare & in text near ${JSON.stringify(s.slice(0, 40))}`);
    if (s.includes('>') && s.includes(']]>')) throw new Error('stray ]]> in text');
  };
  let rootSeen = false;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      text(xml.slice(i));
      break;
    }
    text(xml.slice(i, lt));
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end === -1) throw new Error('unclosed CDATA');
      if (stack.length === 0) throw new Error('CDATA outside root');
      i = end + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt === -1) throw new Error('unclosed tag');
    const tag = xml.slice(lt + 1, gt);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched </${name}>, expected </${open}>`);
    } else {
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const m = body.match(/^([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*="[^"<]*")*)\s*$/);
      if (!m) throw new Error(`bad tag <${tag}>`);
      text(m[2]);
      if (stack.length === 0) {
        if (rootSeen) throw new Error('second root element');
        rootSeen = true;
      }
      if (!selfClosing) stack.push(m[1]);
    }
    i = gt + 1;
  }
  if (stack.length) throw new Error(`unclosed <${stack.join('><')}>`);
  if (!rootSeen) throw new Error('no root element');
}

function stop(overrides: Partial<TripMapStop> = {}): TripMapStop {
  return {
    index: 0,
    dayNumber: 1,
    date: '2026-11-21',
    name: 'Armature Works',
    ...overrides,
  };
}

function resolved(overrides: Partial<TripMapStop> = {}, place: TripMapStop['place'] = {}): TripMapStop {
  return stop({
    ...overrides,
    place: {
      placeId: 'ChIJarmature',
      lat: 27.9605,
      lng: -82.4626,
      formattedAddress: '1910 N Ola Ave, Tampa, FL 33602, USA',
      googleMapsUri: 'https://maps.google.com/?cid=123',
      websiteUri: 'https://armatureworks.com/',
      phone: '(813) 250-3725',
      ...place,
    },
  });
}

describe('checkWellFormed (test helper)', () => {
  it.each([
    ['<a><b></a></b>', /mismatched/],
    ['<a>x & y</a>', /bare &/],
    ['<a><![CDATA[x</a>', /unclosed CDATA/],
    ['<a', /unclosed tag/],
    ['<a b=c></a>', /bad tag/],
    ['<a></a><b></b>', /second root/],
    ['<a>', /unclosed/],
    ['', /no root/],
    ['<![CDATA[x]]><a></a>', /outside root/],
    ['<a>x]]>y</a>', /stray/],
    ['<a></a>&', /bare &/],
  ])('rejects %s', (xml, err) => {
    expect(() => checkWellFormed(xml)).toThrow(err);
  });

  it('accepts a declaration, attributes, self-closing tags and CDATA', () => {
    expect(() => checkWellFormed('<?xml version="1.0"?><a x="1"><b/><![CDATA[<&]]>&amp;</a>')).not.toThrow();
  });
});

describe('normalizeStops', () => {
  it('maps day numbers to dates from start_date', () => {
    const { stops, notes } = normalizeStops(
      [
        { day: 2, name: 'B' },
        { day: 1, name: 'A' },
      ],
      '2026-11-21',
    );
    expect(stops.map((s) => [s.name, s.dayNumber, s.date])).toEqual([
      ['A', 1, '2026-11-21'],
      ['B', 2, '2026-11-22'],
    ]);
    expect(notes).toEqual([]);
  });

  it('maps day numbers across a month and year boundary', () => {
    const { stops } = normalizeStops([{ day: 13, name: 'NYE' }], '2026-12-20');
    expect(stops[0].date).toBe('2027-01-01');
  });

  it('accepts a numeric day given as a string', () => {
    const { stops } = normalizeStops([{ day: '3', name: 'C' }], '2026-11-21');
    expect(stops[0]).toMatchObject({ dayNumber: 3, date: '2026-11-23' });
  });

  it('leaves day numbers dateless without start_date and says so', () => {
    const { stops, notes } = normalizeStops([{ day: 1, name: 'A' }]);
    expect(stops[0].date).toBeUndefined();
    expect(stops[0].dayNumber).toBe(1);
    expect(notes).toEqual([
      'No start_date: days are numbered, not dated (give start_date to put them on the calendar).',
    ]);
  });

  it('numbers ISO dates from start_date', () => {
    const { stops } = normalizeStops([{ day: '2026-11-23', name: 'C' }], '2026-11-21');
    expect(stops[0]).toMatchObject({ dayNumber: 3, date: '2026-11-23' });
  });

  it('numbers ISO dates from the earliest date when there is no start_date', () => {
    const { stops, notes } = normalizeStops([
      { day: '2026-11-23', name: 'C' },
      { day: '2026-11-21', name: 'A' },
    ]);
    expect(stops.map((s) => [s.name, s.dayNumber])).toEqual([
      ['A', 1],
      ['C', 3],
    ]);
    expect(notes).toEqual([]);
  });

  it('sorts by day then time, untimed stops last in their day, stably', () => {
    const { stops } = normalizeStops(
      [
        { day: 2, name: 'd2-untimed' },
        { day: 1, time: '18:00', name: 'dinner' },
        { day: 1, name: 'untimed-1' },
        { day: 1, time: '9:05', name: 'breakfast' },
        { day: 1, time: '18:00', name: 'dinner-2' },
        { day: 1, name: 'untimed-2' },
        { day: 2, time: '10:00', name: 'd2-morning' },
      ],
      '2026-11-21',
    );
    expect(stops.map((s) => s.name)).toEqual([
      'breakfast',
      'dinner',
      'dinner-2',
      'untimed-1',
      'untimed-2',
      'd2-morning',
      'd2-untimed',
    ]);
    expect(stops[0].time).toBe('09:05');
    expect(stops.map((s) => s.index)).toEqual([3, 1, 4, 2, 5, 6, 0]);
  });

  it('carries address, place_id, note and a lower-cased category; trims text', () => {
    const { stops } = normalizeStops([
      {
        day: 1,
        name: '  Cigar City Brewing ',
        address: ' 3924 W Spruce St ',
        place_id: ' ChIJcigar ',
        note: ' flights ',
        category: ' Drinks ',
      },
    ]);
    expect(stops[0]).toEqual({
      index: 0,
      dayNumber: 1,
      name: 'Cigar City Brewing',
      address: '3924 W Spruce St',
      placeId: 'ChIJcigar',
      note: 'flights',
      category: 'drinks',
    });
  });

  it('drops blank optional fields', () => {
    const { stops } = normalizeStops([{ day: 1, name: 'A', address: ' ', note: '', category: '  ', place_id: '' }]);
    expect(stops[0]).toEqual({ index: 0, dayNumber: 1, name: 'A' });
  });

  it.each([
    [[{ day: 0, name: 'A' }], undefined, /day 0/],
    [[{ day: 1.5, name: 'A' }], undefined, /day 1.5/],
    [[{ day: '0', name: 'A' }], undefined, /day "0"/],
    [[{ day: 'tomorrow', name: 'A' }], undefined, /day "tomorrow"/],
    [[{ day: '2026-02-30', name: 'A' }], undefined, /day "2026-02-30"/],
    [[{ day: 1, name: '   ' }], undefined, /name/],
    [[{ day: 1, time: '25:00', name: 'A' }], undefined, /time "25:00"/],
    [[{ day: 1, time: '9am', name: 'A' }], undefined, /time "9am"/],
    [[{ day: 1, name: 'A' }], '2026-13-01', /start_date "2026-13-01"/],
    [[{ day: '2026-11-20', name: 'A' }], '2026-11-21', /before start_date/],
    [[{ day: 1, name: 'A' }, { day: '2026-11-21', name: 'B' }], undefined, /mixes day numbers and dates/],
    [[], undefined, /at least one stop/],
  ])('refuses invalid input %#', (input, start, err) => {
    expect(() => normalizeStops(input as never, start as string | undefined)).toThrow(TripInputError);
    expect(() => normalizeStops(input as never, start as string | undefined)).toThrow(err);
  });

  it('allows mixing day numbers and dates when start_date anchors both', () => {
    const { stops } = normalizeStops(
      [
        { day: '2026-11-22', name: 'B' },
        { day: 1, name: 'A' },
      ],
      '2026-11-21',
    );
    expect(stops.map((s) => [s.name, s.dayNumber])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });
});

describe('dayLabel', () => {
  it('names a dated day "Day N — Www D Mmm"', () => {
    expect(dayLabel(1, '2026-11-21')).toBe('Day 1 — Sat 21 Nov');
    expect(dayLabel(2, '2026-11-22')).toBe('Day 2 — Sun 22 Nov');
  });

  it('names an undated day "Day N"', () => {
    expect(dayLabel(3)).toBe('Day 3');
  });
});

describe('pinUrl', () => {
  it("uses the place's googleMapsUri when known", () => {
    expect(pinUrl(resolved())).toBe('https://maps.google.com/?cid=123');
  });

  it('builds a search URL with the place id when there is no googleMapsUri', () => {
    const url = pinUrl(resolved({}, { googleMapsUri: undefined }));
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=Armature%20Works%2C%201910%20N%20Ola%20Ave%2C%20Tampa%2C%20FL%2033602%2C%20USA'
        + '&query_place_id=ChIJarmature',
    );
  });

  it('builds a name-only search URL for an unresolved stop, encoding &, #, spaces and unicode', () => {
    const url = pinUrl(stop({ name: 'Café & Bar #1 ☕' }));
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%20%231%20%E2%98%95');
    expect(new URL(url).searchParams.get('query')).toBe('Café & Bar #1 ☕');
  });

  it("uses the stop's own address and place id when the place has none", () => {
    const url = pinUrl(stop({ address: '1 Main St', placeId: 'ChIJown' }));
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Armature%20Works%2C%201%20Main%20St&query_place_id=ChIJown');
  });

  it('survives a lone surrogate instead of throwing URIError', () => {
    const url = pinUrl(stop({ name: 'bad \uD800 text' }));
    expect(new URL(url).searchParams.get('query')).toBe('bad � text');
  });

  it('truncates the query text, never the place id, to stay within 2,048 chars', () => {
    const long = 'é'.repeat(2000);
    const url = pinUrl(stop({ name: long, placeId: 'ChIJkeep' }));
    expect(url.length).toBeLessThanOrEqual(MAPS_URL_MAX);
    expect(url.endsWith('&query_place_id=ChIJkeep')).toBe(true);
    const query = new URL(url).searchParams.get('query')!;
    expect(long.startsWith(query)).toBe(true);
    expect(query.length).toBeGreaterThan(100);
  });

  it('does not split a surrogate pair when truncating', () => {
    const url = pinUrl(stop({ name: '😀'.repeat(400) }));
    expect(url.length).toBeLessThanOrEqual(MAPS_URL_MAX);
    expect(() => decodeURIComponent(url)).not.toThrow();
    expect(new URL(url).searchParams.get('query')).toMatch(/^(😀)+$/u);
  });

  it('falls back to a search URL when googleMapsUri is itself over the limit', () => {
    const url = pinUrl(resolved({}, { googleMapsUri: `https://maps.google.com/?q=${'x'.repeat(2100)}` }));
    expect(url.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true);
  });

  it('drops a place id that cannot fit and pins the coordinates instead of throwing', () => {
    const url = pinUrl(resolved({}, { placeId: 'x'.repeat(2100), googleMapsUri: undefined }));
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=27.9605%2C-82.4626');
  });

  it('drops a place id that cannot fit and searches by name when there are no coordinates', () => {
    const url = pinUrl(stop({ placeId: 'x'.repeat(2100) }));
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Armature%20Works');
    expect(url).not.toContain('query_place_id');
  });
});

describe('buildShortlists', () => {
  const BASE = 'https://www.google.com/maps/@?api=1&map_action=shortlist&place_ids=';
  const ids = (url: string): string[] => new URL(url).searchParams.get('place_ids')!.split(',');
  const withId = (i: number, placeId = `ChIJ${String(i).padStart(23, '0')}`): TripMapStop =>
    resolved({ index: i, name: `Stop ${i}` }, { placeId });

  it('builds one documented shortlist URL, ids in stop order, commas encoded as %2C', () => {
    const { urls, omitted } = buildShortlists([withId(0, 'ChIJa'), withId(1, 'ChIJb'), withId(2, 'ChIJc')]);
    expect(urls).toEqual([`${BASE}ChIJa%2CChIJb%2CChIJc`]);
    expect(ids(urls[0]!)).toEqual(['ChIJa', 'ChIJb', 'ChIJc']);
    expect(omitted).toEqual([]);
  });

  it("uses the stop's own place_id when the place has none", () => {
    expect(buildShortlists([stop({ placeId: 'ChIJown' })]).urls).toEqual([`${BASE}ChIJown`]);
  });

  it('chunks at 20 place ids per link, keeping order', () => {
    const stops = Array.from({ length: 45 }, (_, i) => withId(i));
    const { urls } = buildShortlists(stops);
    expect(SHORTLIST_MAX_IDS).toBe(20);
    expect(urls.map((u) => ids(u).length)).toEqual([20, 20, 5]);
    expect(urls.flatMap(ids)).toEqual(stops.map((s) => s.place!.placeId));
  });

  it('splits earlier when a link would pass 2,048 characters', () => {
    const stops = Array.from({ length: 20 }, (_, i) => withId(i, `ChIJ${String(i).padStart(2, '0')}${'z'.repeat(194)}`));
    const { urls } = buildShortlists(stops);
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls) expect(u.length).toBeLessThanOrEqual(MAPS_URL_MAX);
    expect(urls.flatMap(ids)).toEqual(stops.map((s) => s.place!.placeId));
    // Each chunk is as full as the limit allows: one more id would not fit.
    expect(urls[0]!.length + '%2C'.length + 200).toBeGreaterThan(MAPS_URL_MAX);
  });

  it('lists stops without a place id, and ids too long for any link, as left out', () => {
    const noId = stop({ index: 1, name: 'Somewhere' });
    const huge = stop({ index: 2, name: 'Huge', placeId: 'x'.repeat(2100) });
    const { urls, omitted } = buildShortlists([withId(0, 'ChIJa'), noId, huge]);
    expect(urls).toEqual([`${BASE}ChIJa`]);
    expect(omitted).toEqual([
      { stop: noId, reason: 'no place id' },
      { stop: huge, reason: 'place id too long for a Maps URL' },
    ]);
  });

  it('lists a place once even when several stops share it', () => {
    const { urls } = buildShortlists([withId(0, 'ChIJa'), withId(1, 'ChIJb'), withId(2, 'ChIJa')]);
    expect(urls).toEqual([`${BASE}ChIJa%2CChIJb`]);
  });

  it('percent-encodes commas and ampersands inside an id', () => {
    const { urls } = buildShortlists([stop({ placeId: 'a,b&c' })]);
    expect(urls).toEqual([`${BASE}a%2Cb%26c`]);
  });

  it('returns no links when no stop has a place id', () => {
    const only = stop();
    expect(buildShortlists([only])).toEqual({ urls: [], omitted: [{ stop: only, reason: 'no place id' }] });
  });
});

function tripOf(stops: TripMapStop[], title = 'Tampa weekend'): Trip {
  return { title, stops };
}

describe('buildKml', () => {
  const trip = tripOf([
    resolved({ index: 0, time: '18:00', category: 'food', note: 'patio seating' }),
    resolved(
      { index: 1, name: 'Raymond James Stadium', category: 'event', dayNumber: 2, date: '2026-11-22', time: '13:00' },
      { placeId: 'ChIJrjs', lat: 27.9759, lng: -82.5033, websiteUri: undefined, phone: undefined },
    ),
    resolved(
      { index: 2, name: 'Tampa Riverwalk', category: 'sight', dayNumber: 2, date: '2026-11-22' },
      { placeId: 'ChIJriver', lat: 27.9447, lng: -82.4594 },
    ),
    stop({ index: 3, name: 'Somewhere unknown', dayNumber: 2, date: '2026-11-22' }),
  ]);

  it('is well-formed KML 2.2 with the title as Document name', () => {
    const { kml } = buildKml(trip);
    checkWellFormed(kml);
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">')).toBe(true);
    expect(kml).toMatch(/<Document>\s*<name>Tampa weekend<\/name>/);
  });

  it('has one Folder per day, named with the date', () => {
    const { kml } = buildKml(trip);
    const folders = [...kml.matchAll(/<Folder>\s*<name>([^<]*)<\/name>/g)].map((m) => m[1]);
    expect(folders).toEqual(['Day 1 — Sat 21 Nov', 'Day 2 — Sun 22 Nov']);
  });

  it('has one shared Style per category used, each a distinct colour, plus a default', () => {
    const { kml } = buildKml(
      tripOf([
        ...trip.stops,
        resolved({ index: 4, category: 'food' }),
        resolved({ index: 5, category: 'bowling' }),
        resolved({ index: 6 }),
      ]),
    );
    const styles = [...kml.matchAll(/<Style id="([^"]+)">\s*<IconStyle>\s*<color>([0-9a-f]{8})<\/color>/g)];
    const ids = styles.map((m) => m[1]);
    expect(ids).toEqual(['cat-food', 'cat-event', 'cat-sight', 'cat-default']);
    expect(new Set(styles.map((m) => m[2])).size).toBe(styles.length);
    expect(kml.match(/<styleUrl>#cat-default<\/styleUrl>/g)).toHaveLength(2);
  });

  it('gives every known category a distinct colour from the default', () => {
    const colors = Object.values(CATEGORY_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('writes Point coordinates lng,lat,0 and the stop data in schema order', () => {
    const { kml } = buildKml(trip);
    const pm = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/)![0];
    expect(pm).toContain('<coordinates>-82.4626,27.9605,0</coordinates>');
    const order = ['<name>', '<description>', '<styleUrl>', '<ExtendedData>', '<Point>'].map((t) => pm.indexOf(t));
    expect(order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1]))).toBe(true);
    expect(pm).toContain('<Data name="day"><value>1</value></Data>');
    expect(pm).toContain('<Data name="date"><value>2026-11-21</value></Data>');
    expect(pm).toContain('<Data name="time"><value>18:00</value></Data>');
    expect(pm).toContain('<Data name="category"><value>food</value></Data>');
    expect(pm).toContain('<Data name="place_id"><value>ChIJarmature</value></Data>');
    const desc = pm.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)![1];
    expect(desc).toBe(
      [
        'Time: 18:00',
        'Note: patio seating',
        'Address: 1910 N Ola Ave, Tampa, FL 33602, USA',
        'Website: https://armatureworks.com/',
        'Phone: (813) 250-3725',
        'Google Maps: https://maps.google.com/?cid=123',
      ].join('<br>'),
    );
  });

  it('omits ExtendedData entries that are unknown and keeps a minimal description', () => {
    const { kml } = buildKml(tripOf([resolved({ dayNumber: 1, date: undefined }, { googleMapsUri: undefined, formattedAddress: undefined, websiteUri: undefined, phone: undefined, placeId: undefined })]));
    const pm = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/)![0];
    expect(pm).toContain('<ExtendedData><Data name="day"><value>1</value></Data></ExtendedData>');
    expect(pm).toContain('<styleUrl>#cat-default</styleUrl>');
    expect(pm).toContain(
      '<description><![CDATA[Google Maps: https://www.google.com/maps/search/?api=1&query=Armature%20Works]]></description>',
    );
    expect(kml).toContain('<Folder>\n      <name>Day 1</name>');
  });

  it('omits unresolved stops and lists them', () => {
    const { kml, omitted } = buildKml(trip);
    expect(kml).not.toContain('Somewhere unknown');
    expect(omitted.map((s) => s.name)).toEqual(['Somewhere unknown']);
    expect(kml.match(/<Placemark>/g)).toHaveLength(3);
  });

  it('drops a day folder whose stops are all unresolved', () => {
    const { kml, omitted } = buildKml(tripOf([resolved(), stop({ index: 1, dayNumber: 2, date: '2026-11-22' })]));
    expect(kml).not.toContain('Day 2');
    expect(omitted).toHaveLength(1);
  });

  it('XML-escapes & < > " \' and strips illegal control characters', () => {
    const nasty = `Tom & Jerry's <"Diner">\u0001`;
    const { kml } = buildKml(
      tripOf([resolved({ name: nasty, category: 'a&b' }, { placeId: 'id"<&>' })], `Trip <&> "x" 'y'`),
    );
    checkWellFormed(kml);
    expect(kml).toContain('<name>Trip &lt;&amp;&gt; &quot;x&quot; &apos;y&apos;</name>');
    expect(kml).toContain('<name>Tom &amp; Jerry&apos;s &lt;&quot;Diner&quot;&gt;</name>');
    expect(kml).toContain('<Data name="place_id"><value>id&quot;&lt;&amp;&gt;</value></Data>');
    expect(kml).toContain('<Data name="category"><value>a&amp;b</value></Data>');
    expect(kml).not.toContain('\u0001');
  });

  it('splits ]]> inside the CDATA description so it stays one valid section', () => {
    const { kml } = buildKml(tripOf([resolved({ note: 'a]]>b <script>' })]));
    checkWellFormed(kml);
    expect(kml).toContain('Note: a]]]]><![CDATA[>b <script>');
    const desc = kml.match(/<description>([\s\S]*?)<\/description>/)![1];
    const text = desc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    expect(text).toContain('Note: a]]>b <script>');
  });

  it('replaces newlines in a note with <br> in the description', () => {
    const { kml } = buildKml(tripOf([resolved({ note: 'line1\nline2' })]));
    expect(kml).toContain('Note: line1<br>line2');
  });
});

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM and the header, CRLF line endings', () => {
    const csv = buildCsv(tripOf([resolved({ time: '18:00', note: 'patio' })]));
    expect(csv.startsWith('\uFEFFDay,Time,Name,Address,Lat,Lng,Notes,Maps URL\r\n')).toBe(true);
    expect(csv.split('\r\n')[1]).toBe(
      '2026-11-21,18:00,Armature Works,"1910 N Ola Ave, Tampa, FL 33602, USA",27.9605,-82.4626,patio,https://maps.google.com/?cid=123',
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('includes unresolved stops with empty coordinates and a search link', () => {
    const csv = buildCsv(tripOf([stop({ dayNumber: 2, date: undefined, address: '1 Main St' })]));
    expect(csv.split('\r\n')[1]).toBe(
      'Day 2,,Armature Works,1 Main St,,,,https://www.google.com/maps/search/?api=1&query=Armature%20Works%2C%201%20Main%20St',
    );
  });

  it('quotes commas, quotes and newlines per RFC 4180', () => {
    const csv = buildCsv(tripOf([stop({ name: 'Say "hi", ok', note: 'a\nb' })]));
    const row = csv.slice(csv.indexOf('\r\n') + 2);
    expect(row).toContain('"Say ""hi"", ok"');
    expect(row).toContain('"a\nb"');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('guards a text cell starting with %j against formula injection', (ch) => {
    const csv = buildCsv(tripOf([stop({ name: `${ch}cmd|' /C calc'!A0` })]));
    const row = csv.split('\r\n').slice(1).join('\r\n');
    expect(row).toMatch(/^2026-11-21,,"?'/);
  });

  it('does not prefix negative coordinates (numbers, not text)', () => {
    const csv = buildCsv(tripOf([resolved()]));
    expect(csv).toContain(',27.9605,-82.4626,');
    expect(csv).not.toContain("'-82");
  });
});
