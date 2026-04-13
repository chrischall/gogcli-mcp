import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

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

  // --- Comments tools ---

  server.registerTool('gog_docs_comments_list', {
    description:
      'List comments on a Google Doc. Returns open comments by default; set includeResolved=true to include resolved comments.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      includeResolved: z.boolean().optional().describe('Include resolved comments (default: false, open only)'),
      account: accountParam,
    },
  }, async ({ docId, includeResolved, account }) => {
    const args = ['docs', 'comments', 'list', docId];
    if (includeResolved) args.push('--include-resolved');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_get', {
    description: 'Get a single comment by ID, including its replies.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID'),
      account: accountParam,
    },
  }, async ({ docId, commentId, account }) => {
    return runOrDiagnose(['docs', 'comments', 'get', docId, commentId], { account });
  });

  server.registerTool('gog_docs_comments_add', {
    description:
      'Add a comment to a Google Doc. Optionally attach quoted text that appears as the highlighted passage in the Google Docs UI.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      content: z.string().describe('Comment text'),
      quoted: z.string().optional().describe('Quoted text to attach to the comment (shown in UIs when available)'),
      account: accountParam,
    },
  }, async ({ docId, content, quoted, account }) => {
    const args = ['docs', 'comments', 'add', docId, content];
    if (quoted) args.push(`--quoted=${quoted}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_reply', {
    description: 'Reply to an existing comment on a Google Doc.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to reply to'),
      content: z.string().describe('Reply text'),
      account: accountParam,
    },
  }, async ({ docId, commentId, content, account }) => {
    return runOrDiagnose(['docs', 'comments', 'reply', docId, commentId, content], { account });
  });

  server.registerTool('gog_docs_comments_resolve', {
    description: 'Resolve a comment (mark as done). Optionally include a closing message.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to resolve'),
      message: z.string().optional().describe('Optional message to include when resolving'),
      account: accountParam,
    },
  }, async ({ docId, commentId, message, account }) => {
    const args = ['docs', 'comments', 'resolve', docId, commentId];
    if (message) args.push(`--message=${message}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_delete', {
    description: 'Delete a comment from a Google Doc. This action is permanent.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to delete'),
      account: accountParam,
    },
  }, async ({ docId, commentId, account }) => {
    return runOrDiagnose(['docs', 'comments', 'delete', docId, commentId], { account });
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
