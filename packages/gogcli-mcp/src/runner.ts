import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChildProcess } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { parseBoolEnv, readEnvVar, redactSecrets as redactSharedSecrets } from '@chrischall/mcp-utils';

export type Spawner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcess;

// A payload too large to live in argv. Every argv element is capped — the Fly
// runner rejects args over 4 KiB, and the Linux kernel hard-caps a single argv
// string at MAX_ARG_STRLEN (128 KiB) regardless of ARG_MAX — so big values
// (a long HTML mail body, slide notes) must leave argv entirely. gog exposes
// `--x-file` companions for exactly these flags; the executor writes the
// payload to a private temp file and passes the path instead.
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
   * upload <localPath>` is the only one today. Argument ORDER is preserved by
   * every executor, so a positional file arg lands exactly where it sat in the
   * caller's array.
   */
  positional?: boolean;
}

export type GogArg = string | GogFileArg;

export function isGogFileArg(arg: GogArg): arg is GogFileArg {
  return typeof arg !== 'string';
}

// An executor runs a FULLY-ASSEMBLED gog arg list (already including
// --json/--no-input/--color=never, --account, --readonly, and the service
// subcommand) and returns its stdout as a string (or throws). This is the
// injection seam that lets the same tool registrars run either by spawning
// `gog` (stdio transport) or by forwarding the arg list to a remote HTTP
// backend (hosted Cloudflare-Worker connector, which cannot spawn processes).
// Elements may be GogFileArgs; EVERY executor is responsible for materializing
// them to a private temp file and removing that file afterwards.
export type GogExecutor = (
  args: GogArg[],
  opts: { timeout?: number; interactive?: boolean },
) => Promise<string>;

// Which layer authored a failure, when the layer was OURS and not gog's.
//
// A remote executor (the Fly/Worker path) can fail in two categorically
// different ways, and every consumer downstream needs to tell them apart:
//
//   - `gog` ran on the backend and failed. The message is gog's — or Google's,
//     relayed by gog — so it is PROSE, and the only way to classify it is to
//     read it. That failure is NOT a RunnerTransportError; it stays a plain
//     Error so tools/utils.ts keeps applying its patterns to it.
//   - The request never got that far: the runner rejected our bearer token,
//     refused the request shape, was draining, or never answered. Nothing was
//     ever shown to Google, so no amount of re-authorizing a Google account can
//     help — and the runner's own words ("unauthorized") are indistinguishable
//     from Google's when read as prose. That is what this type exists for.
//
// The kinds, and what each one asks of the caller:
//   transport-auth      the runner rejected OUR bearer (GOG_RUNNER_KEY on the
//                       Worker vs RUNNER_KEY on the Fly app). An operator has
//                       to fix a key; the end user's Google grant is fine.
//   transport-request   the runner refused the request shape (oversized arg,
//                       malformed JSON). Deterministic; retrying is pointless.
//   transport-retryable the runner is draining, could not reach its disk, or
//                       never answered. The same call can succeed shortly.
export type RunnerFailureKind = 'transport-auth' | 'transport-request' | 'transport-retryable';

// `Symbol.for`, not a private symbol or a bare `instanceof`: the class can be
// evaluated more than once in one process (the stdio bundle and the Worker
// bundle are separate builds of the same source, and vitest can load a module
// twice across pools), and a second copy of the class would make `instanceof`
// answer false for an error that IS one. The registry symbol is the same value
// in every copy, so the brand survives.
const RUNNER_TRANSPORT_BRAND = Symbol.for('gogcli.RunnerTransportError');

/**
 * A failure authored by the gog-runner itself (or by the hop to it) rather than
 * by `gog`/Google. Carries the runner's HTTP status when there was one.
 */
export class RunnerTransportError extends Error {
  readonly kind: RunnerFailureKind;
  readonly status: number | undefined;

  constructor(message: string, kind: RunnerFailureKind, status?: number) {
    super(message);
    this.name = 'RunnerTransportError';
    this.kind = kind;
    this.status = status;
    // Non-enumerable so the brand never shows up in a serialized error body.
    Object.defineProperty(this, RUNNER_TRANSPORT_BRAND, { value: true });
  }
}

/** Structural check for the above — see RUNNER_TRANSPORT_BRAND on why not `instanceof`. */
export function isRunnerTransportError(err: unknown): err is RunnerTransportError {
  return err instanceof Error && (err as unknown as Record<symbol, unknown>)[RUNNER_TRANSPORT_BRAND] === true;
}

// Ambient override for the executor `run()` uses when no options.spawner is
// given. The Worker/Fly path wraps request handling in
// `runExecutor.run({ executor }, ...)`; unset, `run()` falls back to spawning.
export const runExecutor = new AsyncLocalStorage<{ executor: GogExecutor }>();

/**
 * The PROCESS-WIDE executor, for a host that has exactly one backend for the
 * whole process — a stdio bin pointed at a Fly runner (`useRemoteGogRunner`).
 *
 * It exists because AsyncLocalStorage cannot express that. `enterWith` sets the
 * store on the async resource that is current when it runs, and a bin runs it
 * during module evaluation; the tool calls arrive later as I/O events on the
 * transport's own resources, which are not descendants of that evaluation, so
 * `getStore()` is undefined exactly where it is needed. That is not a bug in
 * `enterWith` — a process-lifetime default is simply not a scoped value, and
 * storing it in a scope meant the seam silently reverted to spawning a binary
 * the host does not have.
 *
 * A per-request store still WINS over this (see `activeExecutor`), because the
 * Worker serves many callers from one isolate and each has its own backend
 * credential; this is the fallback for the one-backend case, never a second
 * answer to "whose backend is this".
 */
let defaultExecutor: { executor: GogExecutor } | undefined;

/** Install the process-wide executor. Passing undefined clears it (tests). */
export function setDefaultGogExecutor(executor: GogExecutor | undefined): void {
  defaultExecutor = executor ? { executor } : undefined;
}

/**
 * Whose executor applies right now: the request's, else the process's, else
 * none (meaning `run()` spawns the local binary). Both call sites ask through
 * here so they can never disagree about which of the three it is.
 */
function activeExecutor(): { executor: GogExecutor } | undefined {
  return runExecutor.getStore() ?? defaultExecutor;
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
export const MIN_GOG_VERSION = '0.38.3';

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
//
// node:fs/promises and node:os are imported LAZILY (matching the lazy
// node:child_process import below) so a Cloudflare Worker importing this module
// doesn't eagerly pull node builtins, which would break the Worker bundle.
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

// Spawn-based executor. Deliberately NOT async: when no element is a
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
// returns raw output (no redaction — `run()` wraps that around whichever
// executor runs). The child_process import is LAZY so a Cloudflare Worker
// importing this module doesn't eagerly pull node:child_process (which would
// break the Worker bundle); the injected `spawner` bypasses it.

async function spawnGog(
  fullArgs: string[],
  opts: { timeout?: number; interactive?: boolean; spawner?: Spawner; binary?: boolean },
): Promise<string> {
  const { timeout, interactive = false, spawner, binary = false } = opts;
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

  // Pick the executor: an injected spawner keeps the stdio spawn path (and all
  // its tests) intact and always wins; otherwise an ambient runExecutor store
  // (the Worker/Fly HTTP-forward path) takes over; otherwise the default lazy
  // real spawn. Redaction wraps the executor regardless of which one runs — a
  // successful `gog auth tokens` (or any command echoing a credential) would
  // otherwise return raw Google tokens (ya29.…/1//…) into model context, where
  // a sibling tool (gog_gmail_send) could exfiltrate them.
  const store = activeExecutor();
  try {
    let output: string;
    if (spawner) {
      output = await spawnExecutor(fullArgs, { timeout, interactive, spawner });
    } else if (store) {
      output = await store.executor(fullArgs, { timeout, interactive });
    } else {
      output = await spawnExecutor(fullArgs, { timeout, interactive });
    }
    return redact(output);
  } catch (err) {
    // A thrown non-Error would make `.message` undefined and redact() blow up
    // with a TypeError, masking the real failure. Same instanceof guard the
    // codebase already uses in errorText() (tools/utils.ts).
    const message = base(err instanceof Error ? err.message : String(err));
    // Redaction must not cost the error its TYPE. `RunnerTransportError` is the
    // structural claim "this failure was ours, not Google's"; flattening it to a
    // bare Error here would put diagnose() straight back to guessing from prose,
    // which is the bug this type exists to close. Rebuilt rather than mutated so
    // the un-redacted message never survives anywhere.
    if (isRunnerTransportError(err)) {
      throw new RunnerTransportError(message, err.kind, err.status);
    }
    throw new Error(message);
  }
}

// Run gog and return its stdout as raw bytes, base64-encoded — for binary
// payloads (a Drive file's bytes) that run()'s utf8 decode + secret redaction
// would corrupt. Spawn path only: the hosted-connector executor forwards over
// HTTP and hands back a decoded string, so binary cannot survive it — callers
// on that path get a clear error instead of a mangled file. No redaction: the
// base64 of a user's own binary file is opaque and has no token shapes to leak.
export async function runBinary(args: GogArg[], options: RunOptions = {}): Promise<string> {
  const { account, spawner, timeout, readonly = false } = options;
  // An injected spawner is the stdio/test path and always wins. Otherwise, if an
  // ambient forward executor is installed (the Worker/Fly connector), refuse:
  // its text-only transport can't carry bytes intact.
  if (!spawner && activeExecutor()) {
    throw new Error(
      'Raw byte retrieval is not available over the hosted connector (its transport is text-only). ' +
      'Use the text-extraction path instead, or run the local stdio server to fetch bytes.',
    );
  }
  const fullArgs = assembleArgs(args, { account, interactive: false, readonly });
  return spawnExecutor(fullArgs, { timeout, interactive: false, spawner, binary: true });
}
