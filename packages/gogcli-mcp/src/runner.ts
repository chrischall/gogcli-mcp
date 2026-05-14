import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export type Spawner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcess;

export interface RunOptions {
  account?: string;
  spawner?: Spawner;
  interactive?: boolean;
  timeout?: number;
}

const TIMEOUT_MS = 30_000;

// Treat unresolved .mcpb placeholders ("${user_config.gog_path}") and empty
// strings the same as an unset env var. When an optional .mcpb user_config
// field is left blank, some clients pass the literal placeholder text through
// to the spawned server instead of substituting "" or omitting the key.
function envOrUndefined(key: string): string | undefined {
  const value = process.env[key];
  if (!value || value.startsWith('${')) return undefined;
  return value;
}

function formatTimeout(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${ms}ms (${minutes} minute${minutes !== 1 ? 's' : ''})`;
  }
  return `${ms}ms`;
}

export async function run(args: string[], options: RunOptions = {}): Promise<string> {
  const { account, spawner = spawn as unknown as Spawner, interactive = false, timeout } = options;

  const effectiveAccount = account ?? envOrUndefined('GOG_ACCOUNT');

  const fullArgs = ['--json', '--color=never'];
  if (!interactive) {
    fullArgs.push('--no-input');
  }
  if (effectiveAccount) {
    fullArgs.push('--account', effectiveAccount);
  }
  fullArgs.push(...args);

  const effectiveTimeout = timeout ?? TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // Strip GOG_ACCESS_TOKEN so gogcli uses stored refresh tokens instead of
    // a potentially stale direct access token passed through MCP env config.
    const { GOG_ACCESS_TOKEN: _, ...cleanEnv } = process.env;
    const child = spawner(envOrUndefined('GOG_PATH') ?? 'gog', fullArgs, { env: cleanEnv });
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
      reject(err);
    });
  });
}
