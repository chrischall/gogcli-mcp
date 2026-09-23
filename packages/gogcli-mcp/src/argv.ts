// Positional-argument marking for gog argv (audit BUG-1).
//
// A tool's positional values — a Gmail query, a file ID, a range, a name — are
// chosen by the model. Pushed as bare argv elements, one that starts with '-'
// is parsed by gog (kong) as a flag: `gog gmail search "-in:spam"` fails with
// "unknown flag -i", and a value starting with `--` becomes a real gog flag.
// Wrapping each value in pos() tells the runner to place it after a single
// `--`, after every flag, which is how upstream gogcli's own MCP tools call it
// (internal/cmd/mcp_tools.go).
//
// Lives outside runner.ts on purpose: tool tests automock the runner module,
// and pos() must stay a real function there.

export interface GogPositional {
  /** Discriminant separating this from a plain argv string and a GogFileArg. */
  kind: 'positional';
  value: string;
}

/** Mark a model-supplied positional value so it is passed after `--`. */
export function pos(value: string): GogPositional {
  return { kind: 'positional', value };
}

export function isGogPositional(arg: unknown): arg is GogPositional {
  return typeof arg === 'object' && arg !== null && (arg as { kind?: unknown }).kind === 'positional';
}
