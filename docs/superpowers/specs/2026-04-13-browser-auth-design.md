# Browser-Based Auth Flow for gogcli-mcp

## Summary

Add a `gog_auth_add` MCP tool that runs the default `gog auth add` browser flow, opening the user's browser for Google OAuth and blocking until completion. This gives users a one-click auth experience without leaving Claude.

## Runner Changes

### `RunOptions` additions (`src/runner.ts`)

Add two optional fields to the existing `RunOptions` interface:

```ts
export interface RunOptions {
  account?: string;
  spawner?: Spawner;
  interactive?: boolean;  // NEW: when true, omit --no-input
  timeout?: number;       // NEW: override default 30s timeout (ms)
}
```

### Behavior changes in `run()`

- When `interactive` is `true`, do NOT inject `--no-input` into `fullArgs`.
- When `timeout` is provided, use it instead of the `TIMEOUT_MS` constant.
- When `interactive` is `true` and the process exits successfully (code 0), append any captured stderr to the stdout result. This ensures the fallback URL ("If the browser doesn't open, visit this URL") reaches Claude even on success.
- When `timeout` is provided, the timeout error message includes the human-readable duration: e.g., `"gog timed out after 300000ms (5 minutes)"` so both the raw value and friendly form are visible.

### Default behavior

Unchanged. Existing calls without `interactive` or `timeout` behave exactly as before.

## New Tool: `gog_auth_add`

### Registration (`src/tools/auth.ts`)

- **Name:** `gog_auth_add`
- **Annotations:** `{ destructiveHint: true }`
- **Input schema:**
  - `email` — required `z.string()`, Google account email to authorize
  - `services` — optional `z.string()`, default `"all"`, comma-separated services or `"all"`
- **Handler:** Calls `run(['auth', 'add', email, '--services', services], { interactive: true, timeout: 300_000 })`
- **Error handling:** Standard `toError()` wrapping, same as other auth tools.

### Tool description

The description tells Claude:

1. This opens a browser window for Google OAuth
2. The user must complete authorization in the browser
3. The tool blocks for up to 5 minutes waiting for completion
4. If the browser doesn't open automatically, a fallback URL is included in the response

### `gog_auth_run` description update

Remove the "gog auth add requires interactive browser auth and cannot be completed over MCP" caveat. Replace with a note pointing to `gog_auth_add` for browser-based authorization.

## Manifest update

Add `gog_auth_add` to the `manifest.json` tools list.

## Error Handling

| Scenario | Behavior |
|---|---|
| User completes auth in browser | Tool returns success with gogcli output |
| User doesn't complete within 5 min | Process killed, error: "gog auth timed out after 5 minutes" |
| User cancels/denies in browser | gogcli exits non-zero, stderr returned as error |
| Browser doesn't open | Fallback URL included in response via stderr capture |
| Already authorized account | gogcli re-authorizes (updates scopes), no special handling |

## Testing

### Runner tests (`tests/runner.test.ts`)

- `interactive: true` omits `--no-input` from args
- Custom `timeout` is respected (process killed at custom time, not 30s)
- `interactive: true` on success appends stderr to stdout result
- `interactive: false` (or omitted) still includes `--no-input` (regression)
- Timeout error message includes human-readable duration

### Auth tool tests (`tests/tools/auth.test.ts`)

- `gog_auth_add` passes correct args to runner with `interactive: true` and `timeout: 300_000`
- `gog_auth_add` defaults services to `"all"` when omitted
- `gog_auth_add` passes custom services when provided
- `gog_auth_add` returns error text on failure
- `gog_auth_add` returns error text on timeout
