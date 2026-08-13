import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { errorResult, rawTextResult } from '@chrischall/mcp-utils';
import { run, isRunnerTransportError } from '../runner.js';
import type { GogArg, RunnerFailureKind } from '../runner.js';
import { normalizeTimestamps } from '../timestamps.js';
import { stripConsumedPageToken } from '../pagination.js';

// Byte size at or below which a payload stays on the plain inline flag.
//
// Two reasons not to route everything through a file. First, gog's semantics
// differ between the two forms: reading a body from a file strips ALL trailing
// newlines (measured on gog 0.34.1 — a 5-byte payload padded to 6/7/8 bytes all
// came back as 5; tracked upstream at openclaw/gogcli#936), so a body ending in
// "\n" cannot round-trip byte-for-byte through the file path. Second, the file
// path costs a temp dir, a write, and a delete per call.
//
// The value matches the per-arg byte limit the Fly runner enforced BEFORE large
// payloads could leave argv (the old MAX_ARG_LEN, 4096). That is deliberate:
// every body that used to round-trip inline byte-for-byte still does, so this
// change adds no trailing-newline regression for any body that already worked —
// only bodies that previously exceeded the cap and hard-failed ("each arg must
// be at most 4096 chars") now take the file path and its newline trim. The
// runner's plain-arg cap is now 64 KiB, so a 4096-byte inline value is nowhere
// near being rejected.
export const PAYLOAD_INLINE_MAX = 4096;

// The ONE place the inline-vs-file decision is made. Every tool that has a
// gog `--x` / `--x-file` flag pair routes its value through here so the
// threshold cannot drift between tools.
//
// Measures BYTES, not characters: the Fly runner's cap and the Linux kernel's
// MAX_ARG_STRLEN are both byte-based, so a multibyte-heavy body (CJK, emoji)
// would slip past a `.length` check at up to 4x its real argv cost.
export function payloadArg(
  inlineFlag: string,
  fileFlag: string,
  value: string,
  ext?: string,
): GogArg {
  if (Buffer.byteLength(value, 'utf8') <= PAYLOAD_INLINE_MAX) {
    return `--${inlineFlag}=${value}`;
  }
  return { kind: 'file', flag: fileFlag, contents: value, ext };
}

export const accountParam = z.string().optional().describe(
  'Google account email to use, e.g. you@gmail.com — must be the full address, not a bare username. ' +
  'Overrides the GOG_ACCOUNT env var. Omit to use the single configured account.',
);

// Canonical ID descriptors. Use these instead of redefining the same
// `z.string().describe('Course ID')` etc. across multiple tool files —
// keeps descriptions in lockstep so they don't drift apart.
export const ids = {
  course: z.string().describe('Course ID'),
  coursework: z.string().describe('Coursework ID'),
  submission: z.string().describe('Submission ID'),
  announcement: z.string().describe('Announcement ID'),
  topic: z.string().describe('Topic ID'),
  invitation: z.string().describe('Invitation ID'),
  spreadsheet: z.string().describe('Spreadsheet ID (from the URL)'),
  doc: z.string().describe('Doc ID (from the URL)'),
  presentation: z.string().describe('Presentation ID'),
  slide: z.string().describe('Slide ID'),
  file: z.string().describe('File ID'),
  message: z.string().describe('Message ID'),
  thread: z.string().describe('Thread ID'),
  draft: z.string().describe('Draft ID'),
  label: z.string().describe('Label ID or name'),
  attachment: z.string().describe('Attachment ID'),
  comment: z.string().describe('Comment ID'),
  meetingCode: z.string().describe('Meeting code (e.g. abc-defg-hij)'),
  permission: z.string().describe('Permission ID'),
  user: z.string().describe('User ID'),
  // People API uses fully-qualified resource names ("people/c123") not bare IDs.
  person: z.string().describe('Person resource name (people/...) or email'),
};

// THE CURSOR IS NAMED AFTER THE FIELD THAT CARRIES IT. Every paginated response
// reports its cursor as `nextPageToken`, so the request parameter is
// `pageToken` — a caller reading a response can guess the input name and be
// right. It used to be `page` (after gog's own `--page` flag), and that
// mismatch was not cosmetic: MCP tool inputs are zod objects, which SILENTLY
// STRIP unknown keys, so a client that inferred `pageToken` had it dropped
// before the handler ran and got page 1 back forever — same items, same token,
// no error. Two "that email doesn't exist" incidents came from exactly that.
export const pageTokenParam = z.string().optional().describe(
  'Cursor for the NEXT page. Pass back the nextPageToken from a previous response verbatim, ' +
  'keeping the query and max identical: call once, then call again with pageToken=<that value>. ' +
  'A response with NO nextPageToken is the last page.',
);

