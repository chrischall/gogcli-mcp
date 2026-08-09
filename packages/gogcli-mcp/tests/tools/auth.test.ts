import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAuthTools, authToolsFor } from '../../src/tools/auth.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerAuthTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_auth_list', () => {
  it('calls run with auth list args', async () => {
    vi.mocked(runner.run).mockResolvedValue('user@gmail.com\nadmin@example.com');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_list', {});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'list']);
    expect(result.content[0].text).toBe('user@gmail.com\nadmin@example.com');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('No accounts configured'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_list', {});
    expect(result.content[0].text).toBe('Error: No accounts configured');
  });

  it('does not advertise itself as proof the account still works', async () => {
    // `gog auth list` reads the keyring. No network, no validation — it lists a
    // full scope set for an account whose refresh token died days ago.
    //
    // This description used to say "check which accounts are configured and
    // available", and "available" is exactly the wrong word: it was read as a
    // liveness check while per-service servers were flapping into needs-auth,
    // which pointed a whole debugging session away from an expired grant.
    // gog_auth_health is the tool that actually probes Google.
    const harness = await setupHandlers();
    const { tools } = await harness.client.listTools();
    const desc = tools.find((t) => t.name === 'gog_auth_list')!.description!;

    expect(desc).not.toMatch(/\bavailable\b/i);
    // It must say what it does NOT do, and where to go instead — a reader who
    // wants liveness has to be sent somewhere, or they will use this anyway.
    expect(desc).toMatch(/does not|without/i);
    expect(desc).toContain('gog_auth_health');
    await harness.close();
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run).mockRejectedValue('something went wrong');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_list', {});
    expect(result.content[0].text).toBe('something went wrong');
  });
});

describe('gog_auth_status', () => {
  it('calls run with auth status args', async () => {
    vi.mocked(runner.run).mockResolvedValue('keyring: system\ncredentials: ~/.config/gog');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_status', {});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'status']);
    expect(result.content[0].text).toContain('keyring');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Status failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_status', {});
    expect(result.content[0].text).toBe('Error: Status failed');
  });

  it('does not present itself as a health check', async () => {
    // `gog auth status` prints the keyring backend and where the credential
    // files live. It contacts nothing. Named "status" next to a connector whose
    // UI says "connected", it reads as the answer to "is my auth OK?" — which is
    // the question only gog_auth_health can answer.
    const harness = await setupHandlers();
    const { tools } = await harness.client.listTools();
    const desc = tools.find((t) => t.name === 'gog_auth_status')!.description!;

    expect(desc).toMatch(/does not contact Google/i);
    expect(desc).toContain('gog_auth_health');
    await harness.close();
  });
});

describe('gog_auth_services', () => {
  it('calls run with auth services args', async () => {
    vi.mocked(runner.run).mockResolvedValue('sheets: spreadsheets.readonly');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_services', {});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'services']);
    expect(result.content[0].text).toContain('sheets');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Services failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_services', {});
    expect(result.content[0].text).toBe('Error: Services failed');
  });
});

describe('gog_auth_add', () => {
  it('calls run with correct args, interactive true, and 5-minute timeout', async () => {
    vi.mocked(runner.run).mockResolvedValue('Authorization successful for user@gmail.com');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add', { email: 'user@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--services', 'all'],
      { interactive: true, timeout: 300_000 },
    );
    expect(result.content[0].text).toBe('Authorization successful for user@gmail.com');
  });

  it('passes custom services when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('Authorization successful');
    const harness = await setupHandlers();
    await harness.callTool('gog_auth_add', { email: 'user@gmail.com', services: 'sheets,gmail' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--services', 'sheets,gmail'],
      { interactive: true, timeout: 300_000 },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Auth cancelled by user'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add', { email: 'user@gmail.com' });
    expect(result.content[0].text).toBe('Error: Auth cancelled by user');
  });

  it('returns error text on timeout', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('gog timed out after 300000ms (5 minutes)'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add', { email: 'user@gmail.com' });
    expect(result.content[0].text).toContain('timed out');
    expect(result.content[0].text).toContain('5 minutes');
  });
});

