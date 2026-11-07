import { authToolsFor } from '../../gogcli-mcp/src/lib.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('drive')] as never, {
  tools: 8,
  destructive: 3,
  local: [...LOCAL_AUTH_TOOLS],
});
