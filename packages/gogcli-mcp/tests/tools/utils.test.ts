import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as runner from '../../src/runner.js';
import { runOrDiagnose, pushPaginationFlags, formatAccountList, formatAuthHealth } from '../../src/tools/utils.js';
import { RunnerTransportError } from '../../src/connector-runtime.js';

// PARTIAL mock: only `run` is stubbed. A full automock would also replace
// `RunnerTransportError` and `isRunnerTransportError`, and diagnose()'s whole
// point is that it classifies the REAL class structurally — an automocked
// brand check answers undefined for everything and the tests below would pass
// while proving nothing.
vi.mock('../../src/runner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof runner>()),
  run: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe('pushPaginationFlags', () => {
  it('does nothing when no fields are provided', () => {
    const args: string[] = ['cmd'];
    pushPaginationFlags(args, {});
    expect(args).toEqual(['cmd']);
  });

  it('pushes --max when a number is provided (including 0)', () => {
    const args: string[] = ['cmd'];
    pushPaginationFlags(args, { max: 0 });
    expect(args).toEqual(['cmd', '--max=0']);
  });

  it('pushes --page when a string is provided', () => {
    const args: string[] = ['cmd'];
    pushPaginationFlags(args, { page: 'tok' });
    expect(args).toEqual(['cmd', '--page=tok']);
  });

  it('pushes --all only when true', () => {
    const args: string[] = ['cmd'];
    pushPaginationFlags(args, { all: false });
    expect(args).toEqual(['cmd']);
    pushPaginationFlags(args, { all: true });
    expect(args).toEqual(['cmd', '--all']);
  });

  it('pushes all three in canonical order', () => {
    const args: string[] = ['cmd'];
    pushPaginationFlags(args, { max: 50, page: 'tok', all: true });
    expect(args).toEqual(['cmd', '--max=50', '--page=tok', '--all']);
  });
});

describe('formatAccountList', () => {
  const AUTH_LIST_JSON = JSON.stringify({
    accounts: [
      {
        email: 'chris.c.hall@gmail.com',
        subject: '109876543210987654321',
        client: 'default',
        services: ['gmail', 'drive'],
        scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive'],
        created_at: '2026-01-02T03:04:05Z',
      },
    ],
  });

  it('reduces gog auth list JSON to email addresses only', () => {
    const out = formatAccountList(AUTH_LIST_JSON);
    expect(out).toBe('chris.c.hall@gmail.com');
    // none of the sensitive fields leak through
    expect(out).not.toContain('scopes');
    expect(out).not.toContain('gmail.modify');
    expect(out).not.toContain('109876543210987654321');
    expect(out).not.toContain('created_at');
  });

  it('joins multiple account emails with newlines', () => {
    const out = formatAccountList(JSON.stringify({ accounts: [{ email: 'a@x.com' }, { email: 'b@y.com' }] }));
    expect(out).toBe('a@x.com\nb@y.com');
  });

  it('skips accounts with no email', () => {
    const out = formatAccountList(JSON.stringify({ accounts: [{ email: 'a@x.com' }, { client: 'other' }] }));
    expect(out).toBe('a@x.com');
  });

  it('falls back to the trimmed raw text when not parseable JSON', () => {
    expect(formatAccountList('  user@gmail.com\n')).toBe('user@gmail.com');
  });

  it('falls back to raw text when JSON has no accounts array', () => {
    expect(formatAccountList('{"foo":1}')).toBe('{"foo":1}');
  });

  it('falls back to raw text when parsed JSON is null', () => {
    expect(formatAccountList('null')).toBe('null');
  });
});

describe('runOrDiagnose', () => {
  it('returns output text on success (not flagged as an error)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"ok":true}');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe('{"ok":true}');
    expect(result.isError).toBeUndefined();
  });

  // The `*_raw` dumps promise a verbatim copy of the upstream API response.
  // Normalizing them would rewrite the API's own epoch-millis internalDate into
  // an ISO string and flatten the caller's --pretty formatting, so the one tool
  // you reach for when you need ground truth would stop telling it.
  it('leaves a lossless response byte-for-byte untouched', async () => {
    const raw = '{\n  "id": "m1",\n  "internalDate": "1785209760000"\n}';
    vi.mocked(runner.run).mockResolvedValue(raw);
    const result = await runOrDiagnose(['gmail', 'raw', 'm1'], { lossless: true });
    expect(result.content[0].text).toBe(raw);
  });

  it('normalizes timestamps when lossless is not set', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"internalDate":"1785209760000"}');
    const result = await runOrDiagnose(['gmail', 'messages'], {});
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.internalDate).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(parsed.internalDateDisplay).toBeDefined();
  });

  // Formatting whitespace is roughly a fifth of a large gog response and
  // carries no information: gog pretty-prints its --json output, and nothing
  // downstream reads the indent. Measured at 18.6% of a 19 KB `drive ls`.
  it('minifies gog\'s pretty-printed JSON on the normal path', async () => {
    vi.mocked(runner.run).mockResolvedValue('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    const result = await runOrDiagnose(['drive', 'ls'], {});
    expect(result.content[0].text).toBe('{"a":1,"b":[2,3]}');
  });

  // Only FORMATTING whitespace goes. Whitespace inside a value is content —
  // the blank line between paragraphs of a mail body — and JSON.stringify
  // leaves every byte of it alone. A regex over the serialised text would
  // corrupt exactly the payloads this is meant to shrink.
  it('preserves whitespace INSIDE string values', async () => {
    const body = 'Hi,\n\n  indented quote\n\nthanks';
    vi.mocked(runner.run).mockResolvedValue(JSON.stringify({ body }, null, 2));
    const result = await runOrDiagnose(['gmail', 'get'], {});
    expect(JSON.parse(result.content[0].text as string).body).toBe(body);
  });

  // ofw-mcp emits paging state before its data array so a truncated read still
  // sees it; the same reasoning applies to gog's nextPageToken. JSON.stringify
  // preserves insertion order, so minifying must not reorder anything.
  it('preserves key order', async () => {
    vi.mocked(runner.run).mockResolvedValue('{\n  "nextPageToken": "t",\n  "files": []\n}');
    const result = await runOrDiagnose(['drive', 'ls'], {});
    expect(result.content[0].text).toBe('{"nextPageToken":"t","files":[]}');
  });

  // gog does not always answer in JSON — `gog auth list` is plain text, and an
  // empty body is legal. Minification must pass anything unparseable through
  // untouched rather than mangling it or throwing.
  it('passes non-JSON output through untouched', async () => {
    for (const text of ['user@gmail.com\nother@gmail.com', '', '   ', 'not json {']) {
      vi.mocked(runner.run).mockResolvedValue(text);
      const result = await runOrDiagnose(['auth', 'list'], {});
      expect(result.content[0].text).toBe(text);
    }
  });

  // The lossless dumps are the rung a person reaches for when a payload is not
  // what they expected, and indentation is most of what makes an unfamiliar
  // shape legible — the same asymmetry mcp-utils' viewResult applies to `raw`.
  it('does NOT minify a lossless response', async () => {
    const raw = '{\n  "id": "m1"\n}';
    vi.mocked(runner.run).mockResolvedValue(raw);
    const result = await runOrDiagnose(['gmail', 'raw', 'm1'], { lossless: true });
    expect(result.content[0].text).toBe(raw);
  });

  it('appends auth list on non-auth failure', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe(
      'Error: Doc not found\n\nConfigured accounts:\nuser@gmail.com',
    );
    // mcp-utils errorResult flags diagnosed failures for the client.
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('gog_auth_add');
  });

  it('redacts scopes/subject/timestamps from the configured-accounts block', async () => {
    const authListJson = JSON.stringify({
      accounts: [{
        email: 'chris.c.hall@gmail.com',
        subject: '109876543210987654321',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
        created_at: '2026-01-02T03:04:05Z',
      }],
    });
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('refusing to delete gmail draft r123 without --force (non-interactive)'))
      .mockResolvedValueOnce(authListJson);
    const result = await runOrDiagnose(['gmail', 'drafts', 'delete', 'r123'], {});
    const text = result.content[0].text;
    expect(text).toContain('Configured accounts:\nchris.c.hall@gmail.com');
    expect(text).not.toContain('scopes');
    expect(text).not.toContain('gmail.modify');
    expect(text).not.toContain('109876543210987654321');
    expect(text).not.toContain('created_at');
  });

  it('shows (none) when no accounts are configured', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'))
      .mockResolvedValueOnce('{"accounts":[]}');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe('Error: Doc not found\n\nConfigured accounts:\n(none)');
  });

  it('appends re-auth hint on 401 error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 401'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'comments', 'list', 'abc'], {});
    expect(result.content[0].text).toContain('Error: Request failed with status 401');
    expect(result.content[0].text).toContain('Configured accounts:\nuser@gmail.com');
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('appends re-auth hint on "unauthorized" error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('unauthorized access'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('appends re-auth hint on "token expired" error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('token has been expired or revoked'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('appends re-auth hint on "invalid_grant" error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('invalid_grant'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('calls a rate-limited failure transient even though it says "token expired"', async () => {
    // The reported symptom was servers flapping into a needs-auth state and
    // then working seconds later. Telling someone to re-authorize an account
    // whose credential is fine is the expensive kind of wrong: re-auth is
    // manual, and it does not fix a 429.
    //
    // `invalid_grant` is exempt from this and stays auth (below) — it is the
    // one signal that definitively means the refresh token is dead.
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('429 rateLimitExceeded: the access token expired mid-request, retry'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'A1'], {});
    const text = result.content[0].text as string;
    expect(text).toContain('often transient');
    expect(text).not.toContain('gog_auth_add');
  });

  it('still calls an explicit 401 an auth error even alongside a transient signal', async () => {
    // The exemption above is for the LOOSE match only. A literal 401 is Google
    // saying "not authenticated", and downgrading that to "retry" would loop a
    // caller forever against a request that can never succeed.
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('401 unauthorized (quota project unset)'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'A1'], {});
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('does not read "token" and "expired" as auth when they are unrelated sentences', async () => {
    // The pattern was /token.*(expired|revoked)/ with a greedy `.*`, so any
    // message mentioning a token anywhere and an expiry anywhere later — across
    // whole paragraphs — was reported as an auth failure.
    vi.mocked(runner.run)
      // Deliberately ONE line: `.` does not cross newlines, so a multi-line
      // message would pass this test without the greedy match ever being
      // exercised — and gog's real errors are frequently one long line.
      .mockRejectedValueOnce(
        new Error('page token accepted; the requested export link has expired and must be regenerated'),
      )
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['drive', 'export', 'abc'], {});
    expect(result.content[0].text).not.toContain('gog_auth_add');
  });

  it('gives invalid_grant a richer hint than a plain 401: cause + durable fix + both re-auth paths', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('oauth2: "invalid_grant" "Token has been expired or revoked."'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['gmail', 'search', 'is:unread'], {});
    const text = result.content[0].text as string;
    // plain-English cause
    expect(text).toContain('7-day');
    expect(text).toContain('Testing');
    // both re-auth paths
    expect(text).toContain('gog_auth_add_url');
    // durable fix
    expect(text).toContain('In production');
  });

  it('does NOT give a plain 401 the invalid_grant durable-fix text', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 401'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    const text = result.content[0].text as string;
    expect(text).toContain('gog_auth_add');
    expect(text).not.toContain('In production');
  });

  it('returns plain error with auth hint when auth list also fails on auth error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 401'))
      .mockRejectedValueOnce(new Error('auth list failed'));
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toContain('Error: Request failed with status 401');
    expect(result.content[0].text).toContain('gog_auth_add');
    expect(result.content[0].text).not.toContain('Configured accounts');
  });

  it('returns plain error when auth list also fails on non-auth error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'))
      .mockRejectedValueOnce(new Error('auth list failed'));
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe('Error: Doc not found');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('gog_auth_add');
  });

  it('appends transient-retry hint on 429 error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 429'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
    expect(result.content[0].text).toContain('transient');
    expect(result.content[0].text).toContain('Retry');
  });

  it('appends transient-retry hint on 500/502/503/504 errors', async () => {
    for (const status of [500, 502, 503, 504]) {
      vi.clearAllMocks();
      vi.mocked(runner.run)
        .mockRejectedValueOnce(new Error(`Request failed with status ${status}`))
        .mockResolvedValueOnce('user@gmail.com');
      const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
      expect(result.content[0].text, `status ${status}`).toContain('transient');
    }
  });

  it('appends transient-retry hint on quota/rateLimit errors', async () => {
    for (const msg of ['Quota exceeded', 'rateLimitExceeded', 'userRateLimitExceeded']) {
      vi.clearAllMocks();
      vi.mocked(runner.run)
        .mockRejectedValueOnce(new Error(msg))
        .mockResolvedValueOnce('user@gmail.com');
      const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
      expect(result.content[0].text, msg).toContain('transient');
    }
  });

  it('appends transient-retry hint on DEADLINE_EXCEEDED error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('DEADLINE_EXCEEDED: context deadline exceeded'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
    expect(result.content[0].text).toContain('transient');
  });

  it('does not append transient hint on 404 error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 404'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'abc', 'A1'], {});
    expect(result.content[0].text).not.toContain('transient');
  });

  it('does not append transient hint on auth (401) error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 401'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toContain('gog_auth_add');
    expect(result.content[0].text).not.toContain('transient');
  });

  it('keeps transient hint when auth list also fails', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 503'))
      .mockRejectedValueOnce(new Error('auth list failed'));
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
    expect(result.content[0].text).toContain('transient');
    expect(result.content[0].text).not.toContain('Configured accounts');
  });

  it('appends grid-limit hint pointing at gog_sheets_insert', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Range (Sheet1!AP1:AW1) exceeds grid limits. Max rows: 1000, max columns: 41'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'AP1'], {});
    expect(result.content[0].text).toContain('exceeds grid limits');
    expect(result.content[0].text).toContain('gog_sheets_insert');
  });

  it('does not append grid-limit hint on unrelated errors', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Spreadsheet not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
    expect(result.content[0].text).not.toContain('gog_sheets_insert');
  });

  it('keeps grid-limit hint when auth list also fails', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('exceeds grid limits. Max rows: 1000, max columns: 41'))
      .mockRejectedValueOnce(new Error('auth list failed'));
    const result = await runOrDiagnose(['sheets', 'update', 'abc', 'A1'], {});
    expect(result.content[0].text).toContain('gog_sheets_insert');
    expect(result.content[0].text).not.toContain('Configured accounts');
  });
});