describe('gog_auth_health', () => {
  it('names itself as the only live measurement of the Google layer', async () => {
    // DEFECT 1's wording half: the hosted connector's "connected" / "refreshed"
    // is an OAuth refresh inside OAUTH_KV that contacts neither Fly nor Google.
    // Nothing in this repo can change that word, so the tool that DOES measure
    // has to say that it is the one that does.
    const harness = await setupHandlers();
    const { tools } = await harness.client.listTools();
    const desc = tools.find((t) => t.name === 'gog_auth_health')!.description!;

    expect(desc).toMatch(/connected|refreshed/i);
    expect(desc).toMatch(/only|nothing else/i);
    await harness.close();
  });

  const CHECK_JSON = JSON.stringify({
    accounts: [
      { email: 'chris.c.hall@gmail.com', created_at: '2026-07-17T15:08:39Z', valid: true },
    ],
  });

  it('calls run with auth list --check and formats a health summary', async () => {
    vi.mocked(runner.run).mockResolvedValue(CHECK_JSON);
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_health', {});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'list', '--check']);
    expect(result.content[0].text).toContain('chris.c.hall@gmail.com');
    expect(result.content[0].text).toContain('token valid');
  });

  it('surfaces a dead-token account with re-auth guidance', async () => {
    vi.mocked(runner.run).mockResolvedValue(JSON.stringify({
      accounts: [{
        email: 'chris.c.hall@gmail.com',
        created_at: '2026-07-17T15:08:39Z',
        valid: false,
        error: 'refresh access token: oauth2: "invalid_grant" "Token has been expired or revoked."',
      }],
    }));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_health', {});
    expect(result.content[0].text).toContain('NEEDS RE-AUTH');
    expect(result.content[0].text).toContain('gog_auth_add_url');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('keyring locked'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_health', {});
    expect(result.content[0].text).toBe('Error: keyring locked');
  });
});

describe('gog_auth_add_url', () => {
  it('runs remote step 1 with force-consent and tokens-only redaction', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"auth_url":"https://accounts.google.com/o/oauth2/auth?...","state_reused":false}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add_url', { email: 'user@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--remote', '--step', '1', '--services', 'all', '--force-consent'],
      { redactMode: 'tokens' },
    );
    expect(result.content[0].text).toContain('accounts.google.com');
  });

  it('passes custom services', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"auth_url":"https://x"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_auth_add_url', { email: 'user@gmail.com', services: 'gmail,drive' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--remote', '--step', '1', '--services', 'gmail,drive', '--force-consent'],
      { redactMode: 'tokens' },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('client not configured'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add_url', { email: 'user@gmail.com' });
    expect(result.content[0].text).toBe('Error: client not configured');
  });
});

describe('gog_auth_add_complete', () => {
  it('runs remote step 2 with the pasted redirect URL', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"email":"user@gmail.com","stored":true}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add_complete', {
      email: 'user@gmail.com',
      redirectUrl: 'http://127.0.0.1:59436/oauth2/callback?code=abc&state=xyz',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--remote', '--step', '2', '--auth-url',
        'http://127.0.0.1:59436/oauth2/callback?code=abc&state=xyz', '--services', 'all', '--force-consent'],
    );
    expect(result.content[0].text).toContain('stored');
  });

  it('passes custom services matching step 1', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"stored":true}');
    const harness = await setupHandlers();
    await harness.callTool('gog_auth_add_complete', {
      email: 'user@gmail.com',
      redirectUrl: 'http://127.0.0.1/cb?code=c&state=s',
      services: 'gmail,drive',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--remote', '--step', '2', '--auth-url',
        'http://127.0.0.1/cb?code=c&state=s', '--services', 'gmail,drive', '--force-consent'],
    );
  });

  it('returns error text on failure (e.g. expired state)', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('no matching manual auth state'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_add_complete', {
      email: 'user@gmail.com',
      redirectUrl: 'http://127.0.0.1/cb?code=c&state=s',
    });
    expect(result.content[0].text).toBe('Error: no matching manual auth state');
  });
});

describe('authToolsFor (least-privilege default services)', () => {
  const gmailHarness = () => createTestHarness(authToolsFor('gmail'));

  it('gog_auth_add_url defaults services to the bound value, not "all"', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"auth_url":"https://accounts.google.com/x"}');
    const harness = await gmailHarness();
    await harness.callTool('gog_auth_add_url', { email: 'u@x.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'u@x.com', '--remote', '--step', '1', '--services', 'gmail', '--force-consent'],
      { redactMode: 'tokens' },
    );
  });

  it('gog_auth_add defaults services to the bound value', async () => {
    vi.mocked(runner.run).mockResolvedValue('ok');
    const harness = await gmailHarness();
    await harness.callTool('gog_auth_add', { email: 'u@x.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'u@x.com', '--services', 'gmail'],
      { interactive: true, timeout: 300_000 },
    );
  });

  it('gog_auth_add_complete defaults services to the bound value', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"stored":true}');
    const harness = await gmailHarness();
    await harness.callTool('gog_auth_add_complete', {
      email: 'u@x.com',
      redirectUrl: 'http://127.0.0.1/cb?code=c&state=s',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'u@x.com', '--remote', '--step', '2', '--auth-url',
        'http://127.0.0.1/cb?code=c&state=s', '--services', 'gmail', '--force-consent'],
    );
  });

  it('still allows overriding services per call (widen when needed)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"auth_url":"x"}');
    const harness = await gmailHarness();
    await harness.callTool('gog_auth_add_url', { email: 'u@x.com', services: 'gmail,drive' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'u@x.com', '--remote', '--step', '1', '--services', 'gmail,drive', '--force-consent'],
      { redactMode: 'tokens' },
    );
  });
});

describe('gog_auth_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('removed user@gmail.com');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_run', { subcommand: 'remove', args: ['user@gmail.com'] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'remove', 'user@gmail.com'], {});
    expect(result.content[0].text).toBe('removed user@gmail.com');
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('token info');
    const harness = await setupHandlers();
    await harness.callTool('gog_auth_run', { subcommand: 'tokens', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'tokens'], {});
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Remove failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_auth_run', { subcommand: 'remove', args: ['x@y.com'] });
    expect(result.content[0].text).toBe('Error: Remove failed');
  });
});
