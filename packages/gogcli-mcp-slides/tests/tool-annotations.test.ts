import { authToolsFor, registerSlidesTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from '../src/tools/slides-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('slides'), registerSlidesTools, registerExtraSlidesTools] as never, {
  tools: 55,
  destructive: 20,
  local: [...LOCAL_AUTH_TOOLS],
});
