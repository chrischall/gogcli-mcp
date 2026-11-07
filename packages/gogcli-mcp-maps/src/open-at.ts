/**
 * "Is this place open at <local date + time>?", answered from the place's
 * regularOpeningHours.periods. Everything is in the PLACE's local time: Google
 * states periods as local day/hour/minute, and the caller states the planned
 * visit the same way, so no zone arithmetic is needed (and none is attempted —
 * an offset in the input is refused rather than silently reinterpreted).
 *
 * Handled: periods that cross midnight (close on the next day), a period that
 * wraps Saturday → Sunday across the week boundary, 24-hour places (a period
 * with no close), missing hours (→ "unknown"), and CLOSED_* businesses (closed
 * whatever their hours say). Special-day exceptions live only in
 * currentOpeningHours for the next 7 days and are not consulted here.
 */
import type { PlacesPlace } from './places-client.js';

export type AtInput = string | { date: string; time: string };

export interface LocalDateTime {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
}

export interface OpenAt {
  at: string;
  open: boolean | 'unknown';
  opensAt?: string;
  closesAt?: string;
  reason: string;
}

const WEEK_MIN = 7 * 24 * 60;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

function checkDate(date: string): [number, number, number] {
  const m = DATE.exec(date);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d) return [y, mo, d];
  }
  throw new RangeError(`Not a valid date (YYYY-MM-DD): ${JSON.stringify(date)}`);
}

function checkTime(time: string): string {
  const m = TIME.exec(time);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
  throw new RangeError(`Not a valid time (HH:MM, 24-hour): ${JSON.stringify(time)}`);
}

/** Parse `2026-11-21T19:30` or `{date, time}` as a local date and time at the place. */
export function parseLocalDateTime(at: AtInput): LocalDateTime {
  let date: string;
  let time: string;
  if (typeof at === 'string') {
    const m = ISO_LOCAL.exec(at.trim());
    if (!m) {
      throw new RangeError(
        `"at" must be a local date and time at the place, like 2026-11-21T19:30 (no Z or offset): ${JSON.stringify(at)}`,
      );
    }
    [date, time] = [m[1], m[2]];
  } else {
    ({ date, time } = at);
  }
  checkDate(date);
  return { date, time: checkTime(time) };
}

/** Local date+time `delta` minutes after `base`, as YYYY-MM-DDTHH:MM, plus its weekday name. */
function shift(base: LocalDateTime, delta: number): { iso: string; day: string } {
  const [y, mo, d] = checkDate(base.date);
  const [h, mi] = base.time.split(':').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + delta * 60_000);
  return { iso: t.toISOString().slice(0, 16), day: DAY_NAMES[t.getUTCDay()] };
}

export function evaluateOpenAt(place: PlacesPlace, at: AtInput): OpenAt {
  const local = parseLocalDateTime(at);
  const label = `${local.date}T${local.time}`;
  if (place.businessStatus === 'CLOSED_PERMANENTLY' || place.businessStatus === 'CLOSED_TEMPORARILY') {
    return { at: label, open: false, reason: place.businessStatus === 'CLOSED_PERMANENTLY' ? 'closed permanently' : 'closed temporarily' };
  }
  const periods = place.regularOpeningHours?.periods ?? [];
  if (periods.length === 0) return { at: label, open: 'unknown', reason: 'no opening hours on record for this place' };
  if (periods.some((p) => p.close === undefined)) return { at: label, open: true, reason: 'open 24 hours' };

  const [y, mo, d] = checkDate(local.date);
  const [h, mi] = local.time.split(':').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d)).getUTCDay() * 1440 + h * 60 + mi;
  const minuteOfWeek = (p: { day: number; hour: number; minute: number }): number => p.day * 1440 + p.hour * 60 + p.minute;

  let nextOpen = Infinity;
  for (const period of periods) {
    const start = minuteOfWeek(period.open);
    let end = minuteOfWeek(period.close!);
    if (end <= start) end += WEEK_MIN;
    for (const candidate of [t, t + WEEK_MIN]) {
      if (candidate >= start && candidate < end) {
        const closes = shift(local, end - candidate);
        return { at: label, open: true, closesAt: closes.iso, reason: `open until ${closes.iso.slice(11)}` };
      }
    }
    nextOpen = Math.min(nextOpen, (((start - t) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN);
  }
  const opens = shift(local, nextOpen);
  return { at: label, open: false, opensAt: opens.iso, reason: `closed; opens ${opens.day} ${opens.iso.replace('T', ' ')}` };
}
