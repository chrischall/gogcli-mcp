/**
 * How this side reads the runner's `GET /health/google` answer.
 *
 * ## Why this is a module and not two `if` statements
 *
 * There are two callers — the connect-time probe in `connector-auth.ts` and the
 * post-refusal probe in `connector-runtime.ts` — and they used to make this
 * judgement separately. That is exactly how the defect below survived review of
 * both: each site branched on `body.ok === true` alone, so both inherited the
 * same wrong reading, and fixing one would have left the other. The judgement
 * now exists once; the call sites only translate a verdict into their own event
 * names.
 *
 * ## The defect this deletes
 *
 * `ok` answers "is the Google layer healthy". It does NOT answer "did anything
 * find out" — and `server.mjs` reports `ok:false` for causes that are facts
 * about the PROBE rather than about Google: it timed out, it could not be run at
 * all (no `gog` on PATH, no `credentials.json` on the volume), its output could
 * not be parsed, or gog declined to state validity. Reading `ok !== true` as
 * "Google refused" filed every one of those at error level under an event whose
 * documented meaning is "Google was asked and **refused**". An operator grepping
 * event names would conclude the refresh token was dead and close the incident
 * on evidence that was never gathered — the original defect (status claiming
 * health nothing measured) with the alarm merely inverted.
 *
 * So the runner now states `measured` explicitly, and this module reads it
 * FIRST. `ok` is only consulted once a measurement is established.
 *
 * ## Which way "unknown" resolves
 *
 * Toward `unmeasured`, always. The two errors are not symmetrical: filing a real
 * refusal as unmeasured under-claims, and the runner's own cause string still
 * rides along on the same log line, so nothing is lost. Filing a non-measurement
 * as a refusal invents evidence. A runner that does not say whether it measured
 * therefore gets no verdict about Google extracted from it — including the
 * incoherent `ok:true, measured:false` and the merely silent `ok:true`, neither
 * of which can license a health claim.
 *
 * `ok:true` is worth spelling out, because it is where this rule is easiest to
 * talk yourself out of: an affirmative-sounding field feels self-licensing, and
 * the harm of believing it looks small. It is not. The GOOD verdict is what the
 * refusal path compares Google's live 401 against, so a `kind:'ok'` built on
 * silence becomes `refusal.google-ok` — the record documented as "the one
 * record that means we cannot explain this", logged at error level, and the
 * only evidence that could ever justify building automatic recovery on the
 * hosted path. Raised from a measurement nobody took, it is precisely the
 * defect this branch exists to delete: a health claim with nothing behind it.
 */

/** The verdict, in the three states the log's event names already distinguish. */
export type GoogleProbeVerdict =
  /** Measured, and the credential works. */
  | { kind: 'ok'; reason?: undefined }
  /** Measured, and it does not. `reason` is the runner's classification. */
  | { kind: 'unhealthy'; reason: string }
  /** Nothing was learned about Google. Not evidence of anything. */
  | { kind: 'unmeasured'; reason: string };

/** Read a field only if it really is a boolean — a proxy may put anything here. */
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/**
 * The runner's cause, if it sent a usable one.
 *
 * Non-strings are dropped rather than stringified: this value reaches a log
 * aggregator, and `[object Object]` is worse than the honest fallback sentence.
 * Every legitimate value is a literal from `PROBE_CAUSES` in `server.mjs`.
 */
const cause = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Turn a `/health/google` body into a verdict. Total: every input, including a
 * proxy's HTML page parsed into a string and a body of `null`, yields one of the
 * three kinds and never throws.
 */
export function readGoogleProbe(body: unknown): GoogleProbeVerdict {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const measured = bool(record.measured);
  const reported = cause(record.error);

  // FIRST, and before `ok` is consulted at all: a runner that says it could not
  // measure has told us nothing about the credential, however alarming its cause
  // string reads.
  if (measured === false) {
    return {
      kind: 'unmeasured',
      reason: reported ?? 'the runner reported it could not measure the Google layer',
    };
  }
  // `ok` is read ONLY here, inside the established measurement. Health is a
  // claim, not a fact that states itself: `ok:true` on its own is a runner
  // asserting a verdict about a credential without saying anything asked.
  if (measured === true) {
    if (bool(record.ok) === true) return { kind: 'ok' };
    return {
      kind: 'unhealthy',
      reason: reported ?? 'the runner reported the Google layer unhealthy with no cause',
    };
  }
  // No `measured` field at all — whatever `ok` says. Silence is not a
  // measurement, so no claim about the credential may be built on it, in either
  // direction; but whatever the runner did say is carried through, because the
  // operator reading this line needs it.
  return {
    kind: 'unmeasured',
    reason: reported
      ? `the runner did not report whether it measured the Google layer; it said: ${reported}`
      : 'the runner did not report whether it measured the Google layer',
  };
}
