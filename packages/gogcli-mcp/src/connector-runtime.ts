import { runExecutor, RunnerTransportError } from './runner.js';
import type { GogArg, GogExecutor } from './runner.js';
import { logAuthTransition } from './auth-log.js';

// Re-exported so the runner-transport error type reads as part of THIS module's
// surface — this is the layer that authors these failures. It is DEFINED in
// runner.js because runner.js also has to preserve the type across its
// redacting rewrap, and importing it from here would make the two modules
// circular.
export { RunnerTransportError, isRunnerTransportError } from './runner.js';
export type { RunnerFailureKind } from './runner.js';

// Runtime helpers for the Cloudflare connector (worker.ts), split out here so
// they can be unit-tested under the node pool — worker.ts itself imports the
// Worker-only `@chrischall/mcp-connector`/`agents` runtime and cannot load in
// node. These helpers touch only the `runExecutor` seam and global `fetch`.

// Mirrors runner.ts's TIMEOUT_MS: the budget the stdio path gives a `gog` call
// before it kills the child. Duplicated rather than imported to keep this module
// free of the spawn-side surface.
const DEFAULT_TIMEOUT_MS = 30_000;

// Headroom on top of the backend's own budget. The Fly runner kills `gog` and
// returns a real error; we only want the client deadline to fire when the
// backend cannot answer at all (scale-to-zero cold start that never wakes, or a
// wedged machine). Firing first would turn a useful "gog exited 1" into an
// opaque timeout.
//
// This grace is deliberately NOT widened for GogFileArg payloads. The deadline
// now covers a request body that carries the payload inline, so upload happens
// before `gog` starts — but the payloads that take this path are text (a mail
// body, slide notes), bounded by the MCP request that carried them, and the hop
// is Cloudflare edge → Fly datacenter, so upload is milliseconds, not seconds.
// Widening the grace would weaken the property this constant exists to protect:
// the backend must lose the race only when it genuinely cannot answer, and every
// extra second is a second of an opaque client timeout replacing a real error.
// If a payload class ever appears that does NOT upload in well under 5s, the fix
// is to raise the caller's `opts.timeout` (which this deadline tracks) rather
// than to inflate the grace, so the runner still gets to answer first.
const DEADLINE_GRACE_MS = 5_000;

// The smallest remaining budget worth spending on a replay.
//
// The replay shares the ORIGINAL call's deadline rather than getting a fresh
// copy of it (see `deadlineAt` in makeFlyExecutor), so a first attempt that ran
// long leaves the second one very little. Below this floor the replay can only
// end in an abort, and that TimeoutError would REPLACE gog's own 401 — trading
// the error that names the problem for one that names nothing.
//
// Declining costs only the automatic repair, never the durable one: the
// eviction has already happened by the time this is consulted, so the caller's
// own next call mints a fresh token.
const MIN_REPLAY_BUDGET_MS = 1_000;

// Status codes the Fly runner uses to classify its OWN failures. These must stay
// in sync with fly-gog-runner/server.mjs — they are the contract that lets this
// side tell "gog ran and failed" apart from "the request never arrived", without
// having to guess from the response body.
//
// 422: `gog` executed and exited non-zero. Deterministic — never retry.
// 503: the runner is draining (SIGINT from Fly's autostop). Transient — retry.
// Any other non-2xx: infrastructure, i.e. Fly's edge, not us.
// 400: the runner refused the request shape before `gog` was reached.
// 401: the runner rejected OUR bearer token — its own transport auth.
//
// Both are runner-authored: they are surfaced as RunnerTransportError so the
// diagnosing layer classifies them by TYPE. Reading them as prose is what made
// a key mismatch look like a dead Google grant: the runner answers a bad bearer
// with the single word "unauthorized", which is also exactly how Google phrases
// a rejected credential.
const RUNNER_GOG_FAILED = 422;
const RUNNER_DRAINING = 503;
const RUNNER_BAD_REQUEST = 400;
const RUNNER_BAD_KEY = 401;

// How this module reads a token source. Structurally the plain
// `() => token` of the #230 wiring, plus the optional `invalidate` that
// google-token.ts's minting source provides — optional precisely so a source
// that cannot re-mint says so by not having it.
export type FlyAccessTokenSource = {
  (): string | undefined | Promise<string | undefined>;
  invalidate?: (rejected: string) => boolean | Promise<boolean>;
  /**
   * The credential's log-safe name (google-token.ts `credentialTag`), so a
   * record written here names the same credential as the records written
   * there. Optional for the same reason `invalidate` is: a source holding a
   * directly-supplied token has no mintable credential to name.
   */
  credentialId?: () => Promise<string>;
};

