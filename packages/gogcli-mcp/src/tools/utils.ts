import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { errorResult, rawTextResult } from '@chrischall/mcp-utils';
import { run } from '../runner.js';
import type { GogArg } from '../runner.js';

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

// Pagination param triple — appears in 20+ tools across base + extras.
export const paginationParams = {
  max: z.number().int().optional().describe('Max results'),
  page: z.string().optional().describe('Page token'),
  all: z.boolean().optional().describe('Fetch all pages'),
};

// Append pagination flags to an argv array. Mirrors the shape of
// paginationParams above. Use together to keep call sites concise.
export function pushPaginationFlags(
  args: string[],
  p: { max?: number; page?: string; all?: boolean },
): void {
  if (p.max !== undefined) args.push(`--max=${p.max}`);
  if (p.page) args.push(`--page=${p.page}`);
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

const AUTH_ERROR_PATTERN = /\b(401|unauthorized|token.*(expired|revoked)|invalid_grant)\b/i;

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
  const isInvalidGrant = INVALID_GRANT_PATTERN.test(errText);
  const isAuthError = AUTH_ERROR_PATTERN.test(errText);
  const isTransientError = !isAuthError && TRANSIENT_ERROR_PATTERN.test(errText);
  const isGridLimitError = GRID_LIMIT_ERROR_PATTERN.test(errText);
  const hint = isInvalidGrant
    ? INVALID_GRANT_HINT
    : isAuthError
      ? AUTH_HINT
      : isTransientError
        ? TRANSIENT_HINT
        : isGridLimitError
          ? GRID_LIMIT_HINT
          : '';
  try {
    const accounts = formatAccountList(await run(['auth', 'list']));
    return errorResult(`${errText}\n\nConfigured accounts:\n${accounts || '(none)'}${hint}`);
  } catch {
    return errorResult(`${errText}${hint}`);
  }
}

export async function runOrDiagnose(
  args: GogArg[],
  options: { account?: string },
): Promise<CallToolResult> {
  try {
    return rawTextResult(await run(args, options));
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
