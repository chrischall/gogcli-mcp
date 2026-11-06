import { authToolsFor, registerDocsTools, registerUploadTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from '../src/tools/docs-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('docs'), registerDocsTools, registerExtraDocsTools, registerUploadTools] as never, {
  tools: 84,
  destructive: 52,
  local: [...LOCAL_AUTH_TOOLS, 'gog_upload_slots', 'gog_batch_abort', 'gog_batch_begin', 'gog_batch_list', 'gog_batch_prune', 'gog_batch_show'],
});
