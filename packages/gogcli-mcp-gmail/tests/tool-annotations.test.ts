import { authToolsFor, registerGmailTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraGmailTools } from '../src/tools/gmail-extra.js';
import { describeToolAnnotations, LOCAL_AUTH_TOOLS } from '../../gogcli-mcp/tests/support/tool-annotations.js';

// The same registrar list src/index.ts hands to runMcp.
describeToolAnnotations([authToolsFor('gmail'), registerGmailTools, registerExtraGmailTools] as never, {
  tools: 61,
  destructive: 27,
  local: [...LOCAL_AUTH_TOOLS, 'gog_gmail_url'],
});
