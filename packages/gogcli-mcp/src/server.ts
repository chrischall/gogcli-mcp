import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerClassroomTools } from './tools/classroom.js';
import { registerContactsTools } from './tools/contacts.js';
import { registerDocsTools } from './tools/docs.js';
import { registerDriveTools } from './tools/drive.js';
import { registerGmailTools } from './tools/gmail.js';
import { registerSheetsTools } from './tools/sheets.js';
import { registerSlidesTools } from './tools/slides.js';
import { registerTasksTools } from './tools/tasks.js';

// Injected at build time by esbuild --define:GOGCLI_VERSION=... At test runtime
// the define is not applied, so the fallback branch runs. The injected branch
// is exercised in the built bundle, not in vitest.
declare const GOGCLI_VERSION: string;
/* v8 ignore next */
export const VERSION = typeof GOGCLI_VERSION !== 'undefined' ? GOGCLI_VERSION : '0.0.0';

export function createServer(options?: { name?: string; version?: string }): McpServer {
  return new McpServer({
    name: options?.name ?? 'gogcli',
    version: options?.version ?? VERSION,
  });
}

export function createBaseServer(options?: { name?: string; version?: string }): McpServer {
  const server = createServer(options);

  registerAuthTools(server);
  registerCalendarTools(server);
  registerClassroomTools(server);
  registerContactsTools(server);
  registerDocsTools(server);
  registerDriveTools(server);
  registerGmailTools(server);
  registerSheetsTools(server);
  registerSlidesTools(server);
  registerTasksTools(server);

  return server;
}

export {
  registerAuthTools,
  registerCalendarTools,
  registerClassroomTools,
  registerContactsTools,
  registerDocsTools,
  registerDriveTools,
  registerGmailTools,
  registerSheetsTools,
  registerSlidesTools,
  registerTasksTools,
};
