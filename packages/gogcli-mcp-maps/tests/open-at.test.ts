import { describe, it, expect } from 'vitest';
import { evaluateOpenAt, parseLocalDateTime } from '../src/open-at.js';
import type { PlacesPlace } from '../src/places-client.js';

const p = (day: number, hour: number, minute = 0) => ({ day, hour, minute });

// Mon–Sat 11:00–22:00, closed Sunday. 2026-11-21 is a Saturday, 11-22 a Sunday.
const WEEKDAYS: PlacesPlace = {
  id: 'ChIJ_weekdays',
  displayName: { text: 'Armature Works' },
  businessStatus: 'OPERATIONAL',
  regularOpeningHours: {
    periods: [1, 2, 3, 4, 5, 6].map((d) => ({ open: p(d, 11), close: p(d, 22) })),
  },
};

// Fri and Sat 18:00 → 02:00 the next morning.
const NIGHT: PlacesPlace = {
  id: 'ChIJ_night',
  displayName: { text: 'Late Bar' },
  regularOpeningHours: {
    periods: [
      { open: p(5, 18), close: p(6, 2) },
      { open: p(6, 18), close: p(0, 2) },
    ],
  },
};

const ALWAYS: PlacesPlace = {
  id: 'ChIJ_always',
  displayName: { text: 'Riverwalk' },
  regularOpeningHours: { periods: [{ open: p(0, 0) }] },
};

describe('parseLocalDateTime', () => {
  it('accepts an ISO local datetime, with or without seconds', () => {
    expect(parseLocalDateTime('2026-11-21T19:30')).toEqual({ date: '2026-11-21', time: '19:30' });
    expect(parseLocalDateTime('2026-11-21T19:30:45')).toEqual({ date: '2026-11-21', time: '19:30' });
  });

  it('accepts a {date, time} pair', () => {
    expect(parseLocalDateTime({ date: '2026-11-21', time: '9:05' })).toEqual({ date: '2026-11-21', time: '09:05' });
  });

  it('refuses offsets, impossible dates and impossible times', () => {
    expect(() => parseLocalDateTime('2026-11-21T19:30Z')).toThrow(/local/);
    expect(() => parseLocalDateTime('2026-11-21T19:30-05:00')).toThrow(/local/);
    expect(() => parseLocalDateTime({ date: '2026-02-30', time: '10:00' })).toThrow(/date/);
    expect(() => parseLocalDateTime({ date: '21/11/2026', time: '10:00' })).toThrow(/date/);
    expect(() => parseLocalDateTime({ date: '2026-11-21', time: '24:00' })).toThrow(/time/);
    expect(() => parseLocalDateTime({ date: '2026-11-21', time: 'noon' })).toThrow(/time/);
  });
});

describe('evaluateOpenAt', () => {
  it('normal hours: open inside a period, with the closing time', () => {
    expect(evaluateOpenAt(WEEKDAYS, '2026-11-21T19:30')).toEqual({
      at: '2026-11-21T19:30',
      open: true,
      closesAt: '2026-11-21T22:00',
      reason: 'open until 22:00',
    });
  });

  it('normal hours: before opening says when it opens', () => {
    expect(evaluateOpenAt(WEEKDAYS, '2026-11-21T09:00')).toMatchObject({
      open: false,
      opensAt: '2026-11-21T11:00',
      reason: 'closed; opens Sat 2026-11-21 11:00',
    });
  });

  it('the closing minute itself is closed', () => {
    expect(evaluateOpenAt(WEEKDAYS, '2026-11-21T22:00')).toMatchObject({ open: false, opensAt: '2026-11-23T11:00' });
  });

  it('a closed day points at the next opening', () => {
    expect(evaluateOpenAt(WEEKDAYS, { date: '2026-11-22', time: '12:00' })).toMatchObject({
      open: false,
      opensAt: '2026-11-23T11:00',
      reason: 'closed; opens Mon 2026-11-23 11:00',
    });
  });

  it('overnight periods: open after midnight on the next calendar day', () => {
    expect(evaluateOpenAt(NIGHT, '2026-11-22T01:00')).toMatchObject({
      open: true,
      closesAt: '2026-11-22T02:00',
    });
    expect(evaluateOpenAt(NIGHT, '2026-11-21T23:30')).toMatchObject({ open: true, closesAt: '2026-11-22T02:00' });
  });

  it('overnight period wrapping Saturday → Sunday across the week boundary', () => {
    // Sunday 00:30 is inside the Sat 18:00 → Sun 02:00 period.
    expect(evaluateOpenAt(NIGHT, '2026-11-22T00:30')).toMatchObject({ open: true });
    // Sunday 03:00 is closed until Friday.
    expect(evaluateOpenAt(NIGHT, '2026-11-22T03:00')).toMatchObject({ open: false, opensAt: '2026-11-27T18:00' });
  });

  it('a period that runs the whole week with a close equal to its open is open', () => {
    const week: PlacesPlace = { id: 'x', regularOpeningHours: { periods: [{ open: p(1, 0), close: p(1, 0) }] } };
    expect(evaluateOpenAt(week, '2026-11-25T12:00')).toMatchObject({ open: true });
  });

  it('24-hour places (single period with no close) are always open', () => {
    expect(evaluateOpenAt(ALWAYS, '2026-11-22T03:00')).toEqual({
      at: '2026-11-22T03:00',
      open: true,
      reason: 'open 24 hours',
    });
  });

  it('missing hours → unknown', () => {
    expect(evaluateOpenAt({ id: 'x' }, '2026-11-22T03:00')).toEqual({
      at: '2026-11-22T03:00',
      open: 'unknown',
      reason: 'no opening hours on record for this place',
    });
    expect(evaluateOpenAt({ id: 'x', regularOpeningHours: { periods: [] } }, '2026-11-22T03:00').open).toBe('unknown');
  });

  it('a closed business is closed whatever its hours say', () => {
    expect(evaluateOpenAt({ ...WEEKDAYS, businessStatus: 'CLOSED_PERMANENTLY' }, '2026-11-21T19:30')).toEqual({
      at: '2026-11-21T19:30',
      open: false,
      reason: 'closed permanently',
    });
    expect(evaluateOpenAt({ ...ALWAYS, businessStatus: 'CLOSED_TEMPORARILY' }, '2026-11-21T19:30')).toMatchObject({
      open: false,
      reason: 'closed temporarily',
    });
  });
});
