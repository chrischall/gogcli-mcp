import { authToolsFor, registerClassroomTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraClassroomTools } from '../src/tools/classroom-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('classroom'), registerClassroomTools, registerExtraClassroomTools] as never, {
  tools: 52,
  destructive: 26,
  local: [...LOCAL_AUTH_TOOLS],
});
