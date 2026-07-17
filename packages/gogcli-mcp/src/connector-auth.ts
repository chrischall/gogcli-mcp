import type { ConnectorAuth } from '@chrischall/mcp-connector';

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
 * `ConnectorAuth` for the gogcli remote connector: the login page collects the
 * user's connector key, verifies it by hitting the Fly backend's `/health`
 * endpoint with the key as a bearer token (a bad key makes the backend answer
 * non-2xx, which surfaces back on the login page), and stores `{ key }` as the
 * OAuth props that `worker.ts`'s `buildClient` turns into a per-session Fly
 * executor.
 */
export const gogAuth: ConnectorAuth<GogProps> = {
  service: 'gogcli (Google Workspace)',
  accent: '#4285F4',
  privacyNote:
    'Your connector key is stored encrypted and used only to reach your own gog backend.',
  fields: [{ name: 'key', label: 'gogcli connector key', type: 'password' }],
  async login(fields, env) {
    const res = await fetch(`${(env as any).FLY_ENDPOINT}/health`, {
      headers: { Authorization: `Bearer ${fields.key}` },
    });
    if (!res.ok) throw new Error('Invalid connector key (backend rejected it)');
    return { key: fields.key };
  },
};
