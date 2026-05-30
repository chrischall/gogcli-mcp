import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as runner from '../../src/runner.js';
import { runOrDiagnose, pushPaginationFlags, formatAccountList } from '../../src/tools/utils.js';

vi.mock('../../src/runner.js');

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
  it('returns output text on success', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"ok":true}');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe('{"ok":true}');
  });

  it('appends auth list on non-auth failure', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const result = await runOrDiagnose(['docs', 'cat', 'abc'], {});
    expect(result.content[0].text).toBe(
      'Error: Doc not found\n\nConfigured accounts:\nuser@gmail.com',
    );
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
