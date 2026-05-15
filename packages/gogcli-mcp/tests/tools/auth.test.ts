import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAuthTools } from '../../src/tools/auth.js';
import * as runner from '../../src/runner.js';
import { setupHandlers as setupHandlersBase, type ToolHandler } from '../helpers/test-harness.js';

vi.mock('../../src/runner.js');

const setupHandlers = () => setupHandlersBase(registerAuthTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_auth_list', () => {
  it('calls run with auth list args', async () => {
    vi.mocked(runner.run).mockResolvedValue('user@gmail.com\nadmin@example.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'list']);
    expect(result.content[0].text).toBe('user@gmail.com\nadmin@example.com');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('No accounts configured'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(result.content[0].text).toBe('Error: No accounts configured');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run).mockRejectedValue('something went wrong');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(result.content[0].text).toBe('something went wrong');
  });
});

describe('gog_auth_status', () => {
  it('calls run with auth status args', async () => {
    vi.mocked(runner.run).mockResolvedValue('keyring: system\ncredentials: ~/.config/gog');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_status')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'status']);
    expect(result.content[0].text).toContain('keyring');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Status failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_status')!({});
    expect(result.content[0].text).toBe('Error: Status failed');
  });
});

describe('gog_auth_services', () => {
  it('calls run with auth services args', async () => {
    vi.mocked(runner.run).mockResolvedValue('sheets: spreadsheets.readonly');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_services')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'services']);
    expect(result.content[0].text).toContain('sheets');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Services failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_services')!({});
    expect(result.content[0].text).toBe('Error: Services failed');
  });
});

describe('gog_auth_add', () => {
  it('calls run with correct args, interactive true, and 5-minute timeout', async () => {
    vi.mocked(runner.run).mockResolvedValue('Authorization successful for user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--services', 'all'],
      { interactive: true, timeout: 300_000 },
    );
    expect(result.content[0].text).toBe('Authorization successful for user@gmail.com');
  });

  it('passes custom services when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('Authorization successful');
    const handlers = setupHandlers();
    await handlers.get('gog_auth_add')!({ email: 'user@gmail.com', services: 'sheets,gmail' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--services', 'sheets,gmail'],
      { interactive: true, timeout: 300_000 },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Auth cancelled by user'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
    expect(result.content[0].text).toBe('Error: Auth cancelled by user');
  });

  it('returns error text on timeout', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('gog timed out after 300000ms (5 minutes)'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
    expect(result.content[0].text).toContain('timed out');
    expect(result.content[0].text).toContain('5 minutes');
  });
});

describe('gog_auth_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('removed user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_run')!({ subcommand: 'remove', args: ['user@gmail.com'] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'remove', 'user@gmail.com'], {});
    expect(result.content[0].text).toBe('removed user@gmail.com');
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('token info');
    const handlers = setupHandlers();
    await handlers.get('gog_auth_run')!({ subcommand: 'tokens', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'tokens'], {});
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Remove failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_run')!({ subcommand: 'remove', args: ['x@y.com'] });
    expect(result.content[0].text).toBe('Error: Remove failed');
  });
});
