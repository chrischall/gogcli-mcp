// Operator-configured confinement for every server-side path a tool accepts
// (audit SEC-3/SEC-4).
//
// `attach`, `localPath`, `file`, `out`, `outDir` and friends are resolved on the
// machine gog runs on, and the model chooses them. Unconfined, each is a read
// primitive (attach ~/.ssh/id_rsa, gog's credentials, /proc/<pid>/environ to an
// email) or a write primitive (drop attacker-chosen attachment bytes on
// ~/Library/LaunchAgents/x.plist or ~/.zshrc). Every such path must now resolve
// — through symlinks, via mcp-utils' assertPathWithinRoots — inside one of the
// directories the operator lists in GOG_FILE_ROOTS, or the server's own private
// attachment download directory.
//
// GOG_FILE_ROOTS is a PATH-style list (':' on POSIX). Unset, it defaults to
// ~/gogcli-mcp-files: files to attach or upload go there, and exports and
// downloads with an explicit path must be written there. Set it to a wider
// directory (e.g. your home) deliberately, not by default.

import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { assertPathWithinRoots, readEnvVar } from '@chrischall/mcp-utils';
import { ATTACHMENT_DOWNLOAD_ROOT } from './attachment-root.js';

export const FILE_ROOTS_ENV = 'GOG_FILE_ROOTS';

/** The default root when GOG_FILE_ROOTS is unset. */
export function defaultFileRoot(): string {
  return join(homedir(), 'gogcli-mcp-files');
}

/** The operator's configured roots, or the default one. */
export function fileRoots(): string[] {
  const raw = readEnvVar(FILE_ROOTS_ENV);
  const roots = (raw ?? '').split(delimiter).map((r) => r.trim()).filter(Boolean);
  return roots.length > 0 ? roots : [defaultFileRoot()];
}

/**
 * Require `path` (a model-supplied server path, named `param` in the error) to
 * lie inside an allowed root. Returns it unchanged. `allowDash` admits gog's
 * `-` for tools where it means stdout; anywhere else `-` means stdin, which this
 * server never writes to, so it is refused like any other stray path.
 */
export function confinePath(path: string, param: string, opts: { allowDash?: boolean } = {}): string {
  if (opts.allowDash && path === '-') return path;
  const roots = [...fileRoots(), ATTACHMENT_DOWNLOAD_ROOT];
  try {
    assertPathWithinRoots(path, roots);
  } catch {
    throw new Error(
      `${param} ${JSON.stringify(path)} is outside the directories this server may read or write `
      + `(${roots.join(', ')}). Put the file in one of them, or ask the server operator to widen ${FILE_ROOTS_ENV}.`,
    );
  }
  return path;
}

/** confinePath for every element of an optional list. */
export function confinePaths(paths: readonly string[] | undefined, param: string): void {
  for (const path of paths ?? []) confinePath(path, param);
}

/** For JSON-or-`@file` inputs: confine the path of an `@file` value, pass inline JSON through. */
export function confineAtFile(value: string, param: string): string {
  if (value.startsWith('@')) confinePath(value.slice(1), param);
  return value;
}