// Kept so anything already sending `page` keeps working. Prefer pageTokenParam.
export const pageAliasParam = z.string().optional().describe(
  'Deprecated alias for pageToken, accepted so existing callers keep working. Use pageToken — ' +
  'it matches the nextPageToken field in the response.',
);

// The one place the alias collapses into a single value.
export function resolvePageToken(p: { pageToken?: string; page?: string }): string | undefined {
  return p.pageToken ?? p.page;
}

// Pagination params — appear in 30+ tools across base + extras.
export const paginationParams = {
  max: z.number().int().optional().describe('Max results'),
  pageToken: pageTokenParam,
  page: pageAliasParam,
  all: z.boolean().optional().describe('Fetch all pages'),
};

// Append pagination flags to an argv array. Mirrors the shape of
// paginationParams above. Use together to keep call sites concise.
export function pushPaginationFlags(
  args: string[],
  p: { max?: number; pageToken?: string; page?: string; all?: boolean },
): void {
  if (p.max !== undefined) args.push(`--max=${p.max}`);
  const token = resolvePageToken(p);
  if (token) args.push(`--page=${token}`);
  if (p.all) args.push('--all');
}

// Register a `gog_<service>_run` escape-hatch tool. 11 services currently
// register an identical-shape tool; this factory keeps them in lockstep.
// Pass `omitAccount: true` only for auth, which doesn't take --account.
export function registerRunTool(
  server: McpServer,
  options: {
    service: string;
    examples: string;
    omitAccount?: boolean;
    /** Extra sentence appended to the description (used by auth to point to gog_auth_add). */
    note?: string;
  },
): void {
  const { service, examples, omitAccount = false, note } = options;
  const baseDescription = `Run any gog ${service} subcommand not covered by the other tools. Run \`gog ${service} --help\` for the full list of subcommands, or \`gog ${service} <subcommand> --help\` for flags on a specific subcommand.`;
  const description = note ? `${baseDescription} ${note}` : baseDescription;
  const inputSchema: Record<string, z.ZodTypeAny> = {
    subcommand: z.string().describe(`The gog ${service} subcommand to run, e.g. ${examples}`),
    args: z.array(z.string()).describe('Additional positional args and flags'),
  };
  if (!omitAccount) {
    inputSchema.account = accountParam;
  }
  server.registerTool(`gog_${service}_run`, {
    description,
    annotations: { destructiveHint: true },
    inputSchema,
  }, async (rawArgs) => {
    const { subcommand, args, account } = rawArgs as { subcommand: string; args: string[]; account?: string };
    return runOrDiagnose([service, subcommand, ...args], { account });
  });
}

// The fleet-standard error text for a thrown value ("Error: <message>").
// Pair with mcp-utils errorResult (which redacts secrets and sets
// `isError: true`) when the text is the whole tool result.
export function errorText(err: unknown): string {
  return err instanceof Error ? `Error: ${err.message}` : String(err);
}

