import type { ChildProcess } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { currentCallSignal, killOnCancel, parseBoolEnv, readEnvVar, redactSecrets as redactSharedSecrets } from '@chrischall/mcp-utils';
import { naiveSourceTimeZone } from './timestamps.js';

export type Spawner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcess;

// A payload too large to live in argv. The Linux kernel hard-caps a single argv
// string at MAX_ARG_STRLEN (128 KiB) regardless of ARG_MAX, so big values (a
// long HTML mail body, slide notes) must leave argv entirely. gog exposes
// `--x-file` companions for exactly these flags; the runner writes the payload
// to a private temp file and passes the path instead.
export interface GogFileArg {
  /** Discriminant separating this from a plain argv string. */
  kind: 'file';
  /**
   * Flag NAME without leading dashes, e.g. 'body-html-file'. The materialized
   * path is passed as `--<flag>=<path>`, EXCEPT when `positional` is set, where
   * this names the temp file's parent directory and nothing else.
   */
  flag: string;
  /**
   * The payload. Text verbatim when `encoding` is 'utf8' (the default); the
   * base64 spelling of the bytes when it is 'base64'.
   */
  contents: string;
  /** Temp-file extension without the dot, e.g. 'html'. Defaults to 'txt'. */
  ext?: string;
  /**
   * How to interpret `contents` when writing it. 'utf8' (default) preserves the
   * existing text-payload behaviour exactly; 'base64' decodes first, which is
   * what lets a caller hand over a PNG or a PDF without a shared filesystem.
   */
  encoding?: 'utf8' | 'base64';
  /**
   * Exact basename for the temp file, overriding the `<flag>.<ext>` default.
   *
   * Load-bearing for attachments: gog reads the MIME part's filename off the
   * path it is given, so a file materialized as `attach.txt` would arrive in the
   * recipient's mailbox named `attach.txt` no matter what the caller called it.
   * Callers MUST pass an already-sanitized single path segment.
   */
  filename?: string;
  /**
   * Emit the materialized path as a BARE argv element instead of `--flag=path`.
   *
   * For subcommands taking the file as a positional argument — `gog drive
   * upload <localPath>` is the only one today. Argument ORDER is preserved, so
   * a positional file arg lands exactly where it sat in the caller's array.
   */
  positional?: boolean;
}

export type GogArg = string | GogFileArg;

export function isGogFileArg(arg: GogArg): arg is GogFileArg {
  return typeof arg !== 'string';
}

export interface RunOptions {
  account?: string;
  spawner?: Spawner;
  interactive?: boolean;
  timeout?: number;
  // Inject gog's global --readonly flag, which blocks mutating API requests at
  // runtime. Independent of (and OR-ed with) the GOG_READONLY env var.
  readonly?: boolean;
  // How aggressively to redact the output/error before it reaches the client.
  // 'full' (default) runs the shared mcp-utils redactor plus the Google token
  // shapes. 'tokens' runs ONLY the Google token shapes (ya29.…/1//…) — use it
  // for output that is known-safe but that the broad shared redactor mangles,
  // most notably an OAuth consent URL whose `classroom.coursework.students`-style
  // scope names the shared redactor mistakes for secrets. A step-1 auth URL
  // carries no token, so stripping only real token shapes keeps it intact while
  // still catching any token that unexpectedly appears.
  redactMode?: 'full' | 'tokens';
  // JSON string fields whose values are OPAQUE binary payloads this wrapper
  // asked for by name — `contentBase64` from `gog gmail attachment --inline`
  // being the only one today. Their values are lifted out before redaction runs
  // and put back verbatim afterwards.
  //
  // Redaction exists to catch a credential that leaked into PROSE. A base64
  // blob is not prose: it is uniformly-distributed bytes over a 64-character
  // alphabet, so given enough of them it will eventually contain the literal
  // spelling of any short secret shape by chance alone — `1//` at ~30% per
  // attachment (see TOKEN_LEFT_BOUNDARY), and `AIza…` at ~0.2% even after that
  // anchor lands. Boundary-anchoring the patterns fixes the common case;
  // exempting the field fixes the CLASS, and keeps a future pattern added to
  // mcp-utils from silently re-breaking attachments.
  //
  // Deliberately narrow in three ways: it is opt-in per call, only the named
  // key is exempt, and only a value that is ENTIRELY base64 alphabet qualifies
  // (see OPAQUE_FIELD_VALUE) — so a field carrying real prose, which is where a
  // real leaked token would live, still gets redacted normally.
  opaqueFields?: readonly string[];
}

