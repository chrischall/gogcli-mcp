// Guards for argv this wrapper does NOT build itself.
//
// The `gog_<service>_run` escape hatches forward a model-supplied string[]
// verbatim. gog (kong) takes the LAST value of a repeated flag, so an arg like
// `--readonly=false` placed after the runner's injected `--readonly` silently
// re-enables writes on a deployment the operator locked read-only — the one
// kill switch an operator can set (audit SEC-1). The same holds for every
// other global that is a control rather than an option: the command allow/deny
// lists, the credential source (`--access-token`, `--home`, `--client`), the
// account, `--gmail-no-send` and `--no-input`.
//
// A bare `--` is refused as well. It ends flag parsing, so anything the wrapper
// appends AFTER it (a safety flag appended last, for instance) would be read as
// a positional and quietly dropped.
//
// Kept out of runner.ts on purpose: tool tests automock the runner module, and
// these checks have to run for real inside the tool handlers.

// Long-flag names whose override the model must never control. Matched as
// PREFIXES (per the audit brief), so `--readonly=false`, `--readonly` and any
// longer spelling all fail — gog has no flag abbreviation, so a prefix match
// costs nothing legitimate.
const FORBIDDEN_LONG_PREFIXES = [
  '--readonly',
  '--enable-commands', // also covers --enable-commands-exact
  '--disable-commands',
  '--access-token',
  '--home',
  '--account',
  '--acct', // kong alias of --account
  '--client',
  '--gmail-no-send',
  '--no-input',
  '--non-interactive', // kong aliases of --no-input
  '--noninteractive',
];

// `-a` is the short form of --account. kong accepts short-flag CLUSTERS
// (`-ja` = `-j -a`) and an attached value (`-aother@x`), so any single-dash
// token whose letters include `a` is refused. `-5` (a negative number) and
// `-y` (force) are unaffected.
const SHORT_ACCOUNT_CLUSTER = /^-(?!-)[A-Za-z]*a/;

/** Why `arg` may not be forwarded to gog, or undefined when it is fine. */
export function forbiddenArgReason(arg: string): string | undefined {
  if (arg === '--') {
    return 'The argument "--" is not allowed: it ends flag parsing and would disable safety flags appended after it.';
  }
  const lower = arg.toLowerCase();
  const prefix = FORBIDDEN_LONG_PREFIXES.find((p) => lower.startsWith(p));
  if (prefix) {
    return `The flag ${arg} is not allowed here: ${prefix} is a safety/credential control set by the server operator, not a per-call option.`;
  }
  if (SHORT_ACCOUNT_CLUSTER.test(arg)) {
    return `The flag ${arg} is not allowed here: -a selects the account. Use the tool's account parameter instead.`;
  }
  return undefined;
}

/** Throw on the first model-supplied arg that would override a gog safety control. */
export function assertSafeForwardedArgs(args: readonly string[]): void {
  for (const arg of args) {
    const reason = forbiddenArgReason(arg);
    if (reason) throw new Error(reason);
  }
}

// A gog subcommand is a lower-case word, possibly hyphenated (`mark-read`).
// Anything else — a flag, an empty string, a path — is a smuggling attempt or a
// mistake, and gog would parse it as something other than a subcommand.
const SUBCOMMAND_SHAPE = /^[a-z][a-z0-9-]*$/;

export function assertSafeSubcommand(subcommand: string): void {
  if (!SUBCOMMAND_SHAPE.test(subcommand)) {
    throw new Error(
      `Invalid subcommand ${JSON.stringify(subcommand)}: pass a single gog subcommand name such as "list" or "mark-read", and put its arguments in args.`,
    );
  }
}
