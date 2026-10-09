import { authToolsFor, registerDocsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from '../src/tools/docs-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('docs'), registerDocsTools, registerExtraDocsTools] as never, {
  tools: 83,
  destructive: 52,
  local: [...LOCAL_AUTH_TOOLS, 'gog_batch_abort', 'gog_batch_begin', 'gog_batch_list', 'gog_batch_prune', 'gog_batch_show'],
});
