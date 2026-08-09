import type { ConnectorAuth } from '@chrischall/mcp-connector';
import { logAuthTransition, type AuthTransition } from './auth-log.js';
import { readGoogleProbe } from './google-probe.js';
import { redactSecrets } from './runner.js';

/**
 * OAuth props stored per user by the Cloudflare connector's OAuth provider.
 *
 * The gogcli remote connector authenticates each user with a single long-lived
 * personal "connector key" — a shared secret (the Fly backend's `RUNNER_KEY`)
 * that authorizes calls to that user's own `gog` backend on Fly.io. There is no
 * refresh cycle: `worker.ts`'s `buildClient` turns this key straight into a
 * per-session Fly executor. These props are encrypted at rest in `OAUTH_KV` by
 * the OAuth provider.
 *
 * NOTE: this is a FIELD LOGIN (a personal key), NOT Google OAuth. The Google
 * OAuth handshake lives entirely inside the Fly backend's `gog` install; the
 * connector never sees a Google token.
 *
 * The index signature satisfies `createConnector`'s
 * `Props extends Record<string, unknown>` constraint.
 */
export interface GogProps {
  key: string;
  [k: string]: unknown;
}

/**
 * How long the connect-time Google probe may take before it is abandoned.
 *
 * This sits inside the user's `/authorize` POST, so it is latency the human is
 * watching and claude.ai is timing. The probe is diagnostic, never a gate, so
 * the correct trade is unambiguous: give up early and record "not measured"
 * rather than hold up a login that was already decided. The runner's own budget
 * for the same probe (`GOOGLE_PROBE_TIMEOUT_MS` in server.mjs) is longer, so an
 * abort here is this side declining to wait, not the runner failing.
 */
export const GOOGLE_PROBE_TIMEOUT_MS = 4_000;

/**
 * How long ONE key check may take before it is abandoned and (once) retried.
 *
 * `/health` runs no gog, so a healthy runner answers in milliseconds; anything
 * near this bound means the Machine is booting or the proxy is holding the
 * connection, which is precisely the case the retry exists for.
 */
export const LOGIN_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * The pause between the two key-check attempts.
 *
 * Sized against what it is waiting out — a Fly proxy handing a request to a
 * Machine that is still coming up, or a runner a few hundred milliseconds from
 * the end of its drain — and against what it is spending: latency inside the
 * user's `/authorize` POST. One short pause is worth an enrolment; a backoff
 * ladder would not be.
 */
export const LOGIN_RETRY_DELAY_MS = 250;

/** How the failing status is named to the user. */
function describeStatus(status: unknown): string {
  return typeof status === 'number' ? `HTTP ${status}` : 'no HTTP status';
}

const describeCause = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Everything after the specific cause. It leads with the sentence that matters:
 * the user's key was never judged, so the correct action is to wait, not to go
 * looking for a different key.
 */
const UNREACHABLE_ADVICE =
  'Your connector key was NOT rejected — the backend never answered, so the key ' +
  'was never checked. The runner answers 503 for the whole of its drain window ' +
  '(i.e. during every deploy) and Fly answers 502 while a stopped Machine boots, ' +
  'so this is usually momentary. Wait a few seconds and try again.';

/**
 * Verify the connector key against the runner's `/health`, distinguishing the
 * two ways that can fail. Returns on success; throws otherwise.
 *
 * ## The bug this replaces (DEFECT 4)
 *
 * The previous body was `if (!res.ok) throw new Error('Invalid connector key
 * (backend rejected it)')`. Every non-2xx produced that sentence, and a rejected
 * `fetch` produced no sentence at all — it escaped `login()` uncaught.
 *
 * But `/health` returns non-2xx for reasons that have nothing to do with the
 * key. `server.mjs` answers **503 `{retryable:true}` to every request once a
 * shutdown signal lands**, which is the whole of every deploy, and Fly's proxy
 * answers 502 while a stopped Machine boots. A user enrolling in either window
 * was told, flatly, that their key was wrong. The reasonable response to that is
 * to stop and go find a better key — which leaves a connector stuck at
 * `authenticate` / `complete_authentication`, exactly the state `gog_docs`,
 * `gog_sheets` and `gog_drive` were observed in.
 *
 * ## The two rules
 *
 * **Only 401 and 403 mean "wrong key."** Those are the runner actually judging
 * the bearer (`bearerMatches` → `{ error: 'unauthorized' }`). Everything else —
 * every other status, an unparseable answer, a dead socket, our own timeout — is
 * the backend failing to answer, and is reported as such.
 *
 * **Unknown resolves toward "try again."** The two errors are not symmetrical:
 * telling a user with a good key that it is invalid ends the enrolment, while
 * telling a user with a bad key to retry costs one more attempt and then tells
 * them the truth. So anything unrecognised (including a response with no status
 * at all) takes the transient branch.
 *
 * ## Why retry rather than merely report
 *
 * The dominant transient case is self-inflicted and self-clearing: we deploy,
 * the runner drains, it returns 503 for a moment. Reporting that accurately
 * still costs the user an enrolment attempt they did nothing to deserve. One
 * retry absorbs it entirely. It is bounded at two attempts and one short delay
 * because this runs inside the `/authorize` POST the human is watching.
 *
 * Note the direction: this can only turn a refusal into a success. It cannot
 * strand anyone, which is what separates it from any check on the Google layer.
 */
