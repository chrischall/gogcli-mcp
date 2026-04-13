# Browser-Based Auth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gog_auth_add` MCP tool that opens the user's browser for Google OAuth and blocks until completion.

**Architecture:** Extend `RunOptions` with `interactive` and `timeout` fields. Add a dedicated `gog_auth_add` tool that uses these options to run the blocking browser auth flow. Existing runner behavior is unchanged for all other tools.

**Tech Stack:** TypeScript, vitest, zod, @modelcontextprotocol/sdk

---

### Task 1: Runner — add `interactive` option (skip `--no-input`)

**Files:**
- Modify: `src/runner.ts:4-5` (RunOptions interface)
- Modify: `src/runner.ts:17-22` (run function)
- Test: `tests/runner.test.ts`

- [ ] **Step 1: Write the failing test for `interactive: true` omitting `--no-input`**

Add to `tests/runner.test.ts` inside the existing `describe('run', ...)`:

```ts
it('omits --no-input when interactive is true', async () => {
  const spawner = makeSpawner(0, '{"ok":true}');
  await run(['auth', 'add', 'user@gmail.com'], { spawner, interactive: true });
  const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
  expect(callArgs).toContain('--json');
  expect(callArgs).toContain('--color=never');
  expect(callArgs).not.toContain('--no-input');
  expect(callArgs).toContain('auth');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose -t "omits --no-input when interactive is true"`
Expected: FAIL — `interactive` is not a recognized option yet, `--no-input` is still present.

- [ ] **Step 3: Write the regression test for default (non-interactive) still including `--no-input`**

Add to `tests/runner.test.ts`:

```ts
it('includes --no-input when interactive is not set', async () => {
  const spawner = makeSpawner(0, '{"ok":true}');
  await run(['sheets', 'get', 'id1', 'A1'], { spawner });
  const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
  expect(callArgs).toContain('--no-input');
});
```

- [ ] **Step 4: Implement `interactive` in runner**

In `src/runner.ts`, update `RunOptions`:

```ts
export interface RunOptions {
  account?: string;
  spawner?: Spawner;
  interactive?: boolean;
  timeout?: number;
}
```

In the `run()` function, change the `fullArgs` construction:

```ts
const { account, spawner = spawn as unknown as Spawner, interactive = false, timeout } = options;

const effectiveAccount = account ?? process.env.GOG_ACCOUNT;

const fullArgs = ['--json', '--color=never'];
if (!interactive) {
  fullArgs.push('--no-input');
}
```

- [ ] **Step 5: Run tests to verify both pass**

Run: `npm test -- --reporter=verbose`
Expected: Both new tests PASS, all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat(runner): add interactive option to skip --no-input"
```

---

### Task 2: Runner — add custom `timeout` option

**Files:**
- Modify: `src/runner.ts:17-18` (run function, timeout handling)
- Test: `tests/runner.test.ts`

- [ ] **Step 1: Write the failing test for custom timeout**

Add to `tests/runner.test.ts`:

```ts
it('uses custom timeout when provided', async () => {
  vi.useFakeTimers();
  const spawner = vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }) as unknown as Spawner;

  const promise = run(['auth', 'add', 'user@gmail.com'], { spawner, timeout: 300_000 });
  // Should NOT have timed out at 30s
  vi.advanceTimersByTime(30_000);
  // Advance to custom timeout
  vi.advanceTimersByTime(270_000);
  await expect(promise).rejects.toThrow('gog timed out after 300000ms (5 minutes)');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Write test that default timeout still works**

Add to `tests/runner.test.ts`:

```ts
it('includes human-readable duration in timeout error for default timeout', async () => {
  vi.useFakeTimers();
  const spawner = vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }) as unknown as Spawner;

  const promise = run(['sheets', 'get', 'id', 'A1'], { spawner });
  vi.advanceTimersByTime(30_000);
  await expect(promise).rejects.toThrow('gog timed out after 30000ms');
  vi.useRealTimers();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --reporter=verbose`