const TIMEOUT_MS = 30_000;

// Minimum gogcli (`gog`) binary version this wrapper's tools assume. Some tools
// pass flags/subcommands that only exist in newer gog, so bump this whenever a
// change starts relying on a newer gog feature — and label that PR `gogcli-bump`
// so the requirement change is surfaced in the release notes (see
// .github/release.yml). This is the single source of truth for the required
// version; keep the README/CLAUDE.md mention in sync.
export const MIN_GOG_VERSION = '0.41.0';

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
//
// `_KEY`, not `_API_KEY|_PRIVATE_KEY`: those were four spellings of "a key"
// with the bare one missing, and a credential this repo hands its own process
// fell in that gap. `MCP_BLOB_SIGNING_KEY` mints the signed blob URLs a
// `deliver="url"` download is uploaded to — a signature IS the whole access
// control on that store — and it is spent HERE, never read by the child.
// `_CREDENTIALS` generalises the named
// GOOGLE_APPLICATION_CREDENTIALS above, which stays named because it is the
// one gog itself would act on.
//
// The list is bounded by what the child LEGITIMATELY READS, which is why
// `_PASSWORD` is deliberately NOT on it: `GOG_KEYRING_PASSWORD` decrypts gog's
// own file keyring (`GOG_KEYRING_BACKEND=file`), so that rule would strip the
// one credential the child needs and turn every call into an auth failure.
// Both directions are tested — a widening with no control case is a guess.
function sanitizedEnv(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'GOG_ACCESS_TOKEN') continue;
    if (key === 'GOOGLE_APPLICATION_CREDENTIALS') continue;
    if (/(_TOKEN|_SECRET|_KEY|_CREDENTIALS)$/.test(key)) continue;
    result[key] = value;
  }
  return result;
}

// The LEFT boundary every Google token shape below is anchored on, and the
// reason this file has a regression test named after a PNG.
//
// `1//` is three characters drawn entirely from the standard base64 alphabet,
// so the unanchored pattern `1\/\/[A-Za-z0-9._-]+` matches inside ANY base64
// blob that happens to contain that run — and then eats forward to the next
// `+` or `/`, deleting a slab out of the middle of the payload. `gog gmail
// attachment --inline` returns the attachment bytes as base64 in its JSON, that
// JSON goes through `run()`, and `run()` redacts. The result was a mangled
// `contentBase64` and an MCP protocol error at the client ("Invalid Base64
// string") on roughly a THIRD of all attachments — measured, not estimated: a
// 72 KiB file is ~97k base64 chars and the expected number of `1//` runs is
// n/64³ ≈ 0.37, i.e. P(corrupt) ≈ 30%.
//
// That coin-flip is what made the bug look like it was about FILENAMES: it
// correlates with nothing a reader can see, so two attachments in one thread
// differing only in name would land on opposite sides of it. It is content, not
// name — the runner has always spawned with an argv array and never a shell, so
// spaces in a filename were never able to split anything.
//
// A real token never appears WELDED to base64 text: it is delimited by a quote,
// whitespace, `=`, `:`, `&`, a bracket, or the start of the string. So requiring
// a non-base64 character (or nothing) to its left keeps every genuine detection
// and drops the mid-blob false positives, which by construction are always
// preceded by another base64 character.
//
// The class is EXACTLY the standard base64 alphabet, and no wider. Every
// character omitted from it is a delimiter a real token is found after, so each
// one added would silently cost a detection: `=` in particular would stop
// `refresh_token=1//0e…` and `access_token=ya29.…` — the form-encoded spelling,
// which the shared redactor's query-param rule does not catch without a
// preceding `?`/`&` — from being redacted at all. `=` is also unnecessary here,
// since base64 padding is terminal and can never precede a mid-blob `1//`.
// Likewise `.`, `_` and `-`: none occurs in standard base64, and `1//` cannot
// occur in base64url (which has no `/`), so neither alphabet needs them.
const TOKEN_LEFT_BOUNDARY = '(?<![A-Za-z0-9+/])';

