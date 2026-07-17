import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChildProcess } from 'node:child_process';
import { delimiter } from 'node:path';
import { parseBoolEnv, readEnvVar, redactSecrets as redactSharedSecrets } from '@chrischall/mcp-utils';

export type Spawner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcess;

// An executor runs a FULLY-ASSEMBLED gog arg list (already including
// --json/--no-input/--color=never, --account, --readonly, and the service
// subcommand) and returns its stdout as a string (or throws). This is the
// injection seam that lets the same tool registrars run either by spawning
// `gog` (stdio transport) or by forwarding the arg list to a remote HTTP
// backend (hosted Cloudflare-Worker connector, which cannot spawn processes).
export type GogExecutor = (
  args: string[],
  opts: { timeout?: number; interactive?: boolean },
) => Promise<string>;

// Ambient override for the executor `run()` uses when no options.spawner is
// given. The Worker/Fly path wraps request handling in
// `runExecutor.run({ executor }, ...)`; unset, `run()` falls back to spawning.
export const runExecutor = new AsyncLocalStorage<{ executor: GogExecutor }>();

export interface RunOptions {
  account?: string;
  spawner?: Spawner;
  interactive?: boolean;
  timeout?: number;
  // Inject gog's global --readonly flag, which blocks mutating API requests at
  // runtime. Independent of (and OR-ed with) the GOG_READONLY env var.
  readonly?: boolean;
}

const TIMEOUT_MS = 30_000;

// Minimum gogcli (`gog`) binary version this wrapper's tools assume. Some tools
// pass flags/subcommands that only exist in newer gog, so bump this whenever a
// change starts relying on a newer gog feature — and label that PR `gogcli-bump`
// so the requirement change is surfaced in the release notes (see
// .github/release.yml). This is the single source of truth for the required
// version; keep the README/CLAUDE.md mention in sync.
export const MIN_GOG_VERSION = '0.34.1';

// Interpret the GOG_READONLY kill-switch. `readEnvVar` already treats blank
// values, 'undefined'/'null' sentinels, and unresolved .mcpb placeholders
// ("${user_config.gog_readonly}") as unset. On top of that, GOG_READONLY is
// deliberately fail-safe: any *set* value that isn't an explicit off value
// (0/false/no/off) enables readonly — parseBoolEnv's `default: true` covers
// unrecognised values (e.g. "enable"), so a typo blocks writes instead of
// silently allowing them.
function readonlyEnvEnabled(): boolean {
  return readEnvVar('GOG_READONLY') !== undefined && parseBoolEnv('GOG_READONLY', { default: true });
}

// Strip ambient secrets from the child env so gogcli only sees its own
// configured credentials. GOG_ACCESS_TOKEN is the original target: gogcli
// would otherwise try to use a (potentially stale) directly-passed token
// instead of the stored refresh token. The broader patterns are
// defense-in-depth — the parent process's shell may have other Google /
// cloud / API secrets in scope that the child has no business seeing.
function sanitizedEnv(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'GOG_ACCESS_TOKEN') continue;
    if (key === 'GOOGLE_APPLICATION_CREDENTIALS') continue;
    if (/(_TOKEN|_SECRET|_API_KEY|_PRIVATE_KEY)$/.test(key)) continue;
    result[key] = value;
  }
  return result;
}

// Redact bearer/refresh-token patterns from error text before surfacing
// it back to the MCP client. If gog ever emits a token in stderr (e.g.
// from a verbose log mode), this prevents it from leaking to the model.
// The shared mcp-utils redactSecrets covers Bearer/Basic headers, JWTs,
// cookies, well-known key shapes (incl. Google AIza… API keys), and secret
// query params — but not Google's OAuth2 token shapes, so those stay here.
const GOOGLE_TOKEN_PATTERNS: RegExp[] = [
  /ya29\.[A-Za-z0-9._\-]+/g,           // OAuth2 access tokens
  /1\/\/[A-Za-z0-9._\-]+/g,            // OAuth2 refresh tokens
];
export function redactSecrets(text: string): string {
  let redacted = redactSharedSecrets(text);
  for (const re of GOOGLE_TOKEN_PATTERNS) {
    redacted = redacted.replace(re, '[REDACTED]');
  }
  return redacted;
}

