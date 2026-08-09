// Canonical timestamp handling for every gog response.
//
// gog renders message/thread dates in its configured timezone (GOG_TIMEZONE)
// and emits several shapes: naive wall-clock ("2026-07-28 03:36"), naive ISO,
// RFC3339 with a real offset (straight from a Google API), and epoch
// milliseconds (Gmail's internalDate). Unlabeled values are the dangerous
// ones: a reader assumes local time and is wrong by the UTC offset, which can
// put an event on the wrong calendar DAY — the failure that actually matters
// when reasoning about response windows and day boundaries.
//
// Every value that survives detection is rewritten to ISO-8601 WITH an
// explicit offset and paired with a `<key>Display` sibling rendered in the
// operator's zone, weekday included, because a wrong weekday is what makes a
// date-boundary error visible at a glance.

import { readEnvVar } from '@chrischall/mcp-utils';

// Fallback display zone for this deployment. IANA name, never a fixed offset —
// a hardcoded -04:00 would be an hour wrong from November through March.
export const DEFAULT_DISPLAY_TZ = 'America/New_York';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The zone all *Display fields render in, and the zone a NAIVE source value is
// assumed to be wall-clock in. Keep GOG_TIMEZONE on the gog side in sync with
// this: gog formats naive values in its own zone, and we re-attach the offset
// using ours. An invalid DISPLAY_TZ falls back rather than throwing, so a typo
// degrades the label instead of breaking every tool.
export function displayTimeZone(): string {
  const configured = readEnvVar('DISPLAY_TZ');
  if (configured && isValidTimeZone(configured)) return configured;
  return DEFAULT_DISPLAY_TZ;
}

// The zone a NAIVE source value is wall-clock in — which is whatever zone gog
// formatted it in, i.e. GOG_TIMEZONE. Reading it directly rather than assuming
// it equals DISPLAY_TZ removes an invisible "keep these two in sync"
// requirement: if they ever diverged, every naive value would silently gain the
// wrong offset and nothing would surface it. Falls back to the display zone,
// which is the correct guess when gog is running with the same configuration.
export function naiveSourceTimeZone(): string {
  const configured = readEnvVar('GOG_TIMEZONE');
  if (configured && isValidTimeZone(configured)) return configured;
  return displayTimeZone();
}

// Offset of `tz` at a given instant, as "+HH:MM"/"-HH:MM". Uses the IANA
// database via Intl, so DST is handled per-instant rather than per-zone.
function offsetAt(instant: Date, tz: string): string {
  // Derived arithmetically rather than parsed out of Intl's "GMT-04:00" label:
  // the gap between the zone's wall clock and the instant IS the offset, and
  // zone offsets are always whole minutes.
  const w = wallPartsIn(instant, tz);
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, instant.getUTCMilliseconds());
  const minutes = Math.round((asUTC - instant.getTime()) / 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Wall-clock fields of `instant` as seen in `tz`, via Intl so the IANA rules
// (including DST) apply.
function wallPartsIn(instant: Date, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 pins midnight to hour 00; without it some ICU builds render hour 24.
    hourCycle: 'h23',
  }).formatToParts(instant);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// Interpret naive wall-clock fields as an instant in `tz`. There is no direct
// inverse of the zone rules, so guess UTC, measure how far the guess lands from
// the requested wall time in that zone, and correct. Two passes settle the case
// where the correction itself crosses a DST boundary.
function wallTimeToInstant(
  y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, tz: string,
): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  for (let i = 0; i < 2; i += 1) {
    const seen = wallPartsIn(new Date(guess), tz);
    const seenUTC = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second, ms);
    const drift = Date.UTC(y, mo - 1, d, h, mi, s, ms) - seenUTC;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
}