// Redact bearer/refresh-token patterns from error text before surfacing
// it back to the MCP client. If gog ever emits a token in stderr (e.g.
// from a verbose log mode), this prevents it from leaking to the model.
// The shared mcp-utils redactSecrets covers Bearer/Basic headers, JWTs,
// cookies, well-known key shapes (incl. Google AIza… API keys), and secret
// query params — but not Google's OAuth2 token shapes, so those stay here.
const GOOGLE_TOKEN_PATTERNS: RegExp[] = [
  new RegExp(`${TOKEN_LEFT_BOUNDARY}ya29\\.[A-Za-z0-9._\\-]+`, 'g'),  // OAuth2 access tokens
  new RegExp(`${TOKEN_LEFT_BOUNDARY}1//[A-Za-z0-9._\\-]+`, 'g'),      // OAuth2 refresh tokens
];
// Strip only Google's OAuth2 token shapes. Precise enough to leave an OAuth
// consent URL (client_id, scope names, state, code_challenge) untouched.
export function redactGoogleTokens(text: string): string {
  let redacted = text;
  for (const re of GOOGLE_TOKEN_PATTERNS) {
    redacted = redacted.replace(re, '[REDACTED]');
  }
  return redacted;
}
export function redactSecrets(text: string): string {
  return redactGoogleTokens(redactSharedSecrets(text));
}

// A JSON string value that is ENTIRELY standard/URL-safe base64 (plus padding),
// and long enough to be a payload rather than a flag. Anything else — a path, a
// MIME type, a sentence, an OAuth token sitting in prose — fails this and is
// redacted normally, which is what keeps the exemption from becoming a hole.
const OPAQUE_FIELD_VALUE = '[A-Za-z0-9+/_-]{16,}={0,2}';

// Placeholder standing in for a lifted value while redaction runs.
//
// NUL-delimited because NUL cannot occur in gog's output: stdout is decoded as
// UTF-8 text and JSON escapes it as a backslash-u escape, so the placeholder can never
// collide with real content the way a printable sentinel could. The body
// contains no character any redaction pattern keys on, and the index keeps each
// one unique so two blobs can never be swapped on restore.
const opaquePlaceholder = (i: number): string => `\u0000gogOpaque${i}\u0000`;

/**
 * Redact `text` while leaving the values of `fields` untouched.
 *
 * Lift each `"field":"<base64>"` value out to a placeholder, redact what
 * remains, then put the values back. Splicing rather than parsing keeps this on
 * the raw string: `run()` returns text, gog's output is not always JSON, and a
 * parse/re-serialize round trip would rewrite key order and number formatting
 * in output the caller may be matching on.
 */
export function redactPreservingOpaqueFields(
  text: string,
  fields: readonly string[],
  redact: (input: string) => string,
): string {
  const lifted: string[] = [];
  let staged = text;
  for (const field of fields) {
    // The key is escaped because it reaches a RegExp; the value class is fixed
    // above, so a base64 payload can never terminate its own string early.
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`("${escaped}"\\s*:\\s*")(${OPAQUE_FIELD_VALUE})(")`, 'g');
    staged = staged.replace(re, (_m, open: string, value: string, close: string) => {
      lifted.push(value);
      return `${open}${opaquePlaceholder(lifted.length - 1)}${close}`;
    });
  }
  if (lifted.length === 0) return redact(text);
  let redacted = redact(staged);
  lifted.forEach((value, i) => {
    redacted = redacted.split(opaquePlaceholder(i)).join(value);
  });
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