// `gog` ran on the backend and exited non-zero (the runner's 422). Kept as an
// ORDINARY Error subclass — its `name` stays 'Error' and its message is still
// gog's own words — because tools/utils.ts must go on reading that prose. The
// only thing added is a place to keep gog's stderr APART from the command line
// the runner echoed alongside it, and a type this module can recognise.
//
// Why a type rather than re-reading the message: the re-mint below must fire
// only for a failure that actually reached Google. Deciding that by pattern
// would put us back where defect 1 started — inferring the author of a failure
// from words that several different authors can produce.
//
// `instanceof` is safe here (unlike RunnerTransportError, which is branded)
// because this class is thrown and caught inside this one module: there is no
// boundary a second copy of it could be created across.
class GogFailedError extends Error {
  /** gog's stderr alone, with no echoed argv mixed in. */
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

// Google saying, through gog, that the ACCESS token it was given is no good.
//
// Matched against gog's stderr only, never against the runner's `error` field:
// that field is Node's execFile message, which embeds the entire command line,
// so a caller's own text (`--subject "invoice 401"`) would otherwise decide
// whether we replay their call.
//
// Narrow on purpose, and narrower than tools/utils.ts. That module picks a
// HINT, where being over-eager costs a sentence; here it would cost a REPLAYED
// request, so this only matches the shapes Google and gog actually emit.
// (tools/utils.ts no longer uses a bare /\b401\b/ — 58d3e5b made it require a
// status word, and #246 widened the separator so `Google API error (401 …)`,
// the very shape below, still matches there too.)
const GOOGLE_TOKEN_REJECTED_PATTERN =
  /Google API error \(401\b|invalid[ _]authentication[ _]credentials|\bACCESS_TOKEN_EXPIRED\b|\binvalid_token\b/i;

// The refresh token is dead, not the access token. Nothing can be minted from
// it, so there is nothing to replay — a human has to re-authorize. This
// outranks the pattern above, because gog reports both in one stderr when the
// grant is gone.
const REFRESH_TOKEN_DEAD_PATTERN = /\binvalid_grant\b/i;

// `gog` subcommands that only READ. Everything outside this set is treated as a
// write, which is the conservative direction: a read that is missing here loses
// nothing but the automatic replay — the eviction happens BEFORE this set is
// consulted (see the write rule below), so the caller's own next call mints a
// fresh token and succeeds — while a write that crept in could be applied
// twice.
//
// Only verbs that cannot plausibly grow mutating children are listed.
// Namespace-shaped words are deliberately absent: `gog gmail labels list`
// arrives here as the subcommand `labels`, and if `labels` were listed then a
// later `labels create` would inherit the replay. Reading `labels` as unsafe
// costs one message, and nothing else.
//
// `lists` used to be here, and was the counter-example that proves the rule is
// not hypothetical: `gog tasks lists` is a NAMESPACE, and `tasks lists create
// <title> ...` exists in gog v0.34.1 today — variadic, so one invocation makes
// N Google calls and a 401 on the second means the first already landed. It is
// reachable without any new gog, through the `gog_tasks_run` escape hatch
// (`{subcommand: 'lists', args: ['create', 'A', 'B']}`), so listing the
// namespace word handed a real double-apply the replay. Its absence costs
// `gog_tasks_lists` (tools/tasks.ts, argv `tasks lists list`) one automatic
// replay and nothing more: the eviction runs BEFORE this set is consulted, so
// that caller's next call still mints a fresh token.
const READ_ONLY_SUBCOMMANDS = new Set([
  'cat',
  'describe',
  'get',
  'info',
  'list',
  'list-slides',
  'ls',
  'metadata',
  'read-slide',
  'search',
  'services',
  'status',
  'structure',
]);

// The gog SERVICE and SUBCOMMAND inside a fully-assembled arg list, either of
// which may be absent.
//
// `run()` (runner.ts assembleArgs) puts global flags in front of the service and
// subcommand: --json, --color=never, --no-input, --readonly, and --account,
// which is the only one carrying a SEPARATE value. So the subcommand is the
// second bare word once flags (and --account's value) are skipped.
//
// If a future global flag with a value is added and not handled here, the scan
// mistakes that value for the service and returns the wrong word — which will
// almost certainly not be in the read-only set, i.e. it degrades toward NOT
// replaying. That is the direction a mistake here has to fail in.
// The service is returned as well as the subcommand because it is what a log
// record needs: the whole fleet shares one backend and one Google credential,
// so "which service was this" is the first question asked of an auth record,
// and re-scanning argv a second time to answer it would be waste on a path that
// is already handling a failure.
function gogTarget(args: GogArg[]): { service?: string; subcommand?: string } {
  // A GogFileArg is a payload, never a verb; dropping the non-strings first
  // keeps the scan below about words only.
  const words = args.filter((arg): arg is string => typeof arg === 'string');
  let service: string | undefined;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('-')) {
      if (word === '--account') i += 1;
      continue;
    }
    if (service === undefined) {
      service = word;
      continue;
    }
    return { service, subcommand: word };
  }
  return { service };
}