async function verifyConnectorKey(endpoint: string, key: string): Promise<void> {
  let cause = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, LOGIN_RETRY_DELAY_MS));
    }
    let res: Response;
    try {
      res = await fetch(`${endpoint}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(LOGIN_ATTEMPT_TIMEOUT_MS),
      });
    } catch (err) {
      cause = `could not reach the gog backend (${describeCause(err)})`;
      continue;
    }
    if (res.ok) return;
    if (res.status === 401 || res.status === 403) {
      logAuthTransition('connect.key-rejected', {
        endpoint,
        reason: `the runner refused the connector key (HTTP ${res.status})`,
      });
      throw new Error('Invalid connector key (backend rejected it)');
    }
    cause = `the gog backend did not answer the key check (${describeStatus(res.status)})`;
  }
  logAuthTransition('connect.runner-unreachable', { endpoint, reason: cause });
  // `cause` can quote text this layer did not author — a proxy's error body, a
  // socket error that echoed the outgoing Authorization header — so the sentence
  // shown on the login page goes through the same redactor as every other error
  // this repo hands back.
  throw new Error(redactSecrets(`${cause}. ${UNREACHABLE_ADVICE}`));
}


/**
 * The MCP `instructions` every hosted agent advertises (see `worker.ts`).
 *
 * ## Why a connector needs to say this at all
 *
 * There are two independent credentials behind these tools and the client UI
 * shows only the first:
 *
 *   Layer 1  claude.ai → this Worker → the Fly runner, authenticated by the
 *            user's connector key (the runner's RUNNER_KEY), stored in OAUTH_KV.
 *   Layer 2  `gog` on the Fly machine → Google, authenticated by a refresh token
 *            in gog's file keyring on the /data volume. The connector never
 *            sees it, cannot refresh it, and is not told when it dies.
 *
 * "Connected" is a layer-1 fact. "Refreshed" is smaller still: `ConnectorAuth`
 * exposes only a `login` hook — no `validate`, no `refresh` — so a refresh is an
 * OAuth exchange inside OAUTH_KV that contacts neither Fly nor Google. Both
 * words are outside this repo's control, and both get read as "your Google
 * access works". They were, right up until the next Gmail call returned a Google
 * 401.
 *
 * So the boundary we DO own says it plainly, to the one reader who can act on it
 * before the user hits the error: the model holding these tools.
 */
export const CONNECTOR_INSTRUCTIONS = [
  'These tools reach Google through a `gog` install on the user\'s own Fly.io machine.',
  '',
  'There are TWO credentials, and this connector holds only the first:',
  '  1. the connector key, which authorizes this Worker to call that machine;',
  '  2. a Google refresh token in gog\'s keyring ON that machine, which the connector',
  '     never sees and cannot refresh.',
  '',
  'A "connected" or "refreshed" connector therefore proves only (1). It does NOT mean',
  'Google still accepts (2): a refresh token that expired or was revoked leaves the',
  'connector looking perfectly healthy until the first real call returns a Google 401.',
  'Nothing in the connection status measures Google — gog_auth_health is the only tool',
  'that does, because it performs a real token refresh against Google.',
  '',
  'When a call fails with a Google 401 or invalid_grant, do not retry it and do not',
  'assume the connector is broken. Run gog_auth_health to confirm, then re-authorize',
  'with gog_auth_add_url followed by gog_auth_add_complete (the browser-based',
  'gog_auth_add cannot work here — there is no browser on the Fly machine).',
  '',
  'If the OAuth client\'s consent screen is still in "Testing" mode, Google expires its',
  'refresh tokens exactly 7 days after issue, so this can recur weekly until the app is',
  'published. gog_auth_health reports how long ago each account was authorized.',
].join('\n');

/**
 * Ask the runner whether Google still accepts the credential on its volume, and
 * record the answer. Resolves in every case; it can neither throw nor return a
 * value, because nothing may make a decision out of what it finds.
 *
 * ## Why measuring here is worth doing, and why refusing here is not
 *
 * `login()` verifies the connector key against the runner's `/health`, an
 * endpoint whose own comment says it "does not depend on gog". So a successful
 * login has always been a layer-1 statement, presented to the user as if it
 * settled both layers. This makes the connect path measure the layer it was
 * silently vouching for.
 *
 * It must never gate the login. The tools that repair a dead Google credential
 * (`gog_auth_add_url`, `gog_auth_add_complete`) are MCP tools, reachable only
 * once the connector is connected — so refusing to connect on a dead credential
 * would lock the user out of the only path that fixes it. The goal is that
 * status never claims health it did not measure, NOT that a bad measurement
 * refuses the connection.
 *
 * ## What it is honestly able to say
 *
 * Only what was true AT CONNECT TIME, and only on the connect path: claude.ai's
 * later "refreshed" never reaches this code (there is no `refresh` hook to run
 * it from), so the record is a fixed point in the past, not a live status. Its
 * value is that the incident log finally contains what the Google layer was
 * doing at the moment the UI said "connected" — which is exactly the correlation
 * that could not be made when this was first reported.
 */
async function recordGoogleLayerAtConnect(endpoint: string, key: string): Promise<void> {
  let event: AuthTransition;
  let reason: string | undefined;
  try {
    const res = await fetch(`${endpoint}/health/google`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(GOOGLE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Includes the 404 from a runner deployed before the probe endpoint
      // existed. "I could not ask" is never reported as "Google said no".
      event = 'connect.google-unmeasured';
      reason = `the runner did not answer the Google probe (HTTP ${res.status})`;
    } else {
      // `readGoogleProbe` is the ONE place that judges a probe body, shared with
      // the post-refusal probe in connector-runtime.ts. It reads the runner's
      // `measured` field before its `ok` field, which is what keeps a probe that
      // TIMED OUT or could not be RUN out of `-unhealthy` — an event whose
      // documented meaning is "Google was asked and refused". The reason string
      // it returns comes from the runner's closed vocabulary (PROBE_CAUSES), so
      // it carries a classification and never gog's own output.
      const verdict = readGoogleProbe(await res.json());
      event =
        verdict.kind === 'ok'
          ? 'connect.google-ok'
          : verdict.kind === 'unhealthy'
            ? 'connect.google-unhealthy'
            : 'connect.google-unmeasured';
      reason = verdict.reason;
    }
  } catch (err) {
    // A rejected fetch, an abort at GOOGLE_PROBE_TIMEOUT_MS, or a body that is
    // not JSON (a proxy's HTML error page). None of them are facts about Google.
    event = 'connect.google-unmeasured';
    reason = err instanceof Error ? err.message : String(err);
  }
  // `reason` can quote text this layer did not author, so the record goes
  // through the same redactor as every other auth log line.
  logAuthTransition(event, { endpoint, reason });
}

/**
 * `ConnectorAuth` for the gogcli remote connector: the login page collects the
 * user's connector key, verifies it by hitting the Fly backend's `/health`
 * endpoint with the key as a bearer token, and stores `{ key }` as the OAuth
 * props that `worker.ts`'s `buildClient` turns into a per-session Fly executor.
 *
 * Only the runner judging the bearer (401/403) refuses the login; a backend that
 * does not answer is retried once and then reported as unreachable, never as a
 * bad key — see `verifyConnectorKey`.
 *
 * After the key is accepted it also measures the SECOND credential — the Google
 * grant on the Fly volume — and records what it found. That measurement changes
 * nothing about whether the login succeeds; see `recordGoogleLayerAtConnect`.
 */
export const gogAuth: ConnectorAuth<GogProps> = {
  service: 'gogcli (Google Workspace)',
  accent: '#4285F4',
  privacyNote:
    'Your connector key is stored encrypted and used only to reach your own gog backend.',
  fields: [{ name: 'key', label: 'gogcli connector key', type: 'password' }],
  async login(fields, env) {
    const endpoint = (env as any).FLY_ENDPOINT;
    // Layer 1. Throws — and only this may refuse the login.
    await verifyConnectorKey(endpoint, fields.key);
    // Layer 2. Records; never refuses. Deliberately after the key check, so a
    // login that never happened says nothing at all about Google.
    await recordGoogleLayerAtConnect(endpoint, fields.key);
    return { key: fields.key };
  },
};
