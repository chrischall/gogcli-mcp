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
      'gog_auth_list',
      'gog_calendar_events',
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
