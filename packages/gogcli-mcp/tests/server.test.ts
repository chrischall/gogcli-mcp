import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { BASE_TOOL_REGISTRARS, VERSION } from '../src/server.js';

describe('BASE_TOOL_REGISTRARS', () => {
  it('registers every base service without duplicate tool names', async () => {
    const harness = await createTestHarness((server) => {
      for (const register of BASE_TOOL_REGISTRARS) {
        register(server, undefined);
      }
    });
    const names = (await harness.listTools()).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    // One representative tool per service registrar, in registrar order.
    for (const expected of [
      'gog_api_list',
      'gog_appscript_get',
      'gog_auth_list',
      'gog_calendar_events',
      'gog_chat_spaces_list',
      'gog_classroom_courses_list',
      'gog_contacts_list',
      'gog_docs_cat',
      'gog_drive_ls',
      'gog_gmail_search',
      'gog_sheets_get',
      'gog_slides_export',
      'gog_tasks_lists',
    ]) {
      expect(names).toContain(expected);
    }
    await harness.close();
  });
});

describe('VERSION', () => {
  it('is a string', () => {
    expect(typeof VERSION).toBe('string');
  });

  it('defaults to 0.0.0 when GOGCLI_VERSION is not injected (dev/test runtime)', () => {
    // At test runtime, esbuild has not injected GOGCLI_VERSION, so the fallback branch runs.
    expect(VERSION).toBe('0.0.0');
  });
});

// The tool counts in README.md, SKILL.md and manifest.json are hand-maintained
// and have now drifted twice (0ec3470 "correct the stale tool counts", then
// again when reply/reply-all landed). They are the first thing a reader sees,
// so derive the truth from the registrars and fail the build on a mismatch
// rather than catching it in review a release later.
describe('published tool counts match the registrars', () => {
  const readPkgFile = async (name: string) => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
  };

  const liveToolNames = async (): Promise<string[]> => {
    const harness = await createTestHarness((server) => {
      for (const register of BASE_TOOL_REGISTRARS) register(server, undefined);
    });
    const names = (await harness.listTools()).map((t) => t.name);
    await harness.close();
    return names;
  };

  it('manifest.json lists exactly the registered tools', async () => {
    const names = await liveToolNames();
    const manifest = JSON.parse(await readPkgFile('manifest.json')) as { tools: Array<{ name: string }> };
    expect([...manifest.tools.map((t) => t.name)].sort()).toEqual([...names].sort());
  });

  it.each(['README.md', 'SKILL.md'])('%s states the real total', async (file) => {
    const total = (await liveToolNames()).length;
    const text = await readPkgFile(file);
    const heading = /^## Tools \((\d+)\)$/m.exec(text);
    expect(heading, `${file} has no "## Tools (N)" heading`).not.toBeNull();
    expect(Number(heading![1])).toBe(total);
    // README also states the count in its opening paragraph.
    const prose = /Includes (\d+) tools across/.exec(text);
    if (prose) expect(Number(prose[1])).toBe(total);
  });

  it.each(['README.md', 'SKILL.md'])('%s states the real per-service counts', async (file) => {
    const names = await liveToolNames();
    const text = await readPkgFile(file);
    // README: `| **Gmail** | 6 | …`   SKILL: `| **Gmail** (6) | …`
    const rows = [...text.matchAll(/^\| \*\*(.+?)\*\*(?: \((\d+)\)| \| (\d+))? \|/gm)];
    expect(rows.length).toBeGreaterThan(0);
    const service = (row: string) => row.toLowerCase().replace(/[^a-z]/g, '');
    // Map a table label onto the gog_<service>_ prefix its tools carry.
    // Only labels whose normalised form differs from their tool prefix belong
    // here. "Apps Script" normalises to `appsscript` but the tools are
    // `gog_appscript_`, so that mapping is load-bearing. A `discoveryapi` entry
    // was not: both tables label the row "API", which normalises to `api` and
    // already resolves — so it never matched and only implied a label that
    // does not exist.
    const prefixFor: Record<string, string> = {
      appsscript: 'appscript',
    };
    for (const row of rows) {
      const stated = Number(row[2] ?? row[3]);
      if (!Number.isFinite(stated)) continue;
      const key = service(row[1]);
      const prefix = `gog_${prefixFor[key] ?? key}_`;
      expect(names.filter((n) => n.startsWith(prefix)).length, `${file} row ${row[1]}`).toBe(stated);
    }
  });
});
