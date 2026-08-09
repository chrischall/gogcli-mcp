import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  DEFAULT_DISPLAY_TZ,
  displayTimeZone,
  formatInstant,
  isNaiveTimestamp,
  naiveSourceTimeZone,
  normalizeTimestamps,
  parseTimestampValue,
} from '../src/timestamps.js';

const ET = 'America/New_York';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('displayTimeZone', () => {
  it('defaults to this deployment’s zone', () => {
    expect(displayTimeZone()).toBe(DEFAULT_DISPLAY_TZ);
  });

  it('honours DISPLAY_TZ', () => {
    vi.stubEnv('DISPLAY_TZ', 'America/Los_Angeles');
    expect(displayTimeZone()).toBe('America/Los_Angeles');
  });

  it('falls back when DISPLAY_TZ is not a real IANA zone', () => {
    vi.stubEnv('DISPLAY_TZ', 'Mars/Olympus_Mons');
    expect(displayTimeZone()).toBe(DEFAULT_DISPLAY_TZ);
  });
});

describe('formatInstant', () => {
  // DST correctness comes from the IANA database, not a fixed offset: the same
  // zone is -05:00 in January and -04:00 in July.
  it('renders -05:00 in January and -04:00 in July', () => {
    const jan = formatInstant(new Date('2026-01-15T17:00:00Z'), ET);
    const jul = formatInstant(new Date('2026-07-15T17:00:00Z'), ET);
    expect(jan.iso).toBe('2026-01-15T12:00:00-05:00');
    expect(jul.iso).toBe('2026-07-15T13:00:00-04:00');
  });

  it('renders a positive offset east of UTC and +00:00 at UTC', () => {
    expect(formatInstant(new Date('2026-07-15T17:00:00Z'), 'Asia/Tokyo').iso)
      .toBe('2026-07-16T02:00:00+09:00');
    expect(formatInstant(new Date('2026-07-15T17:00:00Z'), 'UTC').iso)
      .toBe('2026-07-15T17:00:00+00:00');
  });

  it('pins midnight to hour 00 rather than 24', () => {
    expect(formatInstant(new Date('2026-07-15T04:00:00Z'), ET).iso)
      .toBe('2026-07-15T00:00:00-04:00');
  });

  it('handles a zone at a half-hour offset', () => {
    expect(formatInstant(new Date('2026-07-15T00:00:00Z'), 'Asia/Kolkata').iso)
      .toBe('2026-07-15T05:30:00+05:30');
  });

  it('includes the weekday, which is what makes a date-boundary error visible', () => {
    const { display } = formatInstant(new Date('2026-07-28T03:36:00Z'), ET);
    expect(display).toContain('Mon');
    expect(display).toContain('Jul 27');
    expect(display).toContain('11:36 PM');
  });
});

describe('parseTimestampValue', () => {
  it('treats Gmail internalDate as authoritative epoch milliseconds', () => {
    const instant = parseTimestampValue('internalDate', '1785296160000', ET);
    expect(instant?.toISOString()).toBe(new Date(1785296160000).toISOString());
  });

  it('interprets a naive wall-clock value in the configured zone', () => {
    const instant = parseTimestampValue('date', '2026-07-27 23:36', ET);
    expect(instant?.toISOString()).toBe('2026-07-28T03:36:00.000Z');
  });

  it('trusts an offset the source already carries', () => {
    const instant = parseTimestampValue('sentAt', '2026-07-27T23:31:09-04:00', ET);
    expect(instant?.toISOString()).toBe('2026-07-28T03:31:09.000Z');
  });

  // A bare date is a DATE (Calendar all-day events use it); converting one
  // would invent a time the source never asserted.
  it('leaves a date-only value alone', () => {
    expect(parseTimestampValue('date', '2026-07-28', ET)).toBeNull();
  });

  it('ignores non-timestamp strings', () => {
    expect(parseTimestampValue('date', 'not a date', ET)).toBeNull();
  });

  it('ignores a non-string value under a timestamp key', () => {
    expect(parseTimestampValue('updated', 1785296160000, ET)).toBeNull();
    expect(parseTimestampValue('updated', null, ET)).toBeNull();
  });

  // Shape-matching but not a real date: month 99 satisfies the regex's \d{2}
  // yet Date rejects it. Must not produce an Invalid Date in the payload.
  it('rejects a well-shaped but impossible date', () => {
    expect(parseTimestampValue('sentAt', '2026-99-01T00:00:00Z', ET)).toBeNull();
  });
});