// Google saying "not authenticated" in its own words. Definitive: a retry
// cannot turn a 401 into a success, so this outranks the transient signal below.
// `unauthorized` and `invalid_grant` are unambiguous words, but 401 is also
// just an integer, and gog's output is full of integers that are row indices,
// ranges and counts. A bare `\b401\b` classified "row 401 is outside the sheet
// grid" — a pure Sheets range error — as a definite auth failure and sent the
// caller off to re-authorize a healthy account. So a 401 has to look like a
// STATUS: introduced by a status-ish word.
//
// THE SEPARATOR IS THE WHOLE DIFFICULTY (#246). The first attempt used
// `\s*[:=]?\s*`, which cannot cross an opening paren or a JSON quote — so it
// silently stopped matching the CANONICAL shape gog emits for a Google auth
// failure, `Google API error (401 authError)`, and JSON bodies like
// `{"code": 401}`. That regression is strictly worse than the false positive it
// was fixing: a false positive costs a pointless re-auth, but a real dead
// credential with no hint at all leaves the caller with nothing to act on.
//
// So the separator admits the punctuation those shapes actually use — quote,
// paren, colon, equals, comma, space — and is CAPPED at 4 characters so a status
// word cannot reach across prose to an unrelated integer ("error: could not
// write row 401" must stay silent). `A401:B401` never matched anyway: there is
// no word boundary after `A`.
const DEFINITE_AUTH_PATTERN =
  /\b(?:unauthorized|invalid_grant)\b|\b(?:error|status|code|http|responded|response)["']?[\s:=(,]{0,4}401\b/i;

// A message that TALKS about an expired token. Suggestive, not definitive — and
// it used to be `/token.*(expired|revoked)/`, whose greedy `.*` matched a token
// mentioned anywhere and an expiry mentioned anywhere later in the same line
// ("page token accepted; the export link has expired"). Now the two words must
// actually be about each other.
const STALE_TOKEN_PATTERN = /\b(?:access[ _-]?)?token\b[^.;\n]{0,40}\b(?:has\s+)?(?:been\s+)?(?:expired|revoked)\b|\b(?:expired|revoked)\s+(?:access[ _-]?)?token\b/i;

const AUTH_ERROR_PATTERN = new RegExp(`${DEFINITE_AUTH_PATTERN.source}|${STALE_TOKEN_PATTERN.source}`, 'i');

// A DEAD refresh token — the whole account is signed out, not just a stale
// access token that would refresh silently. This is the recurring account-wide
// failure, so it gets its own plain-English cause + durable fix, distinct from
// the generic 401/unauthorized case.
const INVALID_GRANT_PATTERN = /invalid_grant|token has been expired or revoked/i;

const TRANSIENT_ERROR_PATTERN =
  /\b429\b|\b5\d\d\b|\bquota\b|rateLimit|\bDEADLINE_EXCEEDED\b/i;

// gogcli rejects writes whose range falls outside the sheet's current grid
// (e.g. writing to column AP on a 41-column sheet) with a "exceeds grid limits"
// error and no remediation. Point the caller at the tool that grows the grid.
const GRID_LIMIT_ERROR_PATTERN = /exceeds grid limits/i;

const AUTH_HINT =
  '\n\nAuthentication may have expired. Use gog_auth_add to re-authorize the account. ' +
  'Ask the user if they would like to re-authenticate.';

// invalid_grant means the stored REFRESH token was rejected, so re-auth is
// mandatory (no silent recovery) and it will recur unless the root cause is
// fixed. Name the most common cause (the 7-day limit Google puts on OAuth apps
// still in "Testing"), offer both re-auth paths (browser + remote/headless),
// and point at the durable fix. Keeps the literal `gog_auth_add` token so the
// generic auth-recovery guidance still applies.
const INVALID_GRANT_HINT =
  '\n\nThe stored refresh token was rejected (invalid_grant): it has expired or been revoked, so the ' +
  'whole account is signed out and re-authorization is required. The most common cause is the 7-day ' +
  'refresh-token limit Google applies to OAuth apps whose consent screen is still in "Testing" mode. ' +
  'Re-authorize with gog_auth_add (opens a browser) or gog_auth_add_url + gog_auth_add_complete (remote/headless). ' +
  'To stop this recurring, publish the OAuth consent screen to "In production" in the Google Cloud project ' +
  'that owns the OAuth client. Ask the user if they would like to re-authenticate.';

const TRANSIENT_HINT =
  '\n\nThis error is often transient. Retry the same call before trying a different approach ' +
  '(do not fall back to smaller writes or row-by-row operations).';

const GRID_LIMIT_HINT =
  '\n\nThe target range is outside the sheet\'s current grid. Add the missing rows or columns ' +
  'first with gog_sheets_insert (dimension: rows or cols), then retry the write.';

// The hint for each RUNNER-authored failure kind (see RunnerTransportError in
// runner.ts). These are chosen by the error's TYPE, never by reading its text.
//
// transport-auth is the one that motivated all of this. The runner answers a
// bad bearer with the single word "unauthorized"; read as prose that is
// indistinguishable from Google rejecting a credential, and the caller was
// being told all session to re-authorize an account that had never been asked
// for anything. So this hint names the real cause and says outright that
// re-authorizing cannot help. It deliberately does NOT contain the literal
// `gog_auth_add`, which is the token the rest of the auth guidance keys on.
const RUNNER_TRANSPORT_AUTH_HINT =
  '\n\nThis is the CONNECTOR\'s own transport auth failing, not your Google sign-in. The gog-runner ' +
  'backend rejected the bearer token this server sent, so the request never reached gog and no Google ' +
  'credential was checked — the Google account is not the problem and re-authorizing it cannot fix this. ' +
  'An operator must make the Worker secret GOG_RUNNER_KEY equal RUNNER_KEY on the Fly app ' +
  '(wrangler secret put GOG_RUNNER_KEY / fly secrets set RUNNER_KEY), then retry.';

const RUNNER_TRANSPORT_HINTS: Record<RunnerFailureKind, string> = {
  'transport-auth': RUNNER_TRANSPORT_AUTH_HINT,
  // The request itself was malformed, so the runner will refuse it identically
  // every time. Nothing to advise beyond the message the runner already gave.
  'transport-request': '',
  'transport-retryable': TRANSIENT_HINT,
};

// Reduce `gog auth list --json` output to just the configured email addresses.
// The raw JSON also carries OAuth scopes, the Google subject id, and creation
// timestamps — none of which belong in an error surfaced to the model, and
// which were previously echoed verbatim on every failure. Falls back to the
// trimmed raw text if the output isn't the expected JSON shape (e.g. a plain
// email string), so unexpected output still degrades gracefully.
export function formatAccountList(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { accounts?: unknown };
    if (Array.isArray(parsed?.accounts)) {
      return parsed.accounts
        .map((a) => (a as { email?: string })?.email)
        .filter(Boolean)
        .join('\n');
    }
  } catch {
    // not JSON — fall through to the raw text
  }
  return raw.trim();
}