// Write every GogFileArg to a private temp file, run gog against the resulting
// plain argv, and remove the temp dir afterwards — on success, on a non-zero
// exit, and on timeout alike. A leaked temp file holds user email content.
async function spawnWithTempFiles(
  args: GogArg[],
  opts: { timeout?: number; interactive?: boolean; spawner?: Spawner; binary?: boolean },
): Promise<string> {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  // mkdtemp creates the directory with mode 0700 (owner-only) on POSIX, so the
  // payload is never world-readable, not even for the instant between the
  // directory appearing and writeFile's own 0600 mode landing.
  const dir = await mkdtemp(join(tmpdir(), 'gogcli-mcp-'));
  try {
    const argv: string[] = [];
    let seq = 0;
    for (const arg of args) {
      if (!isGogFileArg(arg)) {
        argv.push(arg);
        continue;
      }
      // Each payload gets its own numbered SUBDIRECTORY, so the basename is free
      // to be whatever the caller needs without any risk of one payload
      // clobbering another. That matters twice over now: `--attach` is
      // repeatable, so a single send can carry several files whose real names
      // are chosen by the caller and may well collide (two `chart.png`s from
      // different folders), and an attachment's basename is what the recipient
      // sees, so it cannot be uniquified by mangling it.
      const sub = join(dir, String(seq));
      seq += 1;
      await mkdir(sub, { recursive: true, mode: 0o700 });
      const path = join(sub, arg.filename ?? `${arg.flag}.${arg.ext ?? 'txt'}`);
      // 'base64' decodes to the real bytes; 'utf8' writes the string as-is,
      // which is the pre-existing behaviour for every text payload.
      const data = arg.encoding === 'base64'
        ? Buffer.from(arg.contents, 'base64')
        : Buffer.from(arg.contents, 'utf8');
      await writeFile(path, data, { mode: 0o600 });
      argv.push(arg.positional ? path : `--${arg.flag}=${path}`);
    }
    return await spawnGog(argv, opts);
  } finally {
    // Never let a cleanup failure mask the real gog error (or a real result).
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Spawn gog, materializing GogFileArgs first. Deliberately NOT async: when no element is a
// GogFileArg (the overwhelmingly common case) it must create no temp dir and
// introduce no extra microtask tick before `spawn` is called — the spawn has
// to happen synchronously within the `run()` call, which the fake-timer tests
// in tests/runner.test.ts depend on.
function spawnExecutor(
  args: GogArg[],
  opts: { timeout?: number; interactive?: boolean; spawner?: Spawner; binary?: boolean },
): Promise<string> {
  if (args.some(isGogFileArg)) {
    return spawnWithTempFiles(args, opts);
  }
  return spawnGog(args as string[], opts);
}

// Owns everything process-specific — building the sanitized child env, PATH
// augmentation, spawning, collecting stdout/stderr, and the timeout kill. It
// returns raw output (no redaction — `run()` wraps that around it). The
// injected `spawner` bypasses the real child_process spawn.
async function spawnGog(
  fullArgs: string[],
  opts: { timeout?: number; interactive?: boolean; spawner?: Spawner; binary?: boolean },
): Promise<string> {
  const { timeout, interactive = false, spawner, binary = false } = opts;
  const spawn = spawner ?? (await import('node:child_process')).spawn as unknown as Spawner;
  const effectiveTimeout = timeout ?? TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // gog must format naive dates in the zone normalizeTimestamps assumes; left
    // to itself it falls back to the host's local zone (UTC on mcp-host).
    const childEnv = { ...sanitizedEnv(), GOG_TIMEZONE: naiveSourceTimeZone(), PATH: augmentedPath() };
    const child = spawn(readEnvVar('GOG_PATH') ?? 'gog', fullArgs, { env: childEnv });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    // THE CALLER GIVING UP KILLS THE CHILD (mcp-utils `cancel`). Until this,
    // a cancelled tool call left a whole `gog` process running to the
    // timeout below — still talking to Google, still charged to the CPU a
    // hosted child is metered on, for somebody who has gone. Measured on the
    // mcp-host fleet: claude.ai sent 101 cancellations in the week to
    // 2026-09-20, and every one of them was ignored here.
    //
    // The signal is ambient rather than passed: `surfaceToolHints` puts it
    // in scope for the whole handler, so this works for every tool in every
    // package without one of them threading it through.
    const cancelled = currentCallSignal();
    const stopWatchingCancel = killOnCancel(child);
    const stopWatching = (): void => {
      clearTimeout(timer);
      stopWatchingCancel();
    };

    const timer = setTimeout(() => {
      settled = true;
      stopWatchingCancel();
      child.kill();
      reject(new Error(`gog timed out after ${formatTimeout(effectiveTimeout)}`));
    }, effectiveTimeout);

    child.stdout!.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

    child.on('close', (code: number | null) => {
      stopWatching();
      if (settled) return;
      settled = true;
      // A child WE killed because the caller left exits with no code and no
      // stderr, which the branch below would report as `gog exited with code
      // null` — a sentence about gogcli for something gogcli did not do. The
      // caller's own reason is the honest error.
      if (cancelled?.aborted) {
        reject(cancelled.reason instanceof Error ? cancelled.reason : new Error('the caller cancelled this call'));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      if (code === 0) {
        // Binary mode: return the raw stdout bytes base64-encoded, never a utf8
        // string (which would corrupt a PDF/image). No stderr append.
        if (binary) {
          resolve(Buffer.concat(stdoutChunks).toString('base64'));
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString();
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
      stopWatching();
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

// Assemble the full gog argv: the always-injected flags (--json/--color=never,
// --no-input unless interactive, --readonly when opted in), --account, then the
// caller's args. Shared by run() and runBinary() so both get identical flags.
function assembleArgs(
  args: GogArg[],
  opts: { account?: string; interactive: boolean; readonly: boolean },
): GogArg[] {
  const effectiveAccount = opts.account ?? readEnvVar('GOG_ACCOUNT');
  const fullArgs: GogArg[] = ['--json', '--color=never'];
  if (!opts.interactive) {
    fullArgs.push('--no-input');
  }
  // Block all mutating gog API requests at runtime when either the caller opts
  // in or GOG_READONLY is set in the environment. gog has no native env binding
  // for --readonly, so the wrapper translates GOG_READONLY into the flag.
  if (opts.readonly || readonlyEnvEnabled()) {
    fullArgs.push('--readonly');
  }
  if (effectiveAccount) {
    fullArgs.push('--account', effectiveAccount);
  }
  fullArgs.push(...args);
  return fullArgs;
}

export async function run(args: GogArg[], options: RunOptions = {}): Promise<string> {
  const { account, spawner, interactive = false, timeout, readonly = false, redactMode = 'full', opaqueFields } = options;
  const base = redactMode === 'tokens' ? redactGoogleTokens : redactSecrets;
  // Only OUTPUT carries opaque payloads. An error message is prose by
  // definition, so it always takes the plain redactor — exempting a field there
  // would be exempting exactly the text a leaked token would appear in.
  const redact = opaqueFields?.length
    ? (text: string): string => redactPreservingOpaqueFields(text, opaqueFields, base)
    : base;

  const fullArgs = assembleArgs(args, { account, interactive, readonly });

  // Redaction wraps the spawn: a successful `gog auth tokens` (or any command
  // echoing a credential) would otherwise return raw Google tokens (ya29.…/1//…)
  // into model context, where a sibling tool (gog_gmail_send) could exfiltrate
  // them.
  try {
    return redact(await spawnExecutor(fullArgs, { timeout, interactive, spawner }));
  } catch (err) {
    // A thrown non-Error would make `.message` undefined and redact() blow up
    // with a TypeError, masking the real failure. Same instanceof guard the
    // codebase already uses in errorText() (tools/utils.ts).
    throw new Error(base(err instanceof Error ? err.message : String(err)));
  }
}

// Run gog and return its stdout as raw bytes, base64-encoded — for binary
// payloads (a Drive file's bytes) that run()'s utf8 decode + secret redaction
// would corrupt. No redaction: the base64 of a user's own binary file is opaque
// and has no token shapes to leak.
export async function runBinary(args: GogArg[], options: RunOptions = {}): Promise<string> {
  const { account, spawner, timeout, readonly = false } = options;
  const fullArgs = assembleArgs(args, { account, interactive: false, readonly });
  return spawnExecutor(fullArgs, { timeout, interactive: false, spawner, binary: true });
}