describe('normalizeTimestamps', () => {
  // The reported failure: a 11:36 PM Eastern send read as 03:36 the NEXT day.
  it('reports a late-evening send on the correct calendar day', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ messages: [{ id: 'm1', date: '2026-07-28 03:36' }] }),
      'UTC',
    ));
    // Source rendered in UTC; re-read in ET it must land on Jul 27.
    const et = JSON.parse(normalizeTimestamps(
      JSON.stringify({ messages: [{ id: 'm1', internalDate: String(Date.parse('2026-07-28T03:36:00Z')) }] }),
      ET,
    ));
    expect(out.messages[0].date).toMatch(/[+-]\d{2}:\d{2}$|Z$/);
    expect(et.messages[0].internalDate).toBe('2026-07-27T23:36:00-04:00');
    expect(et.messages[0].internalDateDisplay).toContain('Mon, Jul 27');
  });

  it('never reports a 10:38 PM ET send on the following day', () => {
    const sent = Date.parse('2026-07-28T02:38:00Z'); // 10:38 PM ET on Jul 27
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ internalDate: String(sent) }), ET,
    ));
    expect(out.internalDate.startsWith('2026-07-27')).toBe(true);
    expect(out.internalDateDisplay).toContain('Jul 27');
  });

  it('adds an explicit offset and a display sibling to every allowlisted field', () => {
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({
      files: [{ modifiedTime: '2026-07-28T03:36:00Z', createdTime: '2026-07-01T12:00:00Z' }],
    }), ET));
    expect(out.files[0].modifiedTime).toBe('2026-07-27T23:36:00-04:00');
    expect(out.files[0].modifiedTimeDisplay).toContain('Mon, Jul 27');
    expect(out.files[0].createdTimeDisplay).toBeDefined();
  });

  it('recurses into nested Calendar structures', () => {
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({
      items: [{ start: { dateTime: '2026-07-28T03:36:00Z', timeZone: 'America/New_York' } }],
    }), ET));
    expect(out.items[0].start.dateTime).toBe('2026-07-27T23:36:00-04:00');
    expect(out.items[0].start.dateTimeDisplay).toContain('Jul 27');
    // A zone NAME is not an instant and must survive untouched.
    expect(out.items[0].start.timeZone).toBe('America/New_York');
  });

  // The near-miss names are the real hazard: a name-pattern match would
  // rewrite spreadsheet cell data.
  it('leaves near-miss keys and cell values alone', () => {
    const payload = {
      updatedCells: 5,
      updatedRange: 'Sheet1!A1:B2',
      updatedRows: 2,
      formattedValue: '2026-07-28 03:36',
      verificationStatus: 'accepted',
      values: [['2026-07-28 03:36']],
    };
    const out = JSON.parse(normalizeTimestamps(JSON.stringify(payload), ET));
    expect(out).toEqual(payload);
  });

  it('passes non-JSON output through untouched', () => {
    expect(normalizeTimestamps('Error: something failed', ET)).toBe('Error: something failed');
    expect(normalizeTimestamps('', ET)).toBe('');
    expect(normalizeTimestamps('not json {', ET)).toBe('not json {');
    expect(normalizeTimestamps('"a string"', ET)).toBe('"a string"');
    expect(normalizeTimestamps('{bad json', ET)).toBe('{bad json');
  });

  it('is idempotent — re-normalizing changes nothing', () => {
    const once = normalizeTimestamps(JSON.stringify({ date: '2026-07-27 23:36' }), ET);
    expect(normalizeTimestamps(once, ET)).toBe(once);
  });

  // Contract test: nothing emitted may lack an offset or Z.
  it('emits no naive timestamp anywhere in the payload', () => {
    const out = normalizeTimestamps(JSON.stringify({
      a: { date: '2026-07-28 03:36' },
      b: [{ sentAt: '2026-07-27T23:31:09' }],
      c: { fetchedBodyAt: '2026-07-28T12:11:19.106Z' },
    }), ET);
    const parsed = JSON.parse(out);
    const naive: string[] = [];
    const scan = (n: unknown): void => {
      if (Array.isArray(n)) return void n.forEach(scan);
      if (n && typeof n === 'object') return void Object.values(n).forEach(scan);
      if (isNaiveTimestamp(n)) naive.push(String(n));
    };
    scan(parsed);
    expect(naive).toEqual([]);
  });

  // Mixed-zone assertion: one object must not carry both naive and
  // offset-bearing values.
  it('never mixes naive and offset-bearing timestamps in one object', () => {
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({
      sentAt: '2026-07-27T23:31:09',
      fetchedBodyAt: '2026-07-28T12:11:19.106Z',
      asOf: '2026-07-28T20:27:11.426Z',
    }), ET));
    const values = [out.sentAt, out.fetchedBodyAt, out.asOf];
    expect(values.every((v: string) => /([+-]\d{2}:\d{2}|Z)$/.test(v))).toBe(true);
    expect(values.some(isNaiveTimestamp)).toBe(false);
  });

  it('keeps contemporaneous events in order and on the same day', () => {
    const base = Date.parse('2026-07-28T03:31:09Z');
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({
      ofw: { sentAt: '2026-07-27T23:31:09' },
      gmail: { internalDate: String(base + 5 * 60_000) },
    }), ET));
    expect(out.ofw.sentAt).toBe('2026-07-27T23:31:09-04:00');
    expect(out.gmail.internalDate).toBe('2026-07-27T23:36:09-04:00');
    expect(out.ofw.sentAtDisplay).toContain('Jul 27');
    expect(out.gmail.internalDateDisplay).toContain('Jul 27');
  });

  it('DISPLAY_TZ shifts display fields and the offset, nothing else', () => {
    const payload = JSON.stringify({ id: 'm1', subject: 'S', internalDate: '1785296160000' });
    const et = JSON.parse(normalizeTimestamps(payload, ET));
    const pt = JSON.parse(normalizeTimestamps(payload, 'America/Los_Angeles'));
    expect(et.internalDate).not.toBe(pt.internalDate);
    expect(et.internalDateDisplay).not.toBe(pt.internalDateDisplay);
    // Same instant either way.
    expect(Date.parse(et.internalDate)).toBe(Date.parse(pt.internalDate));
    // Non-timestamp fields are untouched by the zone.
    expect(pt.id).toBe('m1');
    expect(pt.subject).toBe('S');
  });

  // In UTC, longOffset renders a bare "GMT" with no numeric part, and a naive
  // wall time needs no correction at all.
  it('renders UTC as +00:00 with no drift correction', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ date: '2026-07-28 03:36' }), 'UTC', 'UTC',
    ));
    expect(out.date).toBe('2026-07-28T03:36:00+00:00');
    expect(out.dateDisplay).toContain('Jul 28');
  });

  it('preserves sub-second precision on a naive value', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ fetchedBodyAt: '2026-07-28T12:11:19.106' }), 'UTC', 'UTC',
    ));
    expect(out.fetchedBodyAt).toBe('2026-07-28T12:11:19.106+00:00');
  });

  it('normalizes a top-level array', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify([{ internalDate: '1785296160000' }]), ET,
    ));
    expect(out[0].internalDate).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('leaves an allowlisted key alone when its value is not a timestamp', () => {
    const payload = { date: 'sometime last week', updated: '' };
    const out = JSON.parse(normalizeTimestamps(JSON.stringify(payload), ET));
    expect(out).toEqual(payload);
  });

  // Re-serializing a response that carries no timestamps would silently reflow
  // it — including flattening a caller's --pretty formatting.
  it('returns the original text byte-for-byte when nothing was rewritten', () => {
    const pretty = '{\n  "id": "m1",\n  "subject": "S"\n}';
    expect(normalizeTimestamps(pretty, ET)).toBe(pretty);
  });

  it('preserves the caller’s pretty indentation when it does rewrite', () => {
    const pretty = '{\n  "id": "m1",\n  "date": "2026-07-27 23:36"\n}';
    const out = normalizeTimestamps(pretty, ET);
    expect(out).toContain('\n  "date"');
    expect(JSON.parse(out).date).toBe('2026-07-27T23:36:00-04:00');
  });

  // Date.UTC rolls impossible components over instead of rejecting them, so a
  // typo would surface as a confident wrong date.
  it('rejects impossible naive dates rather than rolling them over', () => {
    for (const bad of ['2026-13-05T10:00:00', '2026-02-30T10:00:00', '2026-01-01T25:00:00']) {
      expect(parseTimestampValue('date', bad, ET)).toBeNull();
    }
  });

  // 10 digits is epoch SECONDS; reading it as milliseconds dates it to 1970.
  it('only treats a 13-digit internalDate as epoch milliseconds', () => {
    expect(parseTimestampValue('internalDate', '1785209760', ET)).toBeNull();
    expect(parseTimestampValue('internalDate', '1785209760000', ET)).not.toBeNull();
  });

  it('reads the naive-source zone from GOG_TIMEZONE, independent of DISPLAY_TZ', () => {
    vi.stubEnv('GOG_TIMEZONE', 'UTC');
    vi.stubEnv('DISPLAY_TZ', 'America/New_York');
    // gog formatted this in UTC; it must be read as UTC and displayed in ET.
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({ date: '2026-07-28 03:36' })));
    expect(out.date).toBe('2026-07-27T23:36:00-04:00');
    expect(out.dateDisplay).toContain('Jul 27');
  });

  it('naiveSourceTimeZone falls back to the display zone', () => {
    vi.stubEnv('DISPLAY_TZ', 'America/Los_Angeles');
    expect(naiveSourceTimeZone()).toBe('America/Los_Angeles');
    vi.stubEnv('GOG_TIMEZONE', 'Mars/Olympus_Mons');
    expect(naiveSourceTimeZone()).toBe('America/Los_Angeles');
  });

  it('handles a DST spring-forward wall time without drifting a day', () => {
    // 2026-03-08 02:30 ET does not exist (clocks jump 02:00 -> 03:00).
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ date: '2026-03-08 02:30' }), ET,
    ));
    expect(out.date.startsWith('2026-03-08')).toBe(true);
    expect(out.date).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});

