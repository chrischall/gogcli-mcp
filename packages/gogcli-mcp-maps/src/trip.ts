/**
 * Trip builders — pure functions, no I/O. They turn a list of stops (already
 * resolved to places by the caller, or not) into what the owner asked for:
 * POINTS ON A MAP, not a route. So there is no `/maps/dir/` URL, no waypoint
 * splitting and no travel mode anywhere here — each stop is a pin.
 *
 * - `normalizeStops` validates and orders the caller's stops (day, then time).
 * - `pinUrl` is one stop's Google Maps link (≤ 2,048 chars, the URL limit).
 * - `buildKml` is a KML 2.2 document for My Maps import (My Maps has no API).
 * - `buildCsv` is the same stops as an RFC 4180 spreadsheet.
 */

export class TripInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripInputError';
  }
}

/** A stop as the caller gives it. */
export interface TripStopInput {
  /** An ISO date (YYYY-MM-DD) or a day number from 1 (mapped to a date by start_date). */
  day: string | number;
  /** Local 24-hour time, H:MM or HH:MM. */
  time?: string;
  name: string;
  address?: string;
  place_id?: string;
  note?: string;
  category?: string;
}

/** A validated stop: numbered day, date when knowable, HH:MM time. */
export interface TripStop {
  /** Position in the caller's list (stable sort tie-break). */
  index: number;
  dayNumber: number;
  /** YYYY-MM-DD; absent when days are numbers and there is no start_date. */
  date?: string;
  time?: string;
  name: string;
  address?: string;
  placeId?: string;
  note?: string;
  /** Lower-cased. */
  category?: string;
}

/** What the trip builders need of a resolved place. */
export interface TripPlace {
  placeId?: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  phone?: string;
}

export interface TripMapStop extends TripStop {
  place?: TripPlace;
}

export interface Trip {
  title: string;
  /** In display order (as `normalizeStops` returns them). */
  stops: TripMapStop[];
}

const NO_START_DATE_NOTE =
  'No start_date: days are numbered, not dated (give start_date to put them on the calendar).';

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch days of a real calendar date, or undefined. */
function parseIsoDate(text: string): number | undefined {
  const m = ISO_DATE.exec(text);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  return ms / DAY_MS;
}

function isoFromEpochDays(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

function clean(text: string | undefined): string | undefined {
  const t = text?.trim();
  return t ? t : undefined;
}

function parseTime(time: string, where: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new TripInputError(`${where}: time "${time}" must be 24-hour H:MM or HH:MM`);
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

type ParsedDay = { kind: 'number'; n: number } | { kind: 'date'; days: number; iso: string };

function parseDay(day: string | number, where: string): ParsedDay {
  const bad = () =>
    new TripInputError(
      `${where}: day ${typeof day === 'number' ? day : JSON.stringify(day)} must be a date (YYYY-MM-DD) or a day number from 1`,
    );
  if (typeof day === 'number') {
    if (!Number.isInteger(day) || day < 1) throw bad();
    return { kind: 'number', n: day };
  }
  const text = day.trim();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n < 1) throw bad();
    return { kind: 'number', n };
  }
  const days = parseIsoDate(text);
  if (days === undefined) throw bad();
  return { kind: 'date', days, iso: text };
}

/**
 * Validate the stops and put them in display order: by day, then by time,
 * with a day's untimed stops after its timed ones; ties keep the caller's
 * order. Numbered days get dates from `startDate`; without it they stay
 * numbered and a note says so. Dated days are
 * numbered from `startDate`, or from the earliest date when there is none.
 */