// A replay that has been authorized: the freshly minted token to send, plus the
// identifiers the records around it are tagged with. Carried together rather
// than recomputed by the caller so the token and the credential a log line
// names can never come from two different decisions.
interface Replay {
  token: string;
  /**
   * What is LEFT of the one deadline this tool call was given, in ms. Carried
   * rather than recomputed by the caller so the budget that was judged
   * sufficient is exactly the budget that gets spent.
   */
  budgetMs: number;
  /**
   * The same eviction the rejected token got, carried so the caller can apply
   * it to THIS token if Google refuses it too — see the symmetric eviction
   * below. Carried rather than re-read from the source because by the time an
   * authorization exists it has already been proved present, and re-deriving it
   * would mean re-asking a question whose answer is what this object IS.
   */
  invalidate: NonNullable<FlyAccessTokenSource['invalidate']>;
  credential: string | undefined;
  service: string | undefined;
}

// Decide whether this failure earns exactly one replay with a freshly minted
// token, and produce that token if so. `undefined` means "do not replay".
//
// Every condition is a separate refusal because each is refusing for its own
// reason, and collapsing them would make the log of WHY unreadable.
async function remintAfterGoogleRejection(
  err: unknown,
  used: string | undefined,
  args: GogArg[],
  readAccessToken: FlyAccessTokenSource | undefined,
  deadlineAt: number,
): Promise<Replay | undefined> {
  // Only a failure gog itself authored can carry Google's verdict. A runner
  // transport failure never reached Google, and the runner's own 401 is about
  // OUR bearer — minting a Google token for either is pure waste.
  if (!(err instanceof GogFailedError)) return undefined;

  // THE RECORDING GATE, and the reason the two pattern tests moved up here from
  // the middle of the ladder.
  //
  // Everything below this line is a refusal worth WRITING DOWN, because by here
  // Google has demonstrably refused a credential. Everything above it is an
  // ordinary gog failure — a bad attachment id, an --out path that does not
  // exist on the box — and an auth log that also carries those is an auth log
  // nobody reads.
  //
  // Reordering is safe precisely because every check in this function is a pure
  // predicate whose failure returns `undefined`: none has a side effect until
  // the `invalidate` call at the bottom, so the answer cannot depend on the
  // order they are asked in.
  const grantDead = REFRESH_TOKEN_DEAD_PATTERN.test(err.stderr);
  if (!grantDead && !GOOGLE_TOKEN_REJECTED_PATTERN.test(err.stderr)) return undefined;

  const { service, subcommand } = gogTarget(args);
  const credential = await readAccessToken?.credentialId?.();
  const where = { credential, service };

  // The refresh token is gone: no mint can succeed, and replaying would loop a
  // caller against a credential that can never work. This is the ONE outcome on
  // this path that legitimately ends in "a human must re-authorize", which is
  // exactly why it gets its own transition rather than a declined-replay note.
  if (grantDead) {
    logAuthTransition('grant.dead', {
      ...where,
      reason:
        'gog reported invalid_grant: the stored refresh token is dead, so no token can be minted ' +
        'and this account must be re-authorized',
    });
    return undefined;
  }

  // Only a token WE supplied is ours to replace. Without one, gog acted as
  // whatever identity the backend volume holds and only an operator can change
  // that.
  if (!used) {
    logAuthTransition('replay.declined', {
      ...where,
      reason:
        'no access token was supplied with the call, so gog acted as the backend volume’s own identity',
    });
    return undefined;
  }

  // A source with no cache behind it (a directly-supplied GOG_ACCESS_TOKEN)
  // would hand back the identical rejected string.
  if (!readAccessToken?.invalidate) {
    logAuthTransition('replay.declined', {
      ...where,
      reason: 'this token source cannot mint a replacement, so a replay would resend the rejected token',
    });
    return undefined;
  }

  // EVICT FIRST, and unconditionally — every remaining check decides whether to
  // REPLAY, which is a different question with a different answer.
  //
  // A replay re-runs the call and can double-apply; an eviction only drops a
  // string Google has already refused, and the cache's own read guard is purely
  // about TIME, so a token left in it is re-served until its nominal expiry.
  // Gating the eviction behind the replay rules is therefore not a conservative
  // choice but the caching half of the original defect: after Google rejected
  // the token, every write (and every read whose subcommand is outside the
  // allow-list) re-sent that same rejected token for up to ~58 minutes, and
  // only a reconnect — a fresh isolate with an empty cache — appeared to help.
  //
  // Safe to do before the decision because it is idempotent and value-matched:
  // `invalidate` drops the entry only if it still holds exactly this string, so
  // a concurrent caller's fresher token is never the casualty, and a second
  // call for the same token changes nothing.
  const evicted = await readAccessToken.invalidate(used);

  // THE WRITE RULE. A replay re-runs the whole gog invocation. For a read that
  // is free; for a write it is only safe if nothing was applied before the
  // failure, and this layer cannot know that — gog may make several Google
  // calls in one invocation, and a 401 on a later one would mean the earlier
  // ones already landed. Re-sending an email is not a cost worth paying for
  // hiding one error message, so writes get the eviction above and nothing more.
  if (subcommand === undefined || !READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    logAuthTransition('replay.declined', {
      ...where,
      reason: `not replayable: '${subcommand ?? '(none)'}' is not a known read-only subcommand and a write could double-apply`,
    });
    return undefined;
  }

  // Did the eviction actually drop this token? False means a concurrent caller
  // already replaced it, so the token a replay would send is the one already in
  // use and the replay proves nothing.
  if (!evicted) {
    logAuthTransition('replay.declined', {
      ...where,
      reason: 'the rejected token was already superseded, so the cache holds the token a replay would send',
    });
    return undefined;
  }

  // The mint can throw (invalid_grant, Google unreachable). That error is
  // allowed to propagate in place of gog's 401, because it is strictly more
  // actionable: it names the credential that is actually dead and the step that
  // repairs it, where gog's 401 only says a token was refused. The mint's own
  // outcome is recorded by google-token.ts, so nothing is logged for it here.
  const fresh = await readAccessToken();

  // A source that minted a moment ago and now answers nothing must NOT be
  // replayed without a token: the backend would run the call as its own
  // identity and hand this caller someone else's account.
  if (!fresh) {
    logAuthTransition('replay.declined', {
      ...where,
      reason: 'the token source produced no token after eviction; replaying without one would act as the backend',
    });
    return undefined;
  }

  // Whatever is LEFT of the one deadline this call was given — the mint above
  // spends from it too. A replay with no budget can only abort, and that
  // timeout would land on the caller in place of gog's own 401.
  const budgetMs = deadlineAt - Date.now();
  if (budgetMs < MIN_REPLAY_BUDGET_MS) {
    logAuthTransition('replay.declined', {
      ...where,
      reason:
        `only ${budgetMs}ms of the call’s deadline remained, so a replay could only time out; ` +
        'the rejected token was evicted, so the next call mints a fresh one',
    });
    return undefined;
  }
  return { token: fresh, budgetMs, invalidate: readAccessToken.invalidate, ...where };
}

