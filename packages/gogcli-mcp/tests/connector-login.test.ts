import { describe, expect, it, vi } from 'vitest';
import { handleAuthorize } from '../src/connector-login.js';
import type { ConnectorAuth } from '../src/connector-auth.js';

function encoded(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function envFor(oauthReq: unknown = { clientId: 'client-1' }) {
  return {
    OAUTH_PROVIDER: {
      parseAuthRequest: vi.fn(async () => oauthReq),
      completeAuthorization: vi.fn(async () => ({ redirectTo: 'https://client.example/callback?code=ok' })),
    },
  };
}

const auth: ConnectorAuth<{ key: string }> = {
  service: 'gogcli <Workspace>',
  accent: '#4285F4',
  privacyNote: 'Stored & encrypted.',
  fields: [
    { name: 'key', label: 'Connector "key"', type: 'password' },
    { name: 'account', label: 'Account' },
  ],
  async login(fields) {
    return { key: fields.key };
  },
};

describe('connector login', () => {
  it('renders the parsed OAuth request in an escaped credential form', async () => {
    const env = envFor();
    const response = await handleAuthorize(new Request('https://connector.example/authorize'), env, auth);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(env.OAUTH_PROVIDER.parseAuthRequest).toHaveBeenCalledOnce();
    const html = await response.text();
    expect(html).toContain('gogcli &lt;Workspace&gt;');
    expect(html).toContain('Connector &quot;key&quot;');
    expect(html).toContain('type="password"');
    expect(html).toContain('Stored &amp; encrypted.');
    expect(html).toContain(encoded({ clientId: 'client-1' }));
  });

  it('verifies submitted fields and completes authorization with an explicit user id', async () => {
    const env = envFor();
    const login = vi.fn(async () => ({ key: 'secret' }));
    const form = new FormData();
    form.set('oauthReq', encoded({ clientId: 'client-1' }));
    form.set('key', 'secret');
    form.set('account', 'person@example.com');

    const response = await handleAuthorize(
      new Request('https://connector.example/authorize', { method: 'POST', body: form }),
      env,
      { ...auth, userId: 'fixed-user', login },
    );

    expect(login).toHaveBeenCalledWith(
      { key: 'secret', account: 'person@example.com' },
      env,
    );
    expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith({
      request: { clientId: 'client-1' },
      userId: 'fixed-user',
      scope: [],
      metadata: {},
      props: { key: 'secret' },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://client.example/callback?code=ok');
  });

  it('uses the first credential as the user id and treats non-text fields as empty', async () => {
    const env = envFor();
    const login = vi.fn(async () => ({ key: 'secret' }));
    const form = new FormData();
    form.set('oauthReq', encoded({ clientId: 'client-1' }));
    form.set('key', 'secret');
    form.set('account', new Blob(['ignored']));

    await handleAuthorize(
      new Request('https://connector.example/authorize', { method: 'POST', body: form }),
      env,
      { ...auth, login },
    );

    expect(login).toHaveBeenCalledWith({ key: 'secret', account: '' }, env);
    expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'secret' }),
    );
  });

  it('uses the public identity when there are no credential fields', async () => {
    const env = envFor();
    const form = new FormData();
    const login = vi.fn(async () => ({ key: 'public' }));

    await handleAuthorize(
      new Request('https://connector.example/authorize', { method: 'POST', body: form }),
      env,
      { service: 'Public', fields: [], login },
    );

    expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ request: undefined, userId: 'public' }),
    );
  });

  it('re-renders a safely escaped Error without completing authorization', async () => {
    const env = envFor();
    const form = new FormData();
    form.set('oauthReq', encoded({ clientId: 'client-1' }));
    form.set('key', 'bad');
    const response = await handleAuthorize(
      new Request('https://connector.example/authorize', { method: 'POST', body: form }),
      env,
      {
        service: 'gogcli',
        fields: [{ name: 'key', label: 'Key' }],
        async login() {
          throw new Error('bad <key>');
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('bad &lt;key&gt;');
    expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
  });

  it('renders a non-Error rejection as text', async () => {
    const env = envFor();
    const form = new FormData();
    const response = await handleAuthorize(
      new Request('https://connector.example/authorize', { method: 'POST', body: form }),
      env,
      {
        service: 'gogcli',
        fields: [],
        async login() {
          throw 'try again';
        },
      },
    );

    expect(await response.text()).toContain('try again');
  });
});
