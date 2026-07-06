import type { ToolRegistrar } from '@chrischall/mcp-utils';
import { registerApiTools } from './tools/api.js';
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

// Registrar list for the base (all-services) server, in runMcp's `tools`
// shape. Sub-packages assemble their own list from the individual registrars
// re-exported below.
export const BASE_TOOL_REGISTRARS: ToolRegistrar[] = [
  registerApiTools,
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
];

export {
  registerApiTools,
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
