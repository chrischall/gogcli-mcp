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
}

export async function run(args: string[], options: RunOptions = {}): Promise<string> {
  const { account, spawner = spawn as unknown as Spawner } = options;

  const effectiveAccount = account ?? process.env.GOG_ACCOUNT;

  const fullArgs = ['--json', '--no-input', '--color=never'];
  if (effectiveAccount) {
    fullArgs.push('--account', effectiveAccount);
  }
  fullArgs.push(...args);

  return new Promise((resolve, reject) => {
    const child = spawner('gog', fullArgs, { env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `gog exited with code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