// gog 0.35.0 (#946) adds `internalDateIso` to Gmail message AND thread
// listings: Gmail's own internalDate rendered RFC3339 with a real offset. It is
// separately sourced from the neighbouring `date` (a naive reconstruction of
// the sender's Date header), so the two can legitimately disagree — but only
// `internalDateIso` carries its own zone, which makes it the field a machine
// consumer should read.
describe('internalDateIso (gog >= 0.35.0 Gmail listings)', () => {
  it('gains a display sibling and survives a DISPLAY_TZ unlike its own offset', () => {
    const payload = JSON.stringify({
      messages: [{ id: 'm1', date: '2026-07-28 03:36', internalDateIso: '2026-07-28T03:36:12-04:00' }],
    });
    const pt = JSON.parse(normalizeTimestamps(payload, 'America/Los_Angeles', 'UTC'));
    const row = pt.messages[0];
    // Re-rendered in the display zone, same instant, offset still explicit.
    expect(row.internalDateIso).toBe('2026-07-28T00:36:12-07:00');
    expect(Date.parse(row.internalDateIso)).toBe(Date.parse('2026-07-28T03:36:12-04:00'));
    expect(row.internalDateIsoDisplay).toContain('Tue, Jul 28');
    expect(isNaiveTimestamp(row.internalDateIso)).toBe(false);
  });

  it('keeps sub-second precision when gog emits milliseconds', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ internalDateIso: '2026-07-28T03:36:12.250-04:00' }), ET,
    ));
    expect(out.internalDateIso).toBe('2026-07-28T03:36:12.250-04:00');
    expect(out.internalDateIsoDisplay).toContain('Tue, Jul 28');
  });

  // The trap: `date` is gog re-formatting the sender header into GOG_TIMEZONE
  // with no offset, so the wrapper has to re-read it in that zone. Only
  // `internalDateIso` is self-describing, and the two are allowed to disagree.
  it('is trusted verbatim while the naive sibling is read in GOG_TIMEZONE', () => {
    const out = JSON.parse(normalizeTimestamps(JSON.stringify({
      date: '2026-07-28 03:36',
      internalDateIso: '2026-07-27T23:36:12-04:00',
    }), ET, 'UTC'));
    expect(out.internalDateIso).toBe('2026-07-27T23:36:12-04:00');
    expect(out.date).toBe('2026-07-27T23:36:00-04:00');
    expect(out.dateDisplay).toContain('Jul 27');
    expect(out.internalDateIsoDisplay).toContain('Jul 27');
  });

  // A thread listing carries the same field (gmail_thread_search_helpers.go).
  it('normalizes the field on thread listings too', () => {
    const out = JSON.parse(normalizeTimestamps(
      JSON.stringify({ threads: [{ id: 't1', internalDateIso: '2026-07-28T03:36:12Z' }] }), ET,
    ));
    expect(out.threads[0].internalDateIso).toBe('2026-07-27T23:36:12-04:00');
    expect(out.threads[0].internalDateIsoDisplay).toContain('Mon, Jul 27');
  });
});
