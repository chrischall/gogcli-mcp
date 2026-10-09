import { authToolsFor, registerSheetsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSheetsTools } from '../src/tools/sheets-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('sheets'), registerSheetsTools, registerExtraSheetsTools] as never, {
  tools: 78,
  destructive: 41,
  local: [...LOCAL_AUTH_TOOLS, 'gog_sheets_batch_begin'],
});
