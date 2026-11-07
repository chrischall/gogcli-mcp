import { authToolsFor } from '../../gogcli-mcp/src/lib.js';
import { placesTools } from '../src/tools/places.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('drive'), placesTools()] as never, {
  tools: 11,
  destructive: 3,
  local: [...LOCAL_AUTH_TOOLS],
});
