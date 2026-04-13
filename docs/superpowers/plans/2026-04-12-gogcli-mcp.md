# gogcli-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server that wraps the `gog` CLI, exposing Google Sheets operations as typed MCP tools, with scaffold for adding other services later.

**Architecture:** A `runner.ts` module handles all `gog` process execution (auth injection, stdout/stderr capture, error surfacing). Service tool files (starting with `sheets.ts`) import `run()` from runner and register tools on the MCP server. `index.ts` wires everything together via stdio transport.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, Zod v4, vitest, esbuild

---

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, build and test scripts |
| `tsconfig.json` | TypeScript config (ES2022, NodeNext) |
| `vitest.config.ts` | Test config with 100% coverage thresholds |
| `src/runner.ts` | Spawns `gog`, injects auth flags, returns stdout or throws stderr |
| `src/tools/sheets.ts` | Registers 8 Sheets MCP tools (7 curated + 1 escape hatch) |
| `src/index.ts` | MCP server entry point (stdio transport, registers all tools) |
| `.mcp.json` | Claude Code MCP server configuration |
| `tests/runner.test.ts` | Unit tests for runner (mock spawner via DI) |
| `tests/tools/sheets.test.ts` | Unit tests for Sheets tools (mock runner module) |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "gogcli-mcp",
  "version": "1.0.0",
  "description": "MCP server wrapping gogcli for Google service access",
  "type": "module",
  "bin": {
    "gogcli-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.5.2",
    "@vitest/coverage-v8": "^4.1.2",
    "esbuild": "^0.28.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "chore: project scaffold"
```

---

## Task 2: runner.ts with Tests

**Files:**
- Create: `tests/runner.test.ts`
- Create: `src/runner.ts`

The runner is the only module that touches `child_process`. It accepts a `spawner` parameter (default: the real `spawn`) so tests can inject a mock without module-level mocking. It builds the full `gog` invocation: prepends `--json --no-input --color=never`, injects `--account` from `options.account` then `GOG_ACCOUNT` env var, appends the caller-supplied args.

- [ ] **Step 1: Create `tests/runner.test.ts` with failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { run } from '../src/runner.js';
import type { Spawner } from '../src/runner.js';

function makeSpawner(exitCode: number, stdout = '', stderr = ''): Spawner {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
      (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 0);
    return proc;
  }) as unknown as Spawner;
}

describe('run', () => {
  it('passes --json --no-input --color=never before service args', async () => {
    const spawner = makeSpawner(0, '{"ok":true}');
    await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--no-input', '--color=never', 'sheets', 'get', 'id1', 'A1'],
      expect.objectContaining({ env: process.env }),
    );
  });

  it('injects --account from options.account', async () => {
    const spawner = makeSpawner(0, '{}');
    await run(['sheets', 'metadata', 'id1'], { account: 'me@gmail.com', spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--no-input', '--color=never', '--account', 'me@gmail.com', 'sheets', 'metadata', 'id1'],
      expect.any(Object),
    );
  });

  it('injects --account from GOG_ACCOUNT env var when no options.account', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    process.env.GOG_ACCOUNT = 'env@gmail.com';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith(
        'gog',
        ['--json', '--no-input', '--color=never', '--account', 'env@gmail.com', 'sheets', 'metadata', 'id1'],
        expect.any(Object),
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_ACCOUNT;
      } else {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('options.account takes precedence over GOG_ACCOUNT env var', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    process.env.GOG_ACCOUNT = 'env@gmail.com';
    try {
      await run(['sheets', 'metadata', 'id1'], { account: 'override@gmail.com', spawner });
      const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      const accountIdx = callArgs.indexOf('--account');
      expect(callArgs[accountIdx + 1]).toBe('override@gmail.com');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_ACCOUNT;
      } else {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('omits --account when neither options.account nor GOG_ACCOUNT is set', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    delete process.env.GOG_ACCOUNT;
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(callArgs).not.toContain('--account');
    } finally {
      if (originalEnv !== undefined) {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('returns stdout on exit code 0', async () => {
    const spawner = makeSpawner(0, '{"values":[["hello"]]}');
    const result = await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    expect(result).toBe('{"values":[["hello"]]}');
  });

  it('throws with stderr message on non-zero exit', async () => {
    const spawner = makeSpawner(1, '', 'Spreadsheet not found');
    await expect(run(['sheets', 'get', 'bad', 'A1'], { spawner }))
      .rejects.toThrow('Spreadsheet not found');
  });

  it('throws with fallback message when stderr is empty on non-zero exit', async () => {
    const spawner = makeSpawner(2, '', '');
    await expect(run(['sheets', 'get', 'bad', 'A1'], { spawner }))
      .rejects.toThrow('gog exited with code 2');
  });

  it('rejects on spawn error', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => proc.emit('error', new Error('gog not found')), 0);
      return proc;
    }) as unknown as Spawner;
    await expect(run(['sheets', 'get', 'id', 'A1'], { spawner }))
      .rejects.toThrow('gog not found');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `src/runner.ts` does not exist.

- [ ] **Step 3: Create `src/runner.ts`**

```typescript
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

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `gog exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test
```

Expected: All 8 runner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: add runner module with unit tests"
```

---

## Task 3: Sheets Tools with Tests

**Files:**
- Create: `tests/tools/sheets.test.ts`
- Create: `src/tools/sheets.ts`

Each curated tool calls `run(['sheets', <subcommand>, ...positional-args, ...flag-args], { account })`. The `gog_sheets_update` and `gog_sheets_append` tools pass values via `--values-json=<JSON>` (gogcli's structured input flag for 2D arrays). All tools catch errors and return them as text content so the model can see gogcli's error message.

- [ ] **Step 1: Create `tests/tools/sheets.test.ts` with failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSheetsTools } from '../../src/tools/sheets.js';
import * as runner from '../../src/runner.js';

vi.mock('../../src/runner.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerSheetsTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_sheets_get', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"values":[["a","b"]]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:B2' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'Sheet1!A1:B2'], { account: undefined });
    expect(result.content[0].text).toBe('{"values":[["a","b"]]}');
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_get')!({ spreadsheetId: 'sid', range: 'A1', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'A1'], { account: 'other@gmail.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Spreadsheet not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found');
  });
});

describe('gog_sheets_update', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updatedCells":2}');
    const handlers = setupHandlers();
    const values = [['hello', 'world']];
    await handlers.get('gog_sheets_update')!({ spreadsheetId: 'sid', range: 'A1:B1', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'update', 'sid', 'A1:B1', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });
});

describe('gog_sheets_append', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updates":{}}');
    const handlers = setupHandlers();
    const values = [['r1c1', 'r1c2'], ['r2c1', 'r2c2']];
    await handlers.get('gog_sheets_append')!({ spreadsheetId: 'sid', range: 'Sheet1!A:B', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'append', 'sid', 'Sheet1!A:B', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });
});

describe('gog_sheets_clear', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_clear')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:Z100' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'clear', 'sid', 'Sheet1!A1:Z100'], { account: undefined });
  });
});

describe('gog_sheets_metadata', () => {
  it('calls run with spreadsheetId only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"title":"My Sheet","sheets":[{"title":"Sheet1"}]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_metadata')!({ spreadsheetId: 'sid' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata', 'sid'], { account: undefined });
    expect(result.content[0].text).toContain('My Sheet');
  });
});

describe('gog_sheets_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spreadsheetId":"newid","title":"Budget 2026"}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_create')!({ title: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'create', 'Budget 2026'], { account: undefined });
  });
});

describe('gog_sheets_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":3}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_find_replace')!({ spreadsheetId: 'sid', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'find-replace', 'sid', 'foo', 'bar'], { account: undefined });
  });
});

describe('gog_sheets_run', () => {
  it('passes raw subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_run')!({
      subcommand: 'freeze',
      args: ['sid', '--rows=1'],
    });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'freeze', 'sid', '--rows=1'], { account: undefined });
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_run')!({ subcommand: 'metadata', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata'], { account: undefined });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `src/tools/sheets.ts` does not exist.

- [ ] **Step 3: Create `src/tools/sheets.ts`**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';

const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

function toText(output: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: output }] };
}

function toError(err: unknown): { content: [{ type: 'text'; text: string }] } {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}

export function registerSheetsTools(server: McpServer): void {
  server.registerTool('gog_sheets_get', {
    description: 'Read values from a Google Sheets range. Returns a JSON object with a "values" array of rows.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range in A1 notation, e.g. Sheet1!A1:B10 or a named range'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    try {
      return toText(await run(['sheets', 'get', spreadsheetId, range], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_update', {
    description: 'Write values to a Google Sheets range, overwriting existing content.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Top-left cell or range in A1 notation, e.g. Sheet1!A1'),
      values: z.array(z.array(z.string())).describe('2D array of values: outer array is rows, inner is columns'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    try {
      return toText(await run(
        ['sheets', 'update', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
        { account },
      ));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_append', {
    description: 'Append rows to a Google Sheet after the last row with data in the given range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range indicating which sheet/columns to append to, e.g. Sheet1!A:C'),
      values: z.array(z.array(z.string())).describe('2D array of rows to append'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    try {
      return toText(await run(
        ['sheets', 'append', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
        { account },
      ));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_clear', {
    description: 'Clear all values in a Google Sheets range (formatting is preserved).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range in A1 notation to clear'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    try {
      return toText(await run(['sheets', 'clear', spreadsheetId, range], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_metadata', {
    description: 'Get spreadsheet metadata: title, sheet tabs, named ranges, and other properties.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    try {
      return toText(await run(['sheets', 'metadata', spreadsheetId], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_create', {
    description: 'Create a new Google Spreadsheet. Returns JSON with the new spreadsheetId and URL.',
    inputSchema: {
      title: z.string().describe('Title for the new spreadsheet'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    try {
      return toText(await run(['sheets', 'create', title], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_find_replace', {
    description: 'Find and replace text across an entire Google Spreadsheet.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, find, replace, account }) => {
    try {
      return toText(await run(['sheets', 'find-replace', spreadsheetId, find, replace], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_run', {
    description: 'Run any gog sheets subcommand not covered by the other tools. See `gog sheets --help` for the full list of subcommands and their flags.',
    inputSchema: {
      subcommand: z.string().describe('The gog sheets subcommand to run, e.g. "freeze", "add-tab", "rename-tab"'),
      args: z.array(z.string()).describe('Additional positional args and flags, e.g. ["<spreadsheetId>", "--rows=1"]'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    try {
      return toText(await run(['sheets', subcommand, ...args], { account }));
    } catch (err) {
      return toError(err);
    }
  });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test
```

Expected: All tests PASS (runner tests + sheets tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/sheets.ts tests/tools/sheets.test.ts
git commit -m "feat: add Sheets MCP tools with unit tests"
```

---

## Task 4: Server Entry Point and MCP Config

**Files:**
- Create: `src/index.ts`
- Create: `.mcp.json`

- [ ] **Step 1: Create `src/index.ts`**

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSheetsTools } from './tools/sheets.js';

const server = new McpServer({ name: 'gogcli', version: '1.0.0' });

registerSheetsTools(server);

// To add more services: import registerXxxTools and call them here.
// Example: registerGmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Create `.mcp.json`**

```json
{
  "mcpServers": {
    "gogcli": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "GOG_ACCOUNT": "${GOG_ACCOUNT}"
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts .mcp.json
git commit -m "feat: add MCP server entry point and config"
```

---

## Task 5: Build and Smoke Test

**Files:** none new — verifies the build pipeline works end-to-end.

- [ ] **Step 1: Run the TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Build the bundle**

```bash
npm run build
```

Expected: `dist/index.js` created, no errors.

- [ ] **Step 3: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: All tests pass, 100% coverage on `src/runner.ts` and `src/tools/sheets.ts`.

- [ ] **Step 4: Smoke test the server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

Expected: JSON response listing all 8 `gog_sheets_*` tools.

- [ ] **Step 5: Commit**

```bash
git add dist/
git commit -m "build: add compiled bundle"
```

---

## Adding Future Services (Reference)

When you want to add Gmail, Calendar, or another service:

1. Create `src/tools/<service>.ts` — export `registerXxxTools(server: McpServer)`
2. Implement curated tools for common operations + a `gog_<service>_run` escape hatch (same pattern as sheets.ts)
3. Create `tests/tools/<service>.test.ts` — mock `runner.run` via `vi.mock('../../src/runner.js')`
4. In `src/index.ts`, import `registerXxxTools` and call it after `registerSheetsTools(server)`
5. No changes to `runner.ts` or `.mcp.json` required
