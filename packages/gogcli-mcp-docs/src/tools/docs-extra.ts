import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraDocsTools(server: McpServer): void {
  server.registerTool('gog_docs_copy', {
    description: 'Copy a Google Doc to a new document with the given title.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      title: z.string().describe('Title for the new copy'),
      parent: z.string().optional().describe('Parent folder ID to place the copy in'),
      account: accountParam,
    },
  }, async ({ docId, title, parent, account }) => {
    const args = ['docs', 'copy', docId, title];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_delete', {
    description: 'Delete content within a Google Doc by character index range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      start: z.number().describe('Start index (character position, 1-based)'),
      end: z.number().describe('End index (character position, exclusive)'),
      tabId: z.string().optional().describe('Tab ID to delete content from (for multi-tab docs)'),
      account: accountParam,
    },
  }, async ({ docId, start, end, tabId, account }) => {
    const args = ['docs', 'delete', `--start=${start}`, `--end=${end}`, docId];
    if (tabId) args.push(`--tab-id=${tabId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_edit', {
    description: 'Edit a Google Doc by finding and replacing text (stream-edit style).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching'),
      account: accountParam,
    },
  }, async ({ docId, find, replace, matchCase, account }) => {
    const args = ['docs', 'edit', docId, find, replace];
    if (matchCase) args.push('--match-case');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_export', {
    description: 'Export a Google Doc as PDF, plain text, HTML, DOCX, or other format.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      format: z.string().optional().describe('Export format: pdf, txt, html, docx, rtf, odt, epub (default: pdf)'),
      out: z.string().optional().describe('Output file path'),
      account: accountParam,
    },
  }, async ({ docId, format, out, account }) => {
    const args = ['docs', 'export', docId];
    if (format) args.push(`--format=${format}`);
    if (out) args.push(`--out=${out}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert', {
    description: 'Insert text at a specific position in a Google Doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      content: z.string().optional().describe('Text content to insert'),
      index: z.number().optional().describe('Character index to insert at (default: end of document)'),
      file: z.string().optional().describe('Path to a file whose content to insert'),
      tabId: z.string().optional().describe('Tab ID to insert into (for multi-tab docs)'),
      account: accountParam,
    },
  }, async ({ docId, content, index, file, tabId, account }) => {
    const args = ['docs', 'insert', docId];
    if (content) args.push(content);
    if (index !== undefined) args.push(`--index=${index}`);
    if (file) args.push(`--file=${file}`);
    if (tabId) args.push(`--tab-id=${tabId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_list_tabs', {
    description: 'List all tabs in a Google Doc.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'list-tabs', docId], { account });
  });

  server.registerTool('gog_docs_sed', {
    description: 'Stream-edit a Google Doc with sed-like regex expressions (s/find/replace/ syntax).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      expression: z.string().optional().describe('Single sed expression (e.g. "s/old/new/g")'),
      expressions: z.array(z.string()).optional().describe('Multiple sed expressions'),
      file: z.string().optional().describe('Path to a sed script file'),
      tab: z.string().optional().describe('Tab name to edit'),
      account: accountParam,
    },
  }, async ({ docId, expression, expressions, file, tab, account }) => {
    const args = ['docs', 'sed', docId];
    if (expression) args.push(expression);
    if (expressions) {
      for (const expr of expressions) {
        args.push(`--expressions=${expr}`);
      }
    }
    if (file) args.push(`--file=${file}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_update', {
    description: 'Update a Google Doc — insert or replace text at a specific position.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().optional().describe('Text content to write'),
      file: z.string().optional().describe('Path to a file whose content to use'),
      index: z.number().optional().describe('Character index to insert at'),
      tabId: z.string().optional().describe('Tab ID for multi-tab docs'),
      pageless: z.boolean().optional().describe('Set document to pageless format'),
      account: accountParam,
    },
  }, async ({ docId, text, file, index, tabId, pageless, account }) => {
    const args = ['docs', 'update', docId];
    if (text) args.push(`--text=${text}`);
    if (file) args.push(`--file=${file}`);
    if (index !== undefined) args.push(`--index=${index}`);
    if (tabId) args.push(`--tab-id=${tabId}`);
    if (pageless) args.push('--pageless');
    return runOrDiagnose(args, { account });
  });

  // --- Dedicated comment tools (replacing the generic escape hatch in base) ---

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
}