export interface CanonicalTimestamp {
  /** ISO-8601 with an explicit offset, e.g. 2026-07-27T23:31:09-04:00. */
  iso: string;
  /** Human rendering in the display zone, weekday first. */
  display: string;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

// Render `instant` as ISO-8601 carrying `offset`'s wall time and label.
function isoWithOffset(instant: Date, tz: string, offset: string): string {
  const w = wallPartsIn(instant, tz);
  const msPart = instant.getUTCMilliseconds();
  const frac = msPart ? `.${pad(msPart, 3)}` : '';
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${frac}${offset}`;
}

// The one place an instant becomes user-visible text. Every emitted timestamp
// goes through here, so no call site can reintroduce a naive value.
export function formatInstant(instant: Date, tz = displayTimeZone()): CanonicalTimestamp {
  const offset = offsetAt(instant, tz);
  const display = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
  return { iso: isoWithOffset(instant, tz, offset), display };
}

// Keys whose STRING values are timestamps in gog/Google payloads. Deliberately
// an allowlist: near-miss names abound (updatedCells, updatedRange, updatedRows,
// formattedValue, verificationStatus) and a name-pattern match would rewrite
// spreadsheet cell data. A value must ALSO match a timestamp shape below, so
// both the key and the value have to agree before anything is touched.
const TIMESTAMP_KEYS = new Set([
  'date',              // gog gmail message/thread listings ("2026-07-28 03:36")
  'dateTime',          // Calendar event start/end
  'internalDate',      // Gmail, epoch milliseconds (authoritative)
  'modifiedTime',      // Drive
  'createdTime',       // Drive
  'createTime',
  'updateTime',
  'updated',
  'originalStartTime',
  'expirationTime',
  'lastModified',
  'sentAt',
  'viewedAt',
  'modifiedAt',
  'fetchedBodyAt',
  'asOf',
]);

// Keys that hold a zone NAME rather than an instant. They cannot match a
// timestamp shape anyway, but naming them documents the hazard.
const ZONE_NAME_KEYS = new Set(['timeZone', 'timezone']);

const RFC3339_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;
const NAIVE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/;
// Exactly 13 digits: milliseconds. A 10-digit run is epoch SECONDS, and
// reading one as milliseconds dates it to 1970.
const EPOCH_MILLIS = /^\d{13}$/;

// A bare YYYY-MM-DD is a DATE, not an instant — Calendar uses it for all-day
// events. Converting one would invent a time that the source never asserted.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// True when the components describe a real calendar instant. Guards against
// Date.UTC's silent rollover of out-of-range values.
function isRealCalendarDate(p: {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}): boolean {
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  return utc.getUTCFullYear() === p.year
    && utc.getUTCMonth() === p.month - 1
    && utc.getUTCDate() === p.day
    && utc.getUTCHours() === p.hour
    && utc.getUTCMinutes() === p.minute
    && utc.getUTCSeconds() === p.second;
}

// Resolve a raw field value to an instant, or null when it is not a timestamp.
// `assumeNaiveIn` is the zone a naive (offset-less) value is wall-clock in.
export function parseTimestampValue(
  key: string,
  value: unknown,
  assumeNaiveIn: string,
): Date | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '' || DATE_ONLY.test(raw)) return null;

  // EPOCH_MILLIS is a bounded digit run, so Number() is always finite here.
  if (key === 'internalDate' && EPOCH_MILLIS.test(raw)) {
    return new Date(Number(raw));
  }

  if (RFC3339_WITH_OFFSET.test(raw)) {
    // The source already knows its offset; trust it verbatim.
    const parsed = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const naive = NAIVE_DATE_TIME.exec(raw);
  if (naive) {
    const [, y, mo, d, h, mi, s, frac] = naive;
    const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
    const parts = {
      year: Number(y), month: Number(mo), day: Number(d),
      hour: Number(h), minute: Number(mi), second: Number(s ?? '0'),
    };
    // Date.UTC silently rolls impossible components over — month 99 becomes
    // 2034, Feb 30 becomes Mar 2 — so a typo would surface as a confident wrong
    // date rather than a rejection. The RFC3339 branch above already returns
    // null for the same input; match it.
    //
    // Checked in UTC space, deliberately: validating against the ZONE's wall
    // clock would also reject a non-existent spring-forward time like
    // 2026-03-08 02:30 ET, and shifting such a value forward (as zone libraries
    // do) is better than dropping a timestamp we can place to within an hour.
    if (!isRealCalendarDate(parts)) return null;
    return wallTimeToInstant(
      parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, ms, assumeNaiveIn,
    );
  }
  return null;
}

// True when a string carries no zone information — the shape this whole module
// exists to eliminate. Used by the contract test.
export function isNaiveTimestamp(value: unknown): boolean {
  return typeof value === 'string' && NAIVE_DATE_TIME.test(value.trim());
}

// Walk a parsed gog payload, rewriting every allowlisted timestamp to canonical
// form and attaching its display sibling. Mutates and returns `node`.
function walk(node: unknown, tz: string, naiveTz: string): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (walk(item, tz, naiveTz)) changed = true;
    }
    return changed;
  }
  if (node === null || typeof node !== 'object') return false;

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== null && typeof value === 'object') {
      if (walk(value, tz, naiveTz)) changed = true;
      continue;
    }
    if (ZONE_NAME_KEYS.has(key) || !TIMESTAMP_KEYS.has(key)) continue;
    const instant = parseTimestampValue(key, value, naiveTz);
    if (!instant) continue;
    const { iso, display } = formatInstant(instant, tz);
    obj[key] = iso;
    obj[`${key}Display`] = display;
    changed = true;
  }
  return changed;
}

// gog's --pretty emits indented JSON. Re-serializing compactly would silently
// undo a formatting choice the caller explicitly asked for, so mirror whatever
// indentation the original used.
function detectIndent(text: string): number {
  const match = /\n(\s+)\S/.exec(text);
  return match ? match[1].replace(/\t/g, '  ').length : 0;
}

// Normalize every timestamp in a gog JSON response. Non-JSON output (plain-text
// errors, `--plain` results) passes through untouched, as does JSON that is not
// an object/array, so this can sit on the single response seam safely.
export function normalizeTimestamps(
  text: string,
  tz = displayTimeZone(),
  naiveTz = naiveSourceTimeZone(),
): string {
  const trimmed = text.trim();
  if (trimmed === '' || !/^[[{]/.test(trimmed)) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }
  // The `[`/`{` guard above means anything that parses here is an object or an
  // array, so `walk` always has something to descend into.
  //
  // When nothing was rewritten, return the ORIGINAL text byte-for-byte rather
  // than a re-serialization. Round-tripping through JSON.parse/stringify is not
  // lossless — it drops the caller's --pretty formatting and reorders nothing
  // but reformats everything — and there is no reason to pay that on a response
  // that carries no timestamps at all.
  if (!walk(parsed, tz, naiveTz)) return text;
  return JSON.stringify(parsed, null, detectIndent(text));
}