describe('formatAuthHealth', () => {
  const NOW = Date.parse('2026-07-24T12:00:00.000Z');

  it('flags a dead (invalid_grant) token with a mapped cause, age, and re-auth paths', () => {
    const raw = JSON.stringify({
      accounts: [{
        email: 'chris.c.hall@gmail.com',
        created_at: '2026-07-17T12:00:00.000Z',
        valid: false,
        error: 'refresh access token: oauth2: "invalid_grant" "Token has been expired or revoked."',
      }],
    });
    const out = formatAuthHealth(raw, NOW);
    expect(out).toContain('✗ chris.c.hall@gmail.com: NEEDS RE-AUTH');
    expect(out).toContain('7-day limit');
    expect(out).toContain('Authorized 7.0 day(s) ago');
    expect(out).toContain('gog_auth_add_url');
    // never echoes token material
    expect(out).not.toContain('access token');
  });

  it('warns a still-valid token as it nears the 7-day testing cliff (with estimated expiry)', () => {
    const raw = JSON.stringify({
      accounts: [{ email: 'a@x.com', created_at: '2026-07-18T00:00:00.000Z', valid: true }],
    });
    const out = formatAuthHealth(raw, NOW);
    expect(out).toContain('✓ a@x.com: token valid');
    expect(out).toContain('⚠');
    expect(out).toContain('Approaching the 7-day');
    expect(out).toContain('2026-07-25'); // created_at + 7d
    expect(out).toContain('In production');
  });

  it('does not warn a freshly authorized valid token', () => {
    const raw = JSON.stringify({
      accounts: [{ email: 'a@x.com', created_at: '2026-07-23T12:00:00.000Z', valid: true }],
    });
    const out = formatAuthHealth(raw, NOW);
    expect(out).toContain('✓ a@x.com: token valid');
    expect(out).toContain('Authorized 1.0 day(s) ago');
    expect(out).not.toContain('⚠');
  });

  it('uses the raw error for a non-invalid_grant invalid token', () => {
    const raw = JSON.stringify({
      accounts: [{ email: 'a@x.com', created_at: '2026-07-23T12:00:00.000Z', valid: false, error: 'network unreachable' }],
    });
    expect(formatAuthHealth(raw, NOW)).toContain('NEEDS RE-AUTH — network unreachable.');
  });

  it('says "unknown error" for an invalid token with no error field', () => {
    const raw = JSON.stringify({ accounts: [{ email: 'a@x.com', valid: false }] });
    expect(formatAuthHealth(raw, NOW)).toContain('NEEDS RE-AUTH — unknown error.');
  });

  it('reports unknown validity when the --check field is absent', () => {
    const raw = JSON.stringify({ accounts: [{ email: 'a@x.com', created_at: '2026-07-23T12:00:00.000Z' }] });
    const out = formatAuthHealth(raw, NOW);
    expect(out).toContain('? a@x.com: token validity unknown');
    expect(out).toContain('Authorized 1.0 day(s) ago');
  });

  it('omits the age when created_at is missing or unparseable', () => {
    expect(formatAuthHealth(JSON.stringify({ accounts: [{ email: 'a@x.com', valid: true }] }), NOW))
      .not.toContain('Authorized');
    expect(formatAuthHealth(JSON.stringify({ accounts: [{ email: 'a@x.com', created_at: 'not-a-date', valid: true }] }), NOW))
      .not.toContain('Authorized');
  });

  it('falls back to a friendly line when no accounts are configured', () => {
    expect(formatAuthHealth(JSON.stringify({ accounts: [] }), NOW))
      .toBe('No Google accounts are configured. Use gog_auth_add to authorize one.');
  });

  it('labels an account with no email', () => {
    expect(formatAuthHealth(JSON.stringify({ accounts: [{ valid: true }] }), NOW))
      .toContain('✓ (unknown account): token valid');
  });

  it('falls back to trimmed raw text when the output is not the expected JSON', () => {
    expect(formatAuthHealth('  not json\n', NOW)).toBe('not json');
    expect(formatAuthHealth('{"foo":1}', NOW)).toBe('{"foo":1}');
  });
});