// MCP desktop clients often spawn servers with a stripped PATH that excludes
// Homebrew, user-local, and Go's default install dirs — so even when gog is
// installed, the spawned server can't find it. Augment the child's PATH with
// the locations where gogcli is commonly installed.
function augmentedPath(): string {
  const home = process.env.HOME;
  const candidates = [
    process.env.PATH ?? '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home ? `${home}/.local/bin` : '',
    home ? `${home}/go/bin` : '',
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    for (const dir of c.split(delimiter)) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      parts.push(dir);
    }
  }
  return parts.join(delimiter);
}

function formatTimeout(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${ms}ms (${minutes} minute${minutes !== 1 ? 's' : ''})`;
  }
  return `${ms}ms`;
}

// Spawn-based executor: owns everything process-specific — building the
// sanitized child env, PATH augmentation, spawning, collecting stdout/stderr,
// and the timeout kill. It returns raw output (no redaction — `run()` wraps
// that around whichever executor runs). The child_process import is LAZY so a
// Cloudflare Worker importing this module doesn't eagerly pull node:child_process
// (which would break the Worker bundle); the injected `spawner` bypasses it.
async function spawnExecutor(
  fullArgs: string[],
  opts: { timeout?: number; interactive?: boolean; spawner?: Spawner },
): Promise<string> {
  const { timeout, interactive = false, spawner } = opts;
  const spawn = spawner ?? (await import('node:child_process')).spawn as unknown as Spawner;
  const effectiveTimeout = timeout ?? TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const childEnv = { ...sanitizedEnv(), PATH: augmentedPath() };
    const child = spawn(readEnvVar('GOG_PATH') ?? 'gog', fullArgs, { env: childEnv });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`gog timed out after ${formatTimeout(effectiveTimeout)}`));
    }, effectiveTimeout);

    child.stdout!.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      if (code === 0) {
        if (interactive && stderr) {
          resolve(stdout + '\n' + stderr);
        } else {
          resolve(stdout);
        }
      } else {
        reject(new Error(stderr || `gog exited with code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'gog executable not found. Install gogcli (https://github.com/openclaw/gogcli) ' +
          'or set GOG_PATH in your MCP client config to the absolute binary path ' +
          '(run `which gog` in a terminal to find it).',
        ));
        return;
      }
      reject(err);
    });
  });
}

export async function run(args: string[], options: RunOptions = {}): Promise<string> {
  const { account, spawner, interactive = false, timeout, readonly = false } = options;

  const effectiveAccount = account ?? readEnvVar('GOG_ACCOUNT');

  const fullArgs = ['--json', '--color=never'];
  if (!interactive) {
    fullArgs.push('--no-input');
  }
  // Block all mutating gog API requests at runtime when either the caller opts
  // in or GOG_READONLY is set in the environment. gog has no native env binding
  // for --readonly, so the wrapper translates GOG_READONLY into the flag.
  if (readonly || readonlyEnvEnabled()) {
    fullArgs.push('--readonly');
  }
  if (effectiveAccount) {
    fullArgs.push('--account', effectiveAccount);
  }
  fullArgs.push(...args);

  // Pick the executor: an injected spawner keeps the stdio spawn path (and all
  // its tests) intact and always wins; otherwise an ambient runExecutor store
  // (the Worker/Fly HTTP-forward path) takes over; otherwise the default lazy
  // real spawn. Redaction wraps the executor regardless of which one runs — a
  // successful `gog auth tokens` (or any command echoing a credential) would
  // otherwise return raw Google tokens (ya29.…/1//…) into model context, where
  // a sibling tool (gog_gmail_send) could exfiltrate them.
  const store = runExecutor.getStore();
  try {
    let output: string;
    if (spawner) {
      output = await spawnExecutor(fullArgs, { timeout, interactive, spawner });
    } else if (store) {
      output = await store.executor(fullArgs, { timeout, interactive });
    } else {
      output = await spawnExecutor(fullArgs, { timeout, interactive });
    }
    return redactSecrets(output);
  } catch (err) {
    throw new Error(redactSecrets((err as Error).message));
  }
}
