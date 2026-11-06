import { authToolsFor, registerDriveTools, registerUploadTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from '../src/tools/drive-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('drive,driveactivity,drivelabels'), registerDriveTools, registerExtraDriveTools, registerUploadTools] as never, {
  tools: 51,
  destructive: 13,
  local: [...LOCAL_AUTH_TOOLS, 'gog_upload_slots'],
});
