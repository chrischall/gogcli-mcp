import { describe, it, expect } from 'vitest';
import { readGoogleProbe } from '../src/google-probe.js';

/**
 * REVIEW DEFECT: "the probe could not run" was filed as "Google refused".
 *
 * The runner collapses every non-healthy outcome into `ok:false`, and BOTH
 * connector call sites used to branch on `ok === true` alone. Three of the
 * runner's causes are facts about the probe, not about Google — it timed out, it
 * could not be run (`gog` missing from PATH, `credentials.json` missing from the
 * volume), or its output could not be parsed — and each of those became an
 * error-level `connect.google-unhealthy` / `refusal.google-unhealthy`, whose
 * documented meaning is "Google was asked and refused". An operator grepping
 * event names would close the incident on evidence nobody gathered.
 *
 * The runner now states `measured` explicitly. This module is the ONE place that
 * reads it, precisely because the defect was two call sites making the same
 * judgement separately.
 */
describe('readGoogleProbe', () => {
  it('reads a healthy answer as ok', () => {
    expect(readGoogleProbe({ ok: true, measured: true })).toEqual({ kind: 'ok' });
  });

  it('reads a measured refusal as unhealthy, carrying the runner’s cause', () => {
    expect(readGoogleProbe({ ok: false, measured: true, error: 'invalid_grant: …' })).toEqual({
      kind: 'unhealthy',
      reason: 'invalid_grant: …',
    });
  });

  it('says so plainly when a measured refusal names no cause', () => {
    const verdict = readGoogleProbe({ ok: false, measured: true });
    expect(verdict.kind).toBe('unhealthy');
    expect(verdict.reason).toMatch(/no cause/i);
  });

  it('reads measured:false as UNMEASURED however loudly the cause reads', () => {
    // The regression under test. Every one of these used to be `unhealthy`.
    for (const error of [
      'the Google probe timed out before gog answered',
      'the Google probe could not be run',
      'gog auth list --check returned unrecognized output',
      'gog did not report token validity',
      'gog reported an account it explicitly did not check',
    ]) {
      expect(readGoogleProbe({ ok: false, measured: false, error })).toEqual({
        kind: 'unmeasured',
        reason: error,
      });
    }
  });

  it('refuses to claim HEALTH from a runner that never said it measured', () => {
    // The row this table was missing, and the last place `ok` outranked
    // `measured`. A bare `ok:true` used to return {kind:'ok'}, which on the
    // refusal path is `refusal.google-ok` — the record documented as "the one
    // record that means we cannot explain this", logged at error level, and
    // held up as the only evidence that could justify automatic recovery on the
    // hosted path. Raising it from a measurement nobody took is this branch's
    // founding defect surviving in the module written to delete it. `ok:true`
    // is not self-licensing: it is a health claim, and a health claim needs a
    // measurement behind it — exactly what the runner's README asserts when it
    // says `ok:true` always travels with `measured:true`.
    const verdict = readGoogleProbe({ ok: true });
    expect(verdict.kind).toBe('unmeasured');
    expect(verdict.reason).toMatch(/did not report whether/i);
  });

  it('carries the runner’s cause when a bare ok:true also names one', () => {
    const verdict = readGoogleProbe({ ok: true, error: 'something went wrong' });
    expect(verdict.kind).toBe('unmeasured');
    expect(verdict.reason).toContain('something went wrong');
  });

  it('never claims health from an incoherent ok:true + measured:false', () => {
    // `measured` is read FIRST, so the field that can only under-claim wins.
    const verdict = readGoogleProbe({ ok: true, measured: false });
    expect(verdict.kind).toBe('unmeasured');
  });

  it('describes an unmeasured answer that names no cause', () => {
    const verdict = readGoogleProbe({ ok: false, measured: false });
    expect(verdict.kind).toBe('unmeasured');
    expect(verdict.reason).toMatch(/could not measure/i);
  });

  it('refuses to claim ill health from a runner that never said it measured', () => {
    // Silence is not a measurement. An `ok:false` with no `measured` field is
    // read as unmeasured — under-claiming, the only safe direction.
    const verdict = readGoogleProbe({ ok: false, error: 'something went wrong' });
    expect(verdict.kind).toBe('unmeasured');
    expect(verdict.reason).toContain('something went wrong');
    expect(verdict.reason).toMatch(/did not report whether/i);
  });

  it('reads a body with no fields at all, and a null body, as unmeasured', () => {
    expect(readGoogleProbe({}).kind).toBe('unmeasured');
    expect(readGoogleProbe(null).kind).toBe('unmeasured');
    expect(readGoogleProbe(undefined).kind).toBe('unmeasured');
    expect(readGoogleProbe('a proxy error page').kind).toBe('unmeasured');
  });

  it('ignores non-boolean field types rather than trusting them', () => {
    // JSON from a proxy, or a future runner, may put anything here.
    expect(readGoogleProbe({ ok: 'true', measured: 'true' }).kind).toBe('unmeasured');
    expect(readGoogleProbe({ ok: 1, measured: 1 }).kind).toBe('unmeasured');
  });

  it('never carries a non-string cause into a log line', () => {
    const verdict = readGoogleProbe({ ok: false, measured: true, error: { nested: 'object' } });
    expect(verdict.kind).toBe('unhealthy');
    expect(typeof verdict.reason).toBe('string');
    expect(verdict.reason).toMatch(/no cause/i);
  });
});