// Build a GogExecutor that forwards a fully-assembled `gog` arg-array to the Fly
// backend's `/run` endpoint.
//
// The backend (and the `gog` process it spawns) own timeout/interactive
// behaviour, so `opts` does not change what the backend does — but `timeout`
// still has to be honoured HERE as a client-side deadline. Workers' `fetch` has
// no default timeout, and the stdio path's kill lives in a child process this
// path never spawns, so without an explicit signal a cold or wedged backend
// hangs the MCP request indefinitely with nothing to interrupt it.
//
// GogFileArg elements pass through STRUCTURED, as objects inside the JSON body.
// Every other executor materializes them to a temp file itself; this one cannot
// and must not. A Worker has no filesystem and does not host the `gog` binary,
// so there is nowhere to put a file that the process which needs it could read.
// The Fly runner is the only box with both, so it owns materialization — this
// layer's whole job is to hand the elements over unaltered, in order. Anything
// clever here (flattening to `--flag=<inline>`, truncating, re-encoding) would
// put the payload straight back into argv and re-create the size cap this whole
// change exists to escape.
// `readAccessToken` is how a hosted gog acts as its CALLER rather than as
// whoever seeded the backend's volume (#230). The backend holds one Google
// identity; a token supplied with the request overrides it for that one `gog`
// invocation, and `gog` already prefers a directly-passed token over its store.
//
// A FUNCTION, read per call, not a string captured at construction. The whole
// claim being made is "this token belongs to this request", and an executor
// outlives any one request — on the Worker path a single isolate serves many
// callers, so a captured token would pin the first caller's identity onto
// everyone who followed. That is the same shared-identity bug this closes,
// rebuilt one layer up.
//
// Absent when there is no token, rather than null or "": the backend has to
// tell "act as this caller" from "act as the box", and an empty third state is
// one neither side has a meaning for.
export function makeFlyExecutor(
  endpoint: string,
  key: string,
  readAccessToken?: FlyAccessTokenSource,
): GogExecutor {
  return async (args: GogArg[], opts) => {
    const deadlineMs = (opts?.timeout ?? DEFAULT_TIMEOUT_MS) + DEADLINE_GRACE_MS;
    // Awaited, because the token may have to be MINTED (#241): a refresh token
    // is what a registration stores, and the access token it yields lives about
    // an hour. Deliberately NOT caught here — if the source throws, the call
    // fails, because the alternative is running it as the backend's identity
    // and handing this caller someone else's account.
    const accessToken = await readAccessToken?.();

    // ONE deadline for the whole tool call, fixed before the first attempt
    // rather than re-derived per attempt. A replay is a second `fetch`, and
    // handing it a fresh copy of the budget made the worst case two full
    // budgets — ~70s of wall clock for one tool call, which can outlast the MCP
    // client's own request timeout and turn a self-healing read into a
    // client-side hang.
    const deadlineAt = Date.now() + deadlineMs;

    try {
      return await attempt(endpoint, key, args, accessToken, deadlineMs);
    } catch (err) {
      // ONE replay, and only when the token we sent is the reason it failed.
      // Not a retry loop: an unbounded one against a genuinely dead credential
      // is exactly the behaviour the "retry the same call" hints already
      // produced elsewhere, and it never terminates. `remintAfterGoogleRejection`
      // both decides and mints, so the decision cannot drift from the token.
      const replay = await remintAfterGoogleRejection(
        err,
        accessToken,
        args,
        readAccessToken,
        deadlineAt,
      );
      if (replay === undefined) throw err;

      const where = { credential: replay.credential, service: replay.service, endpoint };
      logAuthTransition('replay.attempted', {
        ...where,
        reason: 'Google rejected the access token; replaying this read once with a freshly minted one',
      });
      try {
        const stdout = await attempt(endpoint, key, args, replay.token, replay.budgetMs);
        // The interesting record of the pair: it says the caller saw a clean
        // success where they used to see an hour of identical 401s.
        logAuthTransition('replay.succeeded', where);
        return stdout;
      } catch (replayErr) {
        // `String`, not `instanceof Error ? .message : …` — a rethrown non-Error
        // rejection is a real possibility here (see attempt's abort handling)
        // and stringifying uniformly avoids an arm that no test could reach.
        logAuthTransition('replay.failed', { ...where, reason: String(replayErr) });
        // SYMMETRY with the eviction that got us here, under the SAME predicate
        // — a token is dropped because GOOGLE refused it, never merely because
        // a call carrying it failed.
        //
        // The gate is the point. A replay can fail without Google ever seeing
        // the token: the Machine drains between the two attempts, the
        // client-side deadline fires, the runner's bearer rotates mid-call.
        // Evicting on those would discard a token nothing has refused and emit
        // `token.evicted` reading "Google rejected this access token" about a
        // service that was never consulted — the same misattribution this
        // branch exists to delete, moved from the user's screen to the
        // operator's query. So the second eviction asks exactly what authorized
        // the first: is this a gog failure whose stderr shows Google refusing
        // the credential?
        //
        // WHAT THIS BUYS, measured rather than assumed. Under a sustained
        // Google-side refusal that is not invalid_grant (a revoked scope, say),
        // a steady-state call costs 2 /run round-trips either way — the first
        // attempt and the replay both always happen — and this eviction in fact
        // costs one EXTRA mint per call (2 instead of 1), because it empties the
        // cache the next call would otherwise have hit. It is not a round-trip
        // saving and must not be justified as one.
        //
        // It is worth keeping because it bounds how long a KNOWN-REFUSED token
        // can be handed out. Left cached, `ya29.fresh` is re-served for the rest
        // of its nominal hour, and the caller that suffers most is a WRITE: a
        // write gets the eviction and no replay, so it would be sent with the
        // token that just failed twice and fail on contact — even after the
        // underlying refusal has cleared. Trading a mint for that is the right
        // side of the deal.
        //
        // Value-matched and idempotent like the first eviction, so a concurrent
        // caller's fresher token is never the casualty. Not wrapped in its own
        // catch: `invalidate` is a map lookup behind a digest, the first
        // eviction is already un-guarded on this same path, and a guard here
        // would add an arm no test can reach.
        if (replayErr instanceof GogFailedError && GOOGLE_TOKEN_REJECTED_PATTERN.test(replayErr.stderr)) {
          await replay.invalidate(replay.token);
        }
        throw replayErr;
      }
    }
  };
}