// Turn a thrown error into a diagnosed error result (`isError: true`): the
// error text, an actionable hint when the failure class is recognised (auth /
// transient / off-grid write), and the list of configured accounts. Callers
// that need to surface a failure without going through runOrDiagnose (e.g. a
// pre-write verification read that must abort) can reuse this so the error
// keeps the same diagnostic quality as everywhere else.
export async function diagnose(err: unknown): Promise<CallToolResult> {
  const errText = errorText(err);

  // STRUCTURE BEFORE PROSE. A RunnerTransportError is this connector's own
  // transport failing — its bearer, its request validation, its drain. Nothing
  // was shown to Google, so none of the patterns below may be consulted for it:
  // they exist to read gog's/Google's words, and the runner's words are not
  // those. Read as prose, the runner's `unauthorized` matched
  // DEFINITE_AUTH_PATTERN and produced AUTH_HINT — a human being told to
  // re-authorize a healthy account over what was really a key mismatch.
  //
  // This short-circuits the ladder rather than joining it, so it is not a new
  // rung in the precedence order documented below; that order still governs
  // every error that genuinely came from gog.
  const transportHint = isRunnerTransportError(err)
    ? RUNNER_TRANSPORT_HINTS[err.kind]
    : undefined;

  const isInvalidGrant = INVALID_GRANT_PATTERN.test(errText);

  // Precedence, and the reason for it. Reporting needs-auth is EXPENSIVE to be
  // wrong about: re-authorization is a manual, human step, and it does not fix
  // a 429. So a transient signal beats a merely SUGGESTIVE auth signal (a
  // message that mentions an expired token) — the reported bug was servers
  // flapping into needs-auth and working again seconds later, which is what
  // being told to re-auth over a rate-limit looks like.
  //
  // It does NOT beat a definitive one. A literal 401 or invalid_grant is Google
  // saying the credential will not work, and calling that "retry" would loop a
  // caller forever against a request that can never succeed.
  const isTransientError = !DEFINITE_AUTH_PATTERN.test(errText) && TRANSIENT_ERROR_PATTERN.test(errText);
  const isAuthError = !isTransientError && AUTH_ERROR_PATTERN.test(errText);
  const isGridLimitError = GRID_LIMIT_ERROR_PATTERN.test(errText);
  // `??`, not `||`: 'transport-request' maps to the empty string on purpose —
  // "this failure is ours and there is nothing to advise" — and `||` would fall
  // through to the prose ladder for exactly the errors that must never reach it.
  const hint = transportHint ?? (isInvalidGrant
    ? INVALID_GRANT_HINT
    : isAuthError
      ? AUTH_HINT
      : isTransientError
        ? TRANSIENT_HINT
        : isGridLimitError
          ? GRID_LIMIT_HINT
          : '');
  try {
    const accounts = formatAccountList(await run(['auth', 'list']));
    return errorResult(`${errText}\n\nConfigured accounts:\n${accounts || '(none)'}${hint}`);
  } catch {
    return errorResult(`${errText}${hint}`);
  }
}

