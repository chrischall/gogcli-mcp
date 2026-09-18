import { join } from 'node:path';
import { readEnvVar } from '@chrischall/mcp-utils';
import { redactSecrets, run, type GogFileArg, type Spawner } from './runner.js';
import { errorText } from './tools/utils.js';

export type AuthBootstrapStatus = 'unconfigured' | 'incomplete' | 'present' | 'imported' | 'failed';

export interface AuthBootstrapOptions {
  spawner?: Spawner;
  /** Where the marker lives. Defaults to the OS home dir, which is mcp-host's persistent dataDir. */
  home?: string;
}

export const AUTH_BOOTSTRAP_MARKER = 'auth-bootstrap.sha256';

const VARS = ['GOG_CLIENT_ID', 'GOG_CLIENT_SECRET', 'GOG_REFRESH_TOKEN', 'GOG_ACCOUNT'] as const;

const log = (line: string): void => {
  process.stderr.write(`[gogcli-mcp] auth bootstrap: ${line}\n`);
};

const jsonFile = (name: string, payload: unknown): GogFileArg => ({
  kind: 'file',
  flag: name,
  ext: 'json',
  contents: JSON.stringify(payload),
  positional: true,
});

async function accountListed(account: string, spawner: Spawner | undefined): Promise<boolean> {
  try {
    const out = await run(['auth', 'list'], { spawner, account });
    const accounts = (JSON.parse(out) as { accounts?: { email?: string }[] | null }).accounts ?? [];
    return accounts.some((a) => a.email?.toLowerCase() === account.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Seed gog's keyring from GOG_CLIENT_ID / GOG_CLIENT_SECRET / GOG_REFRESH_TOKEN
 * / GOG_ACCOUNT, for a host (mcp-host) that can inject secrets but cannot run
 * `gog auth add` in a browser. Never throws: the server must still start so the
 * auth tools stay reachable.
 *
 * The marker records WHICH secret was last imported, so a rotated secret is
 * re-imported while an in-connector re-auth (gog_auth_add_url/complete) is left
 * in effect until the secret itself changes.
 */
export async function bootstrapGogAuth(
  env: NodeJS.ProcessEnv = process.env,
  options: AuthBootstrapOptions = {},
): Promise<AuthBootstrapStatus> {
  const values = VARS.map((key) => readEnvVar(key, { env }));
  const missing = VARS.filter((_key, i) => values[i] === undefined);
  if (missing.length === VARS.length) return 'unconfigured';
  if (missing.length > 0) {
    log(`skipped, missing ${missing.join(', ')}`);
    return 'incomplete';
  }
  const [clientId, clientSecret, refreshToken, account] = values as string[];
  const { spawner } = options;

  try {
    const { createHash } = await import('node:crypto');
    const { mkdir, readFile, writeFile, chmod } = await import('node:fs/promises');
    const home = options.home ?? (await import('node:os')).homedir();
    const dir = join(home, '.gogcli-mcp');
    const marker = join(dir, AUTH_BOOTSTRAP_MARKER);
    const fingerprint = createHash('sha256').update(values.join('\0')).digest('hex');

    const previous = await readFile(marker, 'utf8').catch(() => undefined);
    if (previous === fingerprint && (await accountListed(account, spawner))) return 'present';

    await run(
      ['auth', 'credentials', 'set', jsonFile('credentials', { installed: { client_id: clientId, client_secret: clientSecret } })],
      { spawner, account },
    );
    await run(
      ['auth', 'tokens', 'import', jsonFile('token', { email: account, refresh_token: refreshToken })],
      { spawner, account },
    );

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(marker, fingerprint, { mode: 0o600 });
    await chmod(marker, 0o600);
    return 'imported';
  } catch (err) {
    // run() already redacts; the literal values are scrubbed too in case a
    // secret shape the redactor does not know (e.g. GOCSPX-…) was echoed.
    let message = redactSecrets(errorText(err));
    for (const value of [clientSecret, refreshToken]) message = message.split(value).join('[REDACTED]');
    log(`failed, ${message}`);
    return 'failed';
  }
}