// One request to the runner: send the args (and, when we have one, the identity
// to act as), and turn whatever comes back into either stdout or a classified
// failure. Everything about WHICH failure this is lives here; the caller above
// decides only whether to run it a second time.
async function attempt(
  endpoint: string,
  key: string,
  args: GogArg[],
  accessToken: string | undefined,
  deadlineMs: number,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(endpoint + '/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accessToken ? { args, accessToken } : { args }),
      signal: AbortSignal.timeout(deadlineMs),
    });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError; a caller-supplied abort
    // surfaces as AbortError. Either way the bare message ("The operation was
    // aborted") says nothing about which backend failed to answer.
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      // No status: nothing answered. Retryable — the usual cause is the Fly
      // machine waking from scale-to-zero, which succeeds on the next call.
      throw new RunnerTransportError(
        `gog-runner did not respond within ${deadlineMs}ms (${endpoint}) — the Fly backend may be cold or wedged`,
        'transport-retryable',
      );
    }
    throw err;
  }
  if (!res.ok) {
    // Two very different failures arrive as non-2xx, and collapsing them (as
    // this used to) is what made a real bug look like random flakiness:
    //
    //  a) The runner answered with its own JSON — `gog` actually ran on the
    //     box and failed. Deterministic: the same call will fail the same way.
    //  b) The body is NOT the runner's JSON (Fly's HTML error page, or empty).
    //     Then the request never reached `gog` at all; Fly's edge proxy is
    //     reporting that it could not reach the Machine — typically because
    //     the Machine was starting from scale-to-zero, or was mid-shutdown.
    //     Genuinely transient, and the only case worth retrying.
    const body = (await res.json().catch(() => null)) as
      | { error?: string; stderr?: string; retryable?: boolean }
      | null;
    const detail =
      body && typeof body.error === 'string'
        ? body.stderr && body.stderr.trim() && body.stderr.trim() !== body.error.trim()
          ? `${body.error}\n${body.stderr}`
          : body.error
        : '';

    // 422 is the runner's "gog ran and exited non-zero" status. It is only
    // ever produced by our own handler, so reaching here proves the request
    // was delivered and executed. Deterministic — say so, and say nothing
    // that invites a retry.
    if (res.status === RUNNER_GOG_FAILED) {
      // The message is unchanged — gog's words, exactly as before. `stderr` is
      // carried alongside rather than folded in, so the replay decision can
      // read what GOG said without also reading the argv the runner echoed
      // back inside `error`.
      throw new GogFailedError(
        detail || 'gog failed on the runner (no detail supplied)',
        typeof body?.stderr === 'string' ? body.stderr : '',
      );
    }

    // The runner's OWN bearer auth failed: the key the Worker sent is not the
    // key the Fly app expects. `gog` never ran, Google was never contacted,
    // and no stored credential was even read — so the one thing this must not
    // do is send the caller to re-authorize an account that is fine.
    //
    // The runner's body (the bare word "unauthorized") is deliberately
    // DROPPED rather than repeated, and the status is deliberately not
    // interpolated, for the same reason the 5xx fallback below omits its own:
    // both `unauthorized` and `401` match DEFINITE_AUTH_PATTERN in
    // tools/utils.ts. The type is what classifies this error now, but the
    // prose must not be able to re-create the old misdiagnosis at any future
    // boundary where the type could be lost (a serialized error, a log line a
    // human reads).
    if (res.status === RUNNER_BAD_KEY) {
      // The record a human reads must not re-create defect 1 either, so it
      // states the negative facts explicitly instead of repeating the runner's
      // bare "unauthorized".
      logAuthTransition('runner.auth-failed', {
        service: gogTarget(args).service,
        endpoint,
        reason:
          'the gog-runner rejected the connector’s bearer token, so gog never ran and no Google ' +
          'credential was read; GOG_RUNNER_KEY does not match the Fly app’s RUNNER_KEY',
      });
      throw new RunnerTransportError(
        "gog-runner rejected the connector's bearer token, so the request never reached gog and no " +
        'Google credential was involved. The Worker secret GOG_RUNNER_KEY no longer matches RUNNER_KEY ' +
        'on the Fly app; set them to the same value (wrangler secret put GOG_RUNNER_KEY / fly secrets ' +
        'set RUNNER_KEY) and retry.',
        'transport-auth',
        res.status,
      );
    }

    // The runner refused the request shape (oversized arg, unparseable JSON,
    // a malformed access token). Its words are about OUR request, never about
    // Google — deterministic, and no hint applies.
    if (res.status === RUNNER_BAD_REQUEST) {
      throw new RunnerTransportError(
        detail || 'gog-runner rejected the request (no detail supplied)',
        'transport-request',
        res.status,
      );
    }

    // The runner's drain response: it is up, but deliberately refusing new
    // work while it shuts down. The one runner-authored failure worth retrying.
    if (res.status === RUNNER_DRAINING || body?.retryable === true) {
      throw new RunnerTransportError(
        `gog-runner is restarting; retry this call.${detail ? ` ${detail}` : ''}`,
        'transport-retryable',
        res.status,
      );
    }

    // Anything else non-2xx is infrastructure: Fly's edge could not reach the
    // Machine, or the Machine answered with something that is not ours. Only
    // claim the request never arrived when there is genuinely no runner body
    // — a runner that did answer deserves to have its own words repeated.
    //
    // The status is deliberately NOT interpolated here. A runner body proves
    // gog ran, so this is a deterministic failure; embedding the literal
    // status would put "502" into the message, which matches
    // TRANSIENT_ERROR_PATTERN (/\b5\d\d\b/) in tools/utils.ts and re-attaches
    // the very "this is transient, retry the same call" hint this change
    // exists to remove — reintroducing the bug during the rollout window this
    // branch exists to cover. Anything genuinely transient in gog's own text
    // (a Google 5xx, say) still matches on its own merits, which is correct.
    if (detail) {
      throw new Error(detail);
    }
    throw new RunnerTransportError(
      `gog-runner HTTP ${res.status}: the response did not come from the runner, ` +
      'so the request never reached gog. The backend Machine was most likely starting ' +
      'or shutting down — this is transient, retry the same call.',
      'transport-retryable',
      res.status,
    );
  }
  const { stdout } = (await res.json()) as { stdout: string };
  return stdout;
}

// Wrap an McpServer in a Proxy whose `registerTool` (and `tool`, if any
// registrar uses it) intercepts the tool handler so it runs inside the
// `runExecutor` ALS scope. This is the crux of the connector: it lets the
// UNCHANGED base registrars forward every `gog` call to the per-session Fly
// executor without any change to the registrars or `runner.ts` — when a
// handler's `run()` looks up `runExecutor.getStore()` it finds `executor` and
// forwards instead of spawning. Everything else proxies through via Reflect.
export function wrapServer<T extends object>(server: T, executor: GogExecutor): T {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool' || prop === 'tool') {
        const orig = (target as Record<string | symbol, (...a: unknown[]) => unknown>)[prop].bind(target);
        return (...args: unknown[]) => {
          const handler = args[args.length - 1];
          if (typeof handler === 'function') {
            args[args.length - 1] = (...h: unknown[]) =>
              runExecutor.run({ executor }, () => (handler as (...a: unknown[]) => unknown)(...h));
          }
          return orig(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
