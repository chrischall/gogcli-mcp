import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as runner from '../../src/runner.js';
import { runOrDiagnose } from '../../src/tools/utils.js';

vi.mock('../../src/runner.js');

beforeEach(() => vi.clearAllMocks());

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
});