Expected: Custom timeout test FAIL (times out at 30s instead of 300s). Default timeout message test may also fail if message format changed.

- [ ] **Step 4: Implement custom timeout in runner**

In `src/runner.ts`, update the `run()` function:

```ts
const effectiveTimeout = timeout ?? TIMEOUT_MS;

// Helper for human-readable duration
function formatTimeout(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${ms}ms (${minutes} minute${minutes !== 1 ? 's' : ''})`;
  }
  return `${ms}ms`;
}

const timer = setTimeout(() => {
  settled = true;
  child.kill();
  reject(new Error(`gog timed out after ${formatTimeout(effectiveTimeout)}`));
}, effectiveTimeout);
```

Note: `formatTimeout` should be defined inside `run()` or as a module-level helper. Since it's small, define it at module level above the `run` function.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 6: Verify existing timeout test still passes**

The existing test `'rejects with timeout error when gog does not respond'` uses `.toThrow('gog timed out after 30000ms')` which is a substring match. The new message `"gog timed out after 30000ms"` still contains this substring (30s doesn't reach the 60s threshold for the minutes suffix). Verify it passes with no changes needed.

Run: `npm test -- --reporter=verbose -t "does not respond"`
Expected: PASS with no changes.

- [ ] **Step 7: Run full test suite**

Run: `npm test -- --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat(runner): add custom timeout option with human-readable error"
```

---

### Task 3: Runner — append stderr on interactive success

**Files:**
- Modify: `src/runner.ts` (close handler)
- Test: `tests/runner.test.ts`

- [ ] **Step 1: Write the failing test for stderr appended on interactive success**

Add to `tests/runner.test.ts`:

```ts
it('appends stderr to stdout on success when interactive is true', async () => {
  const spawner = vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"success":true}'));
      (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from('Opening browser...\nIf the browser doesn\'t open, visit this URL:\nhttps://accounts.google.com/auth?...'));
      proc.emit('close', 0);
    }, 0);
    return proc;
  }) as unknown as Spawner;

  const result = await run(['auth', 'add', 'user@gmail.com'], { spawner, interactive: true });
  expect(result).toContain('{"success":true}');
  expect(result).toContain('Opening browser...');
  expect(result).toContain('https://accounts.google.com/auth?...');
});
```

- [ ] **Step 2: Write test that non-interactive success does NOT include stderr**

Add to `tests/runner.test.ts`:

```ts
it('does not append stderr to stdout on success when interactive is false', async () => {
  const spawner = vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"ok":true}'));
      (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from('some warning'));
      proc.emit('close', 0);
    }, 0);
    return proc;
  }) as unknown as Spawner;

  const result = await run(['sheets', 'get', 'id', 'A1'], { spawner });
  expect(result).toBe('{"ok":true}');
  expect(result).not.toContain('some warning');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --reporter=verbose`
Expected: Interactive stderr test FAIL (stderr not included in result).

- [ ] **Step 4: Implement stderr append for interactive mode**

In `src/runner.ts`, update the close handler:

```ts
child.on('close', (code: number | null) => {
  clearTimeout(timer);
  if (settled) return;
  settled = true;
  if (code === 0) {
    if (interactive && stderr.trim()) {
      resolve(stdout + '\n' + stderr);
    } else {
      resolve(stdout);
    }
  } else {
    reject(new Error(stderr.trim() || `gog exited with code ${code}`));
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat(runner): append stderr on interactive success for fallback URL"
```

---

### Task 4: Auth tool — add `gog_auth_add`

**Files:**
- Modify: `src/tools/auth.ts:6-56` (add new tool, update `gog_auth_run` description)
- Test: `tests/tools/auth.test.ts`

- [ ] **Step 1: Write the failing test for `gog_auth_add` with default services**

Add to `tests/tools/auth.test.ts`:

```ts
describe('gog_auth_add', () => {
  it('calls run with correct args, interactive true, and 5-minute timeout', async () => {
    vi.mocked(runner.run).mockResolvedValue('Authorization successful for user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['auth', 'add', 'user@gmail.com', '--services', 'all'],
      { interactive: true, timeout: 300_000 },
    );
    expect(result.content[0].text).toBe('Authorization successful for user@gmail.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose -t "gog_auth_add"`
Expected: FAIL — handler `gog_auth_add` does not exist.

- [ ] **Step 3: Write additional tests for `gog_auth_add`**

Add inside the `describe('gog_auth_add', ...)`:

```ts
it('passes custom services when provided', async () => {
  vi.mocked(runner.run).mockResolvedValue('Authorization successful');
  const handlers = setupHandlers();
  await handlers.get('gog_auth_add')!({ email: 'user@gmail.com', services: 'sheets,gmail' });
  expect(runner.run).toHaveBeenCalledWith(
    ['auth', 'add', 'user@gmail.com', '--services', 'sheets,gmail'],
    { interactive: true, timeout: 300_000 },
  );
});

it('returns error text on failure', async () => {
  vi.mocked(runner.run).mockRejectedValue(new Error('Auth cancelled by user'));
  const handlers = setupHandlers();
  const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
  expect(result.content[0].text).toBe('Error: Auth cancelled by user');
});

it('returns error text on timeout', async () => {
  vi.mocked(runner.run).mockRejectedValue(new Error('gog timed out after 300000ms (5 minutes)'));
  const handlers = setupHandlers();
  const result = await handlers.get('gog_auth_add')!({ email: 'user@gmail.com' });
  expect(result.content[0].text).toContain('timed out');
  expect(result.content[0].text).toContain('5 minutes');
});
```

- [ ] **Step 4: Implement `gog_auth_add` tool**

Add to `src/tools/auth.ts`, before the `gog_auth_run` registration:

```ts
server.registerTool('gog_auth_add', {
  description:
    'Authorize a Google account via browser-based OAuth. ' +
    'Opens a browser window where the user must sign in and grant access. ' +
    'Blocks for up to 5 minutes waiting for the user to complete authorization. ' +
    'If the browser does not open automatically, a fallback URL is included in the response. ' +
    'Use gog_auth_list to check which accounts are already configured.',
  annotations: { destructiveHint: true },
  inputSchema: {
    email: z.string().describe('Google account email to authorize'),
    services: z.string().optional().default('all').describe(
      'Services to authorize: "all" or comma-separated list (e.g. "sheets,gmail,calendar"). Default: "all"',
    ),
  },
}, async ({ email, services }) => {
  try {
    return toText(await run(['auth', 'add', email, '--services', services], {
      interactive: true,
      timeout: 300_000,
    }));
  } catch (err) {
    return toError(err);
  }
});
```

- [ ] **Step 5: Update `gog_auth_run` description**

Change the `gog_auth_run` description from:

```ts
description: 'Run any gog auth subcommand. Run `gog auth --help` to see all available subcommands and flags. Note: gog auth add requires interactive browser auth and cannot be completed over MCP — run it in your terminal instead: gog auth add <email> --services <service>',
```

to:

```ts
description: 'Run any gog auth subcommand. Run `gog auth --help` to see all available subcommands and flags. Note: for browser-based authorization, use gog_auth_add instead.',
```

- [ ] **Step 6: Run all tests**

Run: `npm test -- --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/auth.ts tests/tools/auth.test.ts
git commit -m "feat(auth): add gog_auth_add tool for browser-based OAuth"
```

---

### Task 5: Manifest update

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add `gog_auth_add` to manifest tools list**

Add a new entry in the `tools` array in `manifest.json`, after the existing `gog_auth_list` entry:

```json
{
  "name": "gog_auth_add",
  "description": "Authorize a Google account via browser-based OAuth"
},
```

- [ ] **Step 2: Run build to verify no issues**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run full test suite**

Run: `npm test -- --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "chore(manifest): add gog_auth_add tool"
```
