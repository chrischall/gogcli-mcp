import { describe, it, expect, vi, afterEach } from 'vitest';
import { gogAuth } from '../src/connector-auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gogAuth.login', () => {
  const env = { FLY_ENDPOINT: 'https://runner.example' };

  it('verifies the key against the backend /health and returns the props', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const props = await gogAuth.login({ key: 'my-key' }, env);
    expect(props).toEqual({ key: 'my-key' });
    expect(fetchMock).toHaveBeenCalledWith('https://runner.example/health', {
      headers: { Authorization: 'Bearer my-key' },
    });
  });

  it('throws when the backend rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(gogAuth.login({ key: 'bad' }, env)).rejects.toThrow(
      'Invalid connector key',
    );
  });
});
