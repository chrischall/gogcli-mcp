import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';
import { toText, type ToolResult } from './utils.js';

const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

// On failure, appends `gog auth list` output so Claude can see which accounts
// are configured and suggest the right one.
async function runOrDiagnose(
  args: string[],
  options: { account?: string },
): Promise<ToolResult> {
  try {
    return toText(await run(args, options));
  } catch (err) {
    const errorText = err instanceof Error ? `Error: ${err.message}` : String(err);
    try {
      const accounts = await run(['auth', 'list']);
      return toText(`${errorText}\n\nConfigured accounts:\n${accounts}`);
    } catch {
      return toText(errorText);
    }
  }
}

export function registerDocsTools(server: McpServer): void {
  server.registerTool('gog_docs_info', {
    description: 'Get Google Doc metadata: title, ID, and other properties.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'info', docId], { account });
  });

  server.registerTool('gog_docs_cat', {
    description: 'Read a Google Doc as plain text.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'cat', docId], { account });
  });

  server.registerTool('gog_docs_create', {
    description: 'Create a new Google Doc. Returns JSON with the new docId and URL.',
    inputSchema: {
      title: z.string().describe('Title for the new document'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    return runOrDiagnose(['docs', 'create', title], { account });
  });

  server.registerTool('gog_docs_write', {
    description: 'Write text content to a Google Doc, replacing existing body content by default. Set append=true to add after existing content.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().describe('Text content to write'),
      append: z.boolean().optional().describe('Append to existing content instead of replacing (default: false)'),
      account: accountParam,
    },
  }, async ({ docId, text, append, account }) => {
    const args = ['docs', 'write', docId, `--text=${text}`];
    if (append) args.push('--append');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_find_replace', {
    description: 'Find and replace text in a Google Doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      account: accountParam,
    },
  }, async ({ docId, find, replace, account }) => {
    return runOrDiagnose(['docs', 'find-replace', docId, find, replace], { account });
  });

  server.registerTool('gog_docs_structure', {
    description: 'Show a Google Doc\'s structure with numbered paragraphs. Useful for understanding the document layout before making index-based edits.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'structure', docId], { account });
  });

  server.registerTool('gog_docs_run', {
    description: 'Run any gog docs subcommand not covered by the other tools. Run `gog docs --help` for the full list of subcommands, or `gog docs <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog docs subcommand to run, e.g. "copy", "clear", "insert", "sed", "export"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['docs', subcommand, ...args], { account });
  });
}
