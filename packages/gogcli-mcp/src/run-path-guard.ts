// GOG_FILE_ROOTS for the escape hatches (audit SEC-3/SEC-4).
//
// The structured tools confine every server-side path they accept, but a
// `gog_<service>_run` forwards a model-supplied string[] verbatim, and gog reads
// and writes local files through it just as readily: `drive upload
// <gog's credentials.json>`, `gmail drafts create --attach=~/.ssh/id_rsa`,
// `docs export --out=~/.zshrc`. Left open, that is the read-and-exfiltrate and
// write-anywhere primitive the roots exist to close, and GOG_FILE_ROOTS would
// only look like a boundary. So, before an escape hatch runs:
//
// - subcommands whose local path is a POSITIONAL are refused outright. Which
//   positional is the path depends on the command, and kong lets flags sit
//   anywhere, so it cannot be picked out reliably; each has a dedicated tool
//   that confines it.
// - every path-bearing FLAG value (`--out`, `--attach`, `--file`, `--*-file`,
//   `--out-dir`, `--dir`, an `@file` JSON input, ...) must resolve inside the
//   roots, whether it is attached (`--out=x`) or the next token (`--out x`).
// - the short spellings `-o` / `-f` are refused, since a cluster (`-yf x`,
//   `-o/etc/x`) hides the value; the long form is confined instead.
// - flags that make gog RUN a local program (`--on-change`, `--on-new`,
//   `--mmdc`) are refused: a model-chosen shell command is a strictly worse
//   primitive than a path.
//
// Kept out of runner.ts for the same reason as arg-guard.ts: tool tests
// automock the runner, and this has to run for real in the tool handlers.

import { confinePath } from './file-roots.js';

/** Escape-hatch subcommands whose local path is positional, and the tool to use instead. */
const POSITIONAL_PATH_SUBCOMMANDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  appscript: { pull: 'gog_appscript_pull' },
  drive: { upload: 'gog_drive_upload', sync: 'gog_drive_sync_push' },
  gmail: { import: 'gog_gmail_import' },
  slides: {
    'add-slide': 'gog_slides_add_slide',
    'insert-image': 'gog_slides_insert_image',
    'replace-slide': 'gog_slides_replace_slide',
  },
};

/** Long flags (lower-case, no dashes) whose value is a local path (from `gog schema`, v0.41.0). */
const PATH_FLAGS = new Set(['out', 'output', 'out-dir', 'output-dir', 'dir', 'worker-dir', 'attach', 'file', 'key', 'cert', 'replacements']);

/** Per service: flags that look like paths but carry Drive file IDs. */
const ID_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  drive: new Set(['file', 'filter-file']),
};

/** Flags whose value gog executes as a local command or program. */
const EXEC_FLAGS = new Set(['on-change', 'on-new', 'mmdc']);

// Single-dash clusters containing -o (--out) or -f (--file).
const SHORT_PATH_CLUSTER = /^-(?!-)[A-Za-z]*[of]/;

const LONG_FLAG = /^--([A-Za-z0-9][A-Za-z0-9-]*)(?:=([\s\S]*))?$/;

function isPathFlag(service: string, name: string): boolean {
  if (ID_FLAGS[service]?.has(name)) return false;
  return PATH_FLAGS.has(name) || name.endsWith('-file');
}

function confineFlagValue(flag: string, value: string): void {
  // `-` is stdin/stdout, which never names a file on the host.
  if (value === '-') return;
  confinePath(value, flag);
  // kong splits a repeatable ([]string) flag on commas, so `--attach=a,b` is
  // two paths: each must be inside the roots too.
  for (const part of value.split(',')) {
    if (part !== '' && part !== '-') confinePath(part, flag);
  }
}

/**
 * Throw unless every local path in an escape-hatch call (`gog <service>
 * <subcommand> ...args`) lies inside GOG_FILE_ROOTS (or the private attachment
 * download root), and nothing in it would run a local program.
 */
/** The dedicated tool to use when `gog <service> <subcommand>` is refused for a positional path, else undefined. */
export function positionalPathTool(service: string, subcommand: string): string | undefined {
  return POSITIONAL_PATH_SUBCOMMANDS[service]?.[subcommand];
}

export function assertRunPathsConfined(service: string, subcommand: string, args: readonly string[]): void {
  const dedicated = positionalPathTool(service, subcommand);
  if (dedicated) {
    throw new Error(
      `gog ${service} ${subcommand} reads or writes a local path given as a positional argument, so it is not available through gog_${service}_run. Use ${dedicated}, which confines the path to GOG_FILE_ROOTS.`,
    );
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (SHORT_PATH_CLUSTER.test(arg)) {
      throw new Error(
        `The flag ${arg} is not allowed here: spell a path flag out as --out or --file (e.g. --out=<path>) so its path can be checked against GOG_FILE_ROOTS.`,
      );
    }
    const match = LONG_FLAG.exec(arg);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (EXEC_FLAGS.has(name)) {
      throw new Error(`The flag --${name} is not allowed here: it runs a local program chosen by the caller.`);
    }
    const isJson = name.endsWith('-json');
    if (!isJson && !isPathFlag(service, name)) continue;
    let value = match[2];
    if (value === undefined) {
      value = args[i + 1];
      if (value === undefined) continue;
      i++;
    }
    if (isJson) {
      // Inline JSON passes; `@path` reads a file, `@-` reads stdin.
      if (value.startsWith('@')) confineFlagValue(`--${name}`, value.slice(1));
      continue;
    }
    confineFlagValue(`--${name}`, value);
  }
}