// The connector's own transport failing is NOT the Google credential failing.
// diagnose() must recognise that structurally, from the error's type, because
// the runner's prose ("unauthorized") is indistinguishable from Google's.
describe('diagnose: runner-authored transport failures', () => {
  it('blames the runner key, not the Google account, for a transport-auth failure', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(
        new RunnerTransportError('gog-runner rejected the bearer token; GOG_RUNNER_KEY vs RUNNER_KEY', 'transport-auth', 401),
      )
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'A1'], {});
    const text = result.content[0].text as string;
    expect(text).not.toContain('gog_auth_add');
    expect(text).not.toMatch(/re-authorize the account/i);
    expect(text).toContain('GOG_RUNNER_KEY');
    expect(text).toContain('RUNNER_KEY');
  });

  it('lets the TYPE beat the prose: runner words that read like Google words get no re-auth hint', async () => {
    // The regression this whole change exists to prevent. A runner-authored
    // failure whose text happens to contain every Google auth signal must still
    // not produce Google auth advice — the request never reached Google.
    vi.mocked(runner.run)
      .mockRejectedValueOnce(
        new RunnerTransportError('unauthorized: 401 invalid_grant, token has been expired or revoked', 'transport-request', 400),
      )
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'A1'], {});
    const text = result.content[0].text as string;
    expect(text).not.toContain('gog_auth_add');
    expect(text).not.toContain('often transient');
  });

  it('advises a retry for a retryable transport failure', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new RunnerTransportError('gog-runner is restarting; retry this call.', 'transport-retryable', 503))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['sheets', 'get', 'A1'], {});
    const text = result.content[0].text as string;
    expect(text).toContain('often transient');
    expect(text).not.toContain('gog_auth_add');
  });
});
