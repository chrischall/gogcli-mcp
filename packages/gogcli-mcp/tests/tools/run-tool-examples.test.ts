import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerRunTool } from '../../src/tools/utils.js';
import { registerApiTools } from '../../src/tools/api.js';
import { registerAppScriptTools } from '../../src/tools/appscript.js';
import { registerAuthTools } from '../../src/tools/auth.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';
import { registerChatTools } from '../../src/tools/chat.js';
import { registerClassroomTools } from '../../src/tools/classroom.js';
import { registerContactsTools } from '../../src/tools/contacts.js';
import { registerDocsTools } from '../../src/tools/docs.js';
import { registerDriveTools } from '../../src/tools/drive.js';
import { registerGmailTools } from '../../src/tools/gmail.js';
import { registerSheetsTools } from '../../src/tools/sheets.js';
import { registerSlidesTools } from '../../src/tools/slides.js';
import { registerTasksTools } from '../../src/tools/tasks.js';

// A gog_<service>_run description that suggests a subcommand the tool itself
// refuses sends the model straight into an error (#391: drive "upload" and
// slides "add-slide" outlived #390's refusals). registerRunTool now vets its
// own examples, so a stale one fails at registration.

const fakeServer = () => ({ registerTool: vi.fn() }) as unknown as McpServer;

describe('registerRunTool examples', () => {
  it('refuses an example whose local path is positional (drive upload)', () => {
    expect(() => registerRunTool(fakeServer(), { service: 'drive', examples: '"copy", "upload"' })).toThrow(
      /gog_drive_run example "upload" is refused/,
    );
  });

  it('refuses an example outside allowedSubcommands', () => {
    expect(() =>
      registerRunTool(fakeServer(), { service: 'auth', examples: '"list", "tokens"', allowedSubcommands: ['list'] }),
    ).toThrow(/gog_auth_run example "tokens" is refused/);
  });

  it('refuses an example the service vet rejects', () => {
    expect(() =>
      registerRunTool(fakeServer(), {
        service: 'gmail',
        examples: '"archive", "autoreply"',
        vet: (sub) => (sub === 'autoreply' ? 'no' : undefined),
      }),
    ).toThrow(/gog_gmail_run example "autoreply" is refused/);
  });

  it('accepts examples that all run', () => {
    expect(() => registerRunTool(fakeServer(), { service: 'drive', examples: '"copy", "download"' })).not.toThrow();
  });

  it.each([
    registerApiTools,
    registerAppScriptTools,
    registerAuthTools,
    registerCalendarTools,
    registerChatTools,
    registerClassroomTools,
    registerContactsTools,
    registerDocsTools,
    registerDriveTools,
    registerGmailTools,
    registerSheetsTools,
    registerSlidesTools,
    registerTasksTools,
  ])('%o registers with only runnable run-tool examples', (register) => {
    expect(() => (register as (s: McpServer) => void)(fakeServer())).not.toThrow();
  });
});
