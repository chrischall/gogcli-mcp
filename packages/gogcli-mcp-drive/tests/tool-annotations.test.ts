import { authToolsFor, registerDriveTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from '../src/tools/drive-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('drive,driveactivity,drivelabels'), registerDriveTools, registerExtraDriveTools] as never, {
  tools: 50,
  destructive: 13,
  local: [...LOCAL_AUTH_TOOLS],
});