export function normalizeStops(
  input: TripStopInput[],
  startDate?: string,
): { stops: TripStop[]; notes: string[] } {
  if (input.length === 0) throw new TripInputError('A trip needs at least one stop.');
  let start: number | undefined;
  if (startDate !== undefined) {
    start = parseIsoDate(startDate.trim());
    if (start === undefined) throw new TripInputError(`start_date "${startDate}" is not a valid YYYY-MM-DD date`);
  }
  const days = input.map((s, i) => parseDay(s.day, `stop ${i + 1}`));
  const hasNumbers = days.some((d) => d.kind === 'number');
  const dated = days.filter((d): d is Extract<ParsedDay, { kind: 'date' }> => d.kind === 'date');
  if (start === undefined && hasNumbers && dated.length > 0) {
    throw new TripInputError(
      'The stop list mixes day numbers and dates; give start_date so both can be placed on the same calendar, or use one form.',
    );
  }
  const anchor = start ?? (dated.length ? Math.min(...dated.map((d) => d.days)) : undefined);

  const stops = input.map((s, index): TripStop => {
    const where = `stop ${index + 1}`;
    const name = clean(s.name);
    if (!name) throw new TripInputError(`${where}: name is required`);
    const day = days[index];
    let dayNumber: number;
    let date: string | undefined;
    if (day.kind === 'number') {
      dayNumber = day.n;
      date = anchor === undefined ? undefined : isoFromEpochDays(anchor + day.n - 1);
    } else {
      dayNumber = day.days - (anchor as number) + 1;
      if (dayNumber < 1) throw new TripInputError(`${where}: day ${day.iso} is before start_date ${startDate}`);
      date = day.iso;
    }
    const stop: TripStop = { index, dayNumber, name };
    if (date) stop.date = date;
    if (s.time !== undefined) stop.time = parseTime(s.time, where);
    const address = clean(s.address);
    if (address) stop.address = address;
    const placeId = clean(s.place_id);
    if (placeId) stop.placeId = placeId;
    const note = clean(s.note);
    if (note) stop.note = note;
    const category = clean(s.category)?.toLowerCase();
    if (category) stop.category = category;
    return stop;
  });

  stops.sort(
    (a, b) =>
      a.dayNumber - b.dayNumber
      || (a.time ? 0 : 1) - (b.time ? 0 : 1)
      || (a.time ?? '').localeCompare(b.time ?? '')
      || a.index - b.index,
  );
  return { stops, notes: hasNumbers && anchor === undefined ? [NO_START_DATE_NOTE] : [] };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Day 1 — Sat 21 Nov", or "Day 1" when the date is unknown. */
export function dayLabel(dayNumber: number, date?: string): string {
  if (!date) return `Day ${dayNumber}`;
  const d = new Date(`${date}T00:00:00Z`);
  return `Day ${dayNumber} — ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Google Maps URLs are limited to 2,048 characters. */
export const MAPS_URL_MAX = 2048;
const SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';

/** Lone UTF-16 surrogates make encodeURIComponent throw; replace them. */
function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

function stopAddress(stop: TripMapStop): string | undefined {
  return stop.place?.formattedAddress ?? stop.address;
}

/**
 * The stop's pin: the place's own googleMapsUri when known, else a Maps search
 * URL for "name, address" carrying the place id when there is one. A search
 * URL over the limit loses query text from the end (never mid-character, never
 * the place id).
 */
export function pinUrl(stop: TripMapStop): string {
  const uri = stop.place?.googleMapsUri;
  if (uri && uri.length <= MAPS_URL_MAX) return uri;
  const placeId = stop.place?.placeId ?? stop.placeId;
  const suffix = placeId ? `&query_place_id=${encodeURIComponent(wellFormed(placeId))}` : '';
  const room = MAPS_URL_MAX - SEARCH_BASE.length - suffix.length;
  if (room < 0) throw new TripInputError(`stop "${stop.name}": place id is too long for a Maps URL`);
  const address = stopAddress(stop);
  const query = wellFormed(address ? `${stop.name}, ${address}` : stop.name);
  let encoded = '';
  for (const ch of query) {
    const piece = encodeURIComponent(ch);
    if (encoded.length + piece.length > room) break;
    encoded += piece;
  }
  return `${SEARCH_BASE}${encoded}${suffix}`;
}

/** Icon colours in KML's aabbggrr order; every known category is distinct. */
export const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  lodging: 'ffb0279c',
  food: 'ff0080ff',
  drinks: 'ff00c8ff',
  sight: 'ff50af4c',
  activity: 'ff888800',
  event: 'ff3643f4',
  transport: 'fff39621',
  shopping: 'ff8b3d79',
  default: 'ff9e9e9e',
};

const ICON_HREF = 'https://maps.google.com/mapfiles/kml/paddle/wht-blank.png';

function styleKey(category: string | undefined): string {
  return category && category !== 'default' && category in CATEGORY_COLORS ? category : 'default';
}

/** Characters XML 1.0 forbids outright, and lone surrogates. */
function xmlSafe(text: string): string {
  return wellFormed(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

function esc(text: string): string {
  return xmlSafe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** One CDATA section; a literal `]]>` is split across two. */
function cdata(text: string): string {
  return `<![CDATA[${xmlSafe(text).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function isResolved(stop: TripMapStop): boolean {
  return typeof stop.place?.lat === 'number' && typeof stop.place?.lng === 'number';
}

function description(stop: TripMapStop): string {
  const lines: string[] = [];
  if (stop.time) lines.push(`Time: ${stop.time}`);
  if (stop.note) lines.push(`Note: ${stop.note.replace(/\r?\n/g, '<br>')}`);
  const address = stopAddress(stop);
  if (address) lines.push(`Address: ${address}`);
  if (stop.place?.websiteUri) lines.push(`Website: ${stop.place.websiteUri}`);
  if (stop.place?.phone) lines.push(`Phone: ${stop.place.phone}`);
  lines.push(`Google Maps: ${pinUrl(stop)}`);
  return lines.join('<br>');
}

function placemark(stop: TripMapStop): string {
  const data: Array<[string, string | number | undefined]> = [
    ['day', stop.dayNumber],
    ['date', stop.date],
    ['time', stop.time],
    ['category', stop.category],
    ['place_id', stop.place?.placeId ?? stop.placeId],
  ];
  const extended = data
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<Data name="${k}"><value>${esc(String(v))}</value></Data>`)
    .join('');
  const place = stop.place as TripPlace;
  return [
    '      <Placemark>',
    `        <name>${esc(stop.name)}</name>`,
    `        <description>${cdata(description(stop))}</description>`,
    `        <styleUrl>#cat-${styleKey(stop.category)}</styleUrl>`,
    `        <ExtendedData>${extended}</ExtendedData>`,
    `        <Point><coordinates>${place.lng},${place.lat},0</coordinates></Point>`,
    '      </Placemark>',
  ].join('\n');
}

/**
 * A KML 2.2 document: the title as Document name, one shared Style per
 * category in use, one Folder per day, one Placemark per resolved stop.
 * Element order follows the KML 2.2 schema (Feature: name, description,
 * styleUrl, ExtendedData; then the Geometry). Stops without coordinates
 * cannot be pins; they are left out and returned in `omitted`.
 */
export function buildKml(trip: Trip): { kml: string; omitted: TripMapStop[] } {
  const pins = trip.stops.filter(isResolved);
  const omitted = trip.stops.filter((s) => !isResolved(s));

  const styleKeys = [...new Set(pins.map((s) => styleKey(s.category)))];
  const styles = styleKeys.map((key) =>
    [
      `    <Style id="cat-${key}">`,
      '      <IconStyle>',
      `        <color>${CATEGORY_COLORS[key]}</color>`,
      `        <Icon><href>${ICON_HREF}</href></Icon>`,
      '      </IconStyle>',
      '    </Style>',
    ].join('\n'),
  );

  const days = new Map<number, TripMapStop[]>();
  for (const stop of pins) {
    const list = days.get(stop.dayNumber) ?? [];
    list.push(stop);
    days.set(stop.dayNumber, list);
  }
  const folders = [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, stops]) =>
      [
        '    <Folder>',
        `      <name>${esc(dayLabel(dayNumber, stops[0].date))}</name>`,
        ...stops.map(placemark),
        '    </Folder>',
      ].join('\n'),
    );

  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${esc(trip.title)}</name>`,
    ...styles,
    ...folders,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
  return { kml, omitted };
}

export const CSV_HEADER = ['Day', 'Time', 'Name', 'Address', 'Lat', 'Lng', 'Notes', 'Maps URL'];

/** RFC 4180 quoting for any cell; the formula guard for text cells only. */
function csvCell(value: string | number | undefined, text = true): string {
  if (value === undefined) return '';
  let cell = String(value);
  if (text && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * Every stop (resolved or not) as CSV: UTF-8 BOM so spreadsheets read it as
 * UTF-8, CRLF line endings, quoting per RFC 4180, and text cells starting
 * with = + - @ (or tab/CR) prefixed with ' so no spreadsheet runs them as a
 * formula. Coordinates are numbers, so a negative longitude is left alone.
 */
export function buildCsv(trip: Trip): string {
  const rows = trip.stops.map((stop) =>
    [
      csvCell(stop.date ?? `Day ${stop.dayNumber}`),
      csvCell(stop.time),
      csvCell(stop.name),
      csvCell(stopAddress(stop)),
      csvCell(stop.place?.lat, false),
      csvCell(stop.place?.lng, false),
      csvCell(stop.note),
      csvCell(pinUrl(stop)),
    ].join(','),
  );
  return `﻿${[CSV_HEADER.join(','), ...rows].map((r) => `${r}\r\n`).join('')}`;
}