export async function runOrDiagnose(
  args: GogArg[],
  options: { account?: string; lossless?: boolean },
): Promise<CallToolResult> {
  try {
    // The single seam every tool's output passes through. Normalizing here —
    // rather than at each call site — is what makes it impossible for a tool to
    // emit a naive, zone-less timestamp.
    //
    // `lossless` opts a tool out. The `*_raw` dumps promise a verbatim copy of
    // the upstream API response: normalizing them would rewrite the API's own
    // epoch-millis `internalDate` into an ISO string and flatten the caller's
    // `--pretty` formatting, so the one tool you reach for when you need ground
    // truth would stop telling it. Losslessness wins over presentation there —
    // the friendlier views of the same data are already normalized.
    const raw = await run(args, options);
    // Same seam, same reason as normalizeTimestamps: doing this per call site
    // would let one paginated tool forget and go on reporting a spent cursor as
    // if it were a live one. `lossless` opts the raw dumps out of both.
    return rawTextResult(options.lossless ? raw : stripConsumedPageToken(normalizeTimestamps(raw)));
  } catch (err) {
    return diagnose(err);
  }
}

// Google puts a 7-day cap on refresh tokens issued by OAuth apps whose consent
// screen is still in "Testing" — the recurring account-wide sign-out this tool
// exists to warn about. Once the token is this old and still valid, expiry is
// imminent, so surface it before it becomes a hard failure mid-task.
const REFRESH_TOKEN_TESTING_TTL_DAYS = 7;
const HEALTH_WARN_AGE_DAYS = 6;
const MS_PER_DAY = 86_400_000;

interface AuthHealthAccount {
  email?: string;
  created_at?: string;
  valid?: boolean;
  error?: string;
}

// Days between an ISO timestamp and `now`, or null if unparseable/absent.
function ageInDays(createdAt: string | undefined, now: number): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  return (now - t) / MS_PER_DAY;
}

function formatOneAccountHealth(a: AuthHealthAccount, now: number): string {
  const email = a.email ?? '(unknown account)';
  const age = ageInDays(a.created_at, now);
  const ageStr = age === null ? '' : ` Authorized ${age.toFixed(1)} day(s) ago.`;

  if (a.valid === false) {
    // Map the dead-refresh-token error to a plain cause; fall back to the raw
    // (already token-redacted by run()) error for anything else.
    const cause = INVALID_GRANT_PATTERN.test(a.error ?? '')
      ? 'refresh token expired or revoked — commonly the 7-day limit on OAuth consent screens still in "Testing" mode'
      : (a.error?.trim() || 'unknown error');
    return `✗ ${email}: NEEDS RE-AUTH — ${cause}.${ageStr} ` +
      'Re-authorize with gog_auth_add (browser) or gog_auth_add_url + gog_auth_add_complete (remote/headless).';
  }

  if (a.valid === true) {
    let line = `✓ ${email}: token valid.${ageStr}`;
    if (age !== null && age >= HEALTH_WARN_AGE_DAYS) {
      const est = new Date(Date.parse(a.created_at as string) + REFRESH_TOKEN_TESTING_TTL_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      line += ` ⚠ Approaching the 7-day refresh-token limit for OAuth apps in "Testing" mode ` +
        `(if that applies, expect expiry around ${est}). Re-authorize soon, or publish the OAuth ` +
        'consent screen to "In production" to stop the weekly expiry.';
    }
    return line;
  }

  // valid absent — the caller ran without --check (or gog omitted the field).
  return `? ${email}: token validity unknown.${ageStr} Run this check again to probe it live.`;
}

// Turn `gog auth list --check --json` into a per-account health summary:
// validity, a mapped cause for dead tokens, token age, and a pre-expiry warning
// near the 7-day testing-mode cliff. Only email/created_at/valid/error are read
// — scopes/subject never appear in the summary. Falls back to trimmed raw text
// when the output isn't the expected JSON shape.
export function formatAuthHealth(raw: string, now: number): string {
  let accounts: AuthHealthAccount[];
  try {
    const parsed = JSON.parse(raw) as { accounts?: unknown };
    if (!Array.isArray(parsed?.accounts)) return raw.trim();
    accounts = parsed.accounts as AuthHealthAccount[];
  } catch {
    return raw.trim();
  }
  if (accounts.length === 0) {
    return 'No Google accounts are configured. Use gog_auth_add to authorize one.';
  }
  return accounts.map((a) => formatOneAccountHealth(a, now)).join('\n\n');
}
